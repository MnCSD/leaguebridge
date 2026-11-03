/**
 * A fake League client for testing without the game. DEV ONLY: nothing in the real bridge imports this.
 *
 * It copies what the real client does, as observed in recordings:
 *  - writes `<dir>/lockfile` (`name:pid:port:password:https`), new port + password on every start
 *  - HTTPS + WSS on 127.0.0.1 with a self-signed cert and Basic auth (`riot:<password>`)
 *  - WAMP: accepts [5,"OnJsonApiEvent"], sends [8,"OnJsonApiEvent",{uri,eventType,data}]
 *  - ready check: `timer` counts up once per second, the pop lasts 12s, accept/decline endpoints
 *
 * Simulates: gameflow phase, ready check, lobby, summoner lookups, champion select and rune pages
 * (the last two in fakeChampSelect.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket } from 'ws';
import { PHASE_URI } from '../gameflow/phase';
import { READY_CHECK_URI, type ReadyCheck } from '../gameflow/autoAccept';
import { FakeChampSelect } from './fakeChampSelect';

export interface FakeLcuOptions {
  /** Folder to write the lockfile into. Point the bridge's --league-path here. */
  dir: string;
  /** Real client: 1000ms per ready-check tick. */
  tickMs?: number;
  /** Real client: 12s pops. */
  windowSec?: number;
  log?: (msg: string) => void;
}

const NOT_FOUND = { errorCode: 'RPC_ERROR', httpStatus: 404, implementationDetails: {}, message: 'Not found' };

let cachedCert: Promise<{ key: string; cert: string }> | null = null;
function certificate() {
  cachedCert ??= generate([{ name: 'commonName', value: 'fake-lcu' }], { keyType: 'ec', algorithm: 'sha256' }).then(
    (p) => ({ key: p.private, cert: p.cert }),
  );
  return cachedCert;
}

export class FakeLcu {
  port = 0;
  password = '';
  phase = 'None';
  readyCheck: ReadyCheck | null = null;
  /** Every request the bridge made, as "METHOD /path". Handy in tests. */
  readonly requests: string[] = [];

  private server: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private subscribers = new Set<WebSocket>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly tickMs: number;
  private readonly windowSec: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: FakeLcuOptions) {
    this.tickMs = opts.tickMs ?? 1000;
    this.windowSec = opts.windowSec ?? 12;
    this.log = opts.log ?? (() => {});
  }

  get running() {
    return this.server !== null;
  }

  // --- client lifecycle ----------------------------------------------------------------------

  async start() {
    if (this.server) return;
    this.password = randomBytes(16).toString('base64url');
    const { key, cert } = await certificate();

    const server = https.createServer({ key, cert }, (req, res) => void this.handleHttp(req, res));
    const wss = new WebSocketServer({
      server,
      verifyClient: (info: { req: IncomingMessage }) => this.authorized(info.req),
    });
    wss.on('connection', (ws) => {
      ws.send(''); // the real client sends an empty frame first
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (Array.isArray(msg) && msg[0] === 5 && msg[1] === 'OnJsonApiEvent') this.subscribers.add(ws);
        } catch {
          /* ignore junk, like the real client */
        }
      });
      ws.on('close', () => this.subscribers.delete(ws));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.wss = wss;
    this.port = (server.address() as AddressInfo).port;

    await mkdir(this.opts.dir, { recursive: true });
    await writeFile(join(this.opts.dir, 'lockfile'), `LeagueClient:${process.pid}:${this.port}:${this.password}:https`);
    this.log(`Client started on port ${this.port}`);
  }

  async stop() {
    if (!this.server) return;
    this.clearTimers();
    this.readyCheck = null;
    this.phase = 'None';
    await unlink(join(this.opts.dir, 'lockfile')).catch(() => {});
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.subscribers.clear();
    await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this.wss = null;
    this.log('Client closed');
  }

  /** Like quitting and relaunching League: new port, new password. */
  async restart() {
    await this.stop();
    await this.start();
    this.setPhase('None');
  }

  // --- game flow -----------------------------------------------------------------------------

  setPhase(phase: string) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.emit(PHASE_URI, 'Update', phase);
    this.log(`Phase -> ${phase}`);
  }

  /** Enter queue; the pop comes after `popAfterMs`. */
  queue(popAfterMs = 3000) {
    this.clearTimers();
    this.readyCheck = null;
    this.setPhase('Matchmaking');
    this.queueTimer = setTimeout(() => this.pop(), popAfterMs);
  }

  /** A match is found. `startTimer` > 0 pretends the pop has already been up for that many seconds. */
  pop(startTimer = 0) {
    this.clearTimers();
    this.setPhase('ReadyCheck');
    this.readyCheck = { state: 'InProgress', playerResponse: 'None', timer: startTimer, declinerIds: [] };
    this.emitReadyCheck();
    this.log('Match found!');

    this.tick = setInterval(() => {
      const rc = this.readyCheck;
      if (!rc || rc.state !== 'InProgress') return;
      if (rc.timer + 1 >= this.windowSec) {
        this.log('Pop expired: nobody accepted (the real client would remove you from queue)');
        this.endReadyCheck('Lobby');
        return;
      }
      rc.timer += 1;
      this.emitReadyCheck();
    }, this.tickMs);
  }

  /** The player answers, as if they clicked in the client (or the bridge called the endpoint). */
  respond(answer: 'Accepted' | 'Declined') {
    const rc = this.readyCheck;
    if (!rc || rc.state !== 'InProgress' || rc.playerResponse !== 'None') return false;
    rc.playerResponse = answer;
    this.emitReadyCheck();
    this.log(`Player ${answer.toLowerCase()} at ${rc.timer}s`);

    if (answer === 'Accepted') {
      // Bots/others accept instantly in this fake; the real client goes InProgress -> EveryoneReady -> Delete.
      setTimeout(() => {
        if (this.readyCheck !== rc) return;
        rc.state = 'EveryoneReady';
        this.emitReadyCheck();
        this.endReadyCheck('ChampSelect');
      }, 120);
    } else {
      this.endReadyCheck('Lobby');
    }
    return true;
  }

  /** Me + party members (by puuid). Their names are only available via the summoner lookup. */
  setLobby(memberPuuids: string[]) {
    const member = (puuid: string, i: number) => ({
      puuid,
      isLeader: i === 0,
      isBot: false,
      ready: true,
      summonerIconId: 1,
      summonerLevel: 30,
      firstPositionPreference: '',
      secondPositionPreference: '',
    });
    this.lobby = {
      partyId: 'fake-party',
      canStartActivity: true,
      gameConfig: { queueId: 400, showPositionSelector: true, maxLobbySize: 5 },
      localMember: member(FakeLcu.ME.puuid, 0),
      members: [member(FakeLcu.ME.puuid, 0), ...memberPuuids.map((p, i) => member(p, i + 1))],
    };
    this.setPhase('Lobby');
    this.emit('/lol-lobby/v2/lobby', 'Update', this.lobby);
  }

  /** Champion select + rune pages (see fakeChampSelect.ts). */
  readonly champ = new FakeChampSelect(
    (uri, type, data) => this.emit(uri, type, data),
    (phase) => this.setPhase(phase),
  );
  /** Request bodies the bridge sent, in order. Handy in tests. */
  readonly bodies: { route: string; body: unknown }[] = [];

  static readonly ME = { puuid: 'me-puuid', gameName: 'FakeMe', tagLine: 'EUW', profileIconId: 7 };
  /** Names the fake knows for /lol-summoner/v2/summoners/puuid/{puuid}. */
  readonly summoners = new Map<string, { gameName: string; tagLine: string }>();
  private lobby: unknown = null;

  // --- internals -----------------------------------------------------------------------------

  private endReadyCheck(nextPhase: string) {
    this.clearTimers();
    this.readyCheck = null;
    this.emit(READY_CHECK_URI, 'Delete', null);
    this.setPhase(nextPhase);
  }

  private emitReadyCheck() {
    if (this.readyCheck) this.emit(READY_CHECK_URI, 'Update', { ...this.readyCheck, dodgeWarning: 'None', suppressUx: false });
  }

  private emit(uri: string, eventType: string, data: unknown) {
    const frame = JSON.stringify([8, 'OnJsonApiEvent', { uri, eventType, data }]);
    for (const ws of this.subscribers) ws.send(frame);
  }

  private clearTimers() {
    if (this.tick) clearInterval(this.tick);
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.tick = null;
    this.queueTimer = null;
  }

  private authorized(req: IncomingMessage) {
    const expected = 'Basic ' + Buffer.from(`riot:${this.password}`).toString('base64');
    return req.headers.authorization === expected;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (!this.authorized(req)) return send(401, { errorCode: 'UNAUTHORIZED', httpStatus: 401, message: 'Unauthorized' });

    const route = `${req.method} ${req.url}`;
    this.requests.push(route);

    let body: unknown = null;
    if (req.method !== 'GET') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        return send(400, { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'Invalid JSON' });
      }
    }
    this.bodies.push({ route, body });

    const champ = this.champ.handle(req.method ?? 'GET', req.url ?? '/', body);
    if (champ) return send(champ.status, champ.data);

    if (route === 'GET /lol-game-data/assets/v1/champion-summary.json') {
      return send(200, [{ id: -1, name: 'None' }, ...this.champ.bannable.map((id) => ({ id, name: `Hero${id}` }))]);
    }

    const lookup = /^GET \/lol-summoner\/v2\/summoners\/puuid\/(.+)$/.exec(route);
    if (lookup) {
      const s = this.summoners.get(decodeURIComponent(lookup[1]!));
      return s ? send(200, { ...s, puuid: lookup[1] }) : send(404, NOT_FOUND);
    }
    if (route.startsWith('GET /lol-game-data/assets/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.from(`fake image for ${req.url}`));
    }

    switch (route) {
      case 'GET /lol-summoner/v1/current-summoner':
        return send(200, FakeLcu.ME);
      case 'GET /lol-lobby/v2/lobby':
        return this.lobby ? send(200, this.lobby) : send(404, NOT_FOUND);
      case `GET ${PHASE_URI}`:
        return send(200, this.phase);
      case `GET ${READY_CHECK_URI}`:
        return this.readyCheck ? send(200, this.readyCheck) : send(404, NOT_FOUND);
      case `POST ${READY_CHECK_URI}/accept`:
      case `POST ${READY_CHECK_URI}/decline`:
        if (!this.readyCheck) return send(404, NOT_FOUND);
        this.respond(route.endsWith('accept') ? 'Accepted' : 'Declined');
        return send(204);
      default:
        return send(404, NOT_FOUND);
    }
  }
}
