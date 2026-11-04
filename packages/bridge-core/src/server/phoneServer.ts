import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ASSETS_PATH,
  CLOSE_CODES,
  Command,
  Hello,
  PROTOCOL_VERSION,
  WS_PATH,
  type BridgeMessage,
  type BridgeState,
  type ErrorCode,
  type PairingInfo,
} from '@league-remote/protocol';
import type { Logger } from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ConfigStore, PairedDevice } from './config';
import { CommandError } from './errors';
import { isPrivateAddress, lanAddresses } from './network';
import { PairingCodes, hashToken, newDeviceToken, tokenMatches } from './pairing';
import { PushNotifier, isExpoPushToken, type SendPush } from './push';

export interface AssetResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

export interface PhoneServerOptions {
  config: ConfigStore;
  log: Logger;
  /** Shown to the phone, e.g. the PC's name. */
  bridgeName: string;
  getState: () => BridgeState;
  /** Runs a validated command. Throw CommandError for a clean error reply. */
  handleCommand: (command: Command, device: PairedDevice) => Promise<void>;
  /** GETs a /lol-game-data/... path from the League client. */
  fetchAsset: (lcuPath: string) => Promise<AssetResponse>;
  /** Interface to listen on. Default: all (0.0.0.0) so phones on the LAN can reach it. */
  host?: string;
  /** Overrides the configured port (0 = pick a free one, for tests). */
  port?: number;
  authTimeoutMs?: number;
  /** For tests: decides which remote addresses count as "local network". */
  isLocalAddress?: (address: string | undefined) => boolean;
  now?: () => number;
  /** Something the desktop UI may want to redraw: devices, connections or the pairing code changed. */
  onChange?: () => void;
  /** For tests: replaces the call to Expo's push service. */
  sendPush?: SendPush;
}

interface Client {
  ws: WebSocket;
  address: string;
  device: PairedDevice | null;
  alive: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
}

const ASSET_PREFIX = '/lol-game-data/assets/';
const MAX_CACHE_BYTES = 150 * 1024 * 1024;
const STATE_THROTTLE_MS = 100;

/**
 * The server phones connect to. Everything except /health needs a paired device:
 *  - WebSocket at /ws: hello (pair or auth) first, then state + commands
 *  - GET /assets/lol-game-data/...: game images/data, proxied from the client (Bearer token)
 */
export class PhoneServer {
  readonly pairing: PairingCodes;
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<Client>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly assetCache = new Map<string, AssetResponse>();
  private assetCacheBytes = 0;
  private port = 0;
  private readonly push: PushNotifier;

  constructor(private readonly opts: PhoneServerOptions) {
    this.pairing = new PairingCodes(opts.now);
    this.push = new PushNotifier({ config: opts.config, log: opts.log, send: opts.sendPush });
    this.http = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((err) => {
        opts.log.warn({ err: (err as Error).message }, 'HTTP handler failed');
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    // noServer: we decide in 'upgrade' whether to accept, so other paths and networks are refused early.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.http.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== WS_PATH) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
    });
  }

  // --- lifecycle -----------------------------------------------------------------------------

  async start(): Promise<number> {
    const port = this.opts.port ?? this.opts.config.get().port;
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(port, this.opts.host ?? '0.0.0.0', () => {
        this.http.off('error', reject);
        resolve();
      });
    });
    this.port = (this.http.address() as AddressInfo).port;
    // Ping every 15s; a phone that doesn't answer (Wi-Fi dropped) is cut off.
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, 15_000);
    return this.port;
  }

  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    for (const c of this.clients) c.ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // --- what the CLI / desktop app uses ---------------------------------------------------------

  /** The port actually listened on (after start()). */
  get listeningPort() {
    return this.port;
  }

  /** Creates a new pairing code (the old one stops working) and returns what goes in the QR code. */
  newPairingCode(): PairingInfo {
    const { code } = this.pairing.issue();
    this.opts.onChange?.();
    return this.pairingInfoFor(code);
  }

  /** The current pairing info, or null if there's no valid code. */
  pairingInfo(): PairingInfo | null {
    const current = this.pairing.current();
    return current ? this.pairingInfoFor(current.code) : null;
  }

  connectedDevices(): { id: string; name: string; address: string }[] {
    return [...this.clients].filter((c) => c.device).map((c) => ({ id: c.device!.id, name: c.device!.name, address: c.address }));
  }

  removeDevice(deviceId: string) {
    this.opts.config.update((c) => {
      c.devices = c.devices.filter((d) => d.id !== deviceId);
    });
    for (const c of this.clients) if (c.device?.id === deviceId) c.ws.close(CLOSE_CODES.deviceRemoved, 'Device removed on the PC');
    this.opts.onChange?.();
  }

  /** Call on every state change. Sends are merged so phones get at most ~10 per second. */
  publishState() {
    this.push.onState(this.opts.getState());
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      for (const c of this.clients) if (c.device) this.sendState(c);
    }, STATE_THROTTLE_MS);
  }

  // --- WebSocket -----------------------------------------------------------------------------

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const address = req.socket.remoteAddress ?? '';
    const { log } = this.opts;

    if (!this.addressAllowed(address)) {
      log.warn({ address }, 'Rejected phone connection from outside the local network');
      ws.close(CLOSE_CODES.forbiddenNetwork, 'Local network only');
      return;
    }

    const client: Client = { ws, address, device: null, alive: true, authTimer: null };
    this.clients.add(client);
    client.authTimer = setTimeout(() => ws.close(CLOSE_CODES.authTimeout, 'No hello received'), this.opts.authTimeoutMs ?? 5000);

    ws.on('pong', () => (client.alive = true));
    ws.on('error', (err) => log.debug({ err: err.message }, 'Phone socket error'));
    ws.on('close', () => {
      if (client.authTimer) clearTimeout(client.authTimer);
      this.clients.delete(client);
      if (client.device) {
        log.info(`Phone disconnected: ${client.device.name}`);
        this.opts.onChange?.();
      }
    });
    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return this.fail(client, 'BAD_MESSAGE', 'Not valid JSON', undefined, CLOSE_CODES.badMessage);
      }
      if (!client.device) this.onHello(client, msg);
      else void this.onCommand(client, msg);
    });
  }

  private onHello(client: Client, msg: unknown) {
    const { config, log } = this.opts;
    const hello = Hello.safeParse(msg);
    if (!hello.success || (!hello.data.pair && !hello.data.auth)) {
      return this.fail(client, 'BAD_MESSAGE', 'First message must be a valid hello', undefined, CLOSE_CODES.badMessage);
    }

    if (hello.data.pair) {
      const { code, deviceName } = hello.data.pair;
      const check = this.pairing.redeem(code);
      if (check === 'locked') {
        return this.fail(client, 'RATE_LIMITED', 'Too many wrong codes. Create a new pairing code on the PC.', undefined, CLOSE_CODES.unauthorized);
      }
      if (check !== 'ok') {
        const why = check === 'wrong' ? 'Wrong pairing code' : 'No valid pairing code. Create a new one on the PC.';
        log.warn({ address: client.address, check }, 'Pairing attempt failed');
        return this.fail(client, 'UNAUTHORIZED', why, undefined, CLOSE_CODES.unauthorized);
      }
      const token = newDeviceToken();
      const device: PairedDevice = {
        id: randomUUID(),
        name: deviceName,
        tokenHash: hashToken(token),
        pairedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      config.update((c) => c.devices.push(device));
      log.info(`Paired new phone: ${deviceName}`);
      this.authenticate(client, device, token);
      return;
    }

    const { deviceId, token } = hello.data.auth!;
    const device = config.get().devices.find((d) => d.id === deviceId);
    if (!device || !tokenMatches(token, device.tokenHash)) {
      log.warn({ address: client.address }, 'Phone authentication failed');
      return this.fail(client, 'UNAUTHORIZED', 'Unknown device or token. Pair again.', undefined, CLOSE_CODES.unauthorized);
    }
    config.update(() => (device.lastSeenAt = new Date().toISOString()));
    this.authenticate(client, device);
  }

  private authenticate(client: Client, device: PairedDevice, newToken?: string) {
    if (client.authTimer) clearTimeout(client.authTimer);
    client.authTimer = null;
    client.device = device;
    const { config, bridgeName, log } = this.opts;
    this.send(client, {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      bridgeId: config.get().bridgeId,
      bridgeName,
      deviceId: device.id,
      ...(newToken ? { token: newToken } : {}),
    });
    this.sendState(client);
    if (!newToken) log.info(`Phone connected: ${device.name}`);
    this.opts.onChange?.();
  }

  private async onCommand(client: Client, msg: unknown) {
    const id = typeof (msg as { id?: unknown })?.id === 'string' ? ((msg as { id: string }).id) : undefined;
    const parsed = Command.safeParse(msg);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return this.fail(client, 'BAD_MESSAGE', `Invalid command${issue ? `: ${issue.path.join('.') || 'message'} ${issue.message}` : ''}`, id);
    }
    const command = parsed.data;
    this.opts.log.info(`Phone ${client.device!.name}: ${command.type}`);
    try {
      if (command.type === 'registerPush') this.registerPush(client.device!, command.token);
      else await this.opts.handleCommand(command, client.device!);
      this.send(client, { v: PROTOCOL_VERSION, type: 'result', id: command.id, ok: true });
    } catch (err) {
      const e = err instanceof CommandError ? err : new CommandError('CLIENT_ERROR', (err as Error).message);
      this.opts.log.warn({ code: e.code }, `Command ${command.type} failed: ${e.message}`);
      this.fail(client, e.code, e.message, command.id);
    }
  }

  /** Push notifications belong to the device that asked, so the server handles this one itself. */
  private registerPush(device: PairedDevice, token: string | null) {
    if (token !== null && !isExpoPushToken(token)) throw new CommandError('BAD_MESSAGE', "That isn't an Expo push token");
    this.opts.config.update((c) => {
      const d = c.devices.find((x) => x.id === device.id);
      if (!d) return;
      if (token) d.pushToken = token;
      else delete d.pushToken;
    });
    this.opts.log.info(`Notifications ${token ? 'on' : 'off'} for ${device.name}`);
    this.opts.onChange?.();
  }

  private sendState(client: Client) {
    this.send(client, { v: PROTOCOL_VERSION, type: 'state', state: this.opts.getState(), now: Date.now() });
  }

  private send(client: Client, msg: BridgeMessage) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private fail(client: Client, code: ErrorCode, message: string, id?: string, closeCode?: number) {
    this.send(client, { v: PROTOCOL_VERSION, type: 'error', code, message, ...(id ? { id } : {}) });
    if (closeCode) client.ws.close(closeCode, message.slice(0, 120));
  }

  // --- HTTP: /health and /assets ---------------------------------------------------------------

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!this.addressAllowed(req.socket.remoteAddress)) return void res.writeHead(403).end();
    if (req.method !== 'GET') return void res.writeHead(405).end();

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ ok: true, bridgeId: this.opts.config.get().bridgeId, protocol: PROTOCOL_VERSION }));
    }

    if (url.pathname.startsWith(ASSETS_PATH + '/')) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token || !this.opts.config.get().devices.some((d) => tokenMatches(token, d.tokenHash))) {
        return void res.writeHead(401).end();
      }
      // url.pathname is already normalised by URL (no "..", no "./"), but check anyway.
      const lcuPath = url.pathname.slice(ASSETS_PATH.length);
      if (!lcuPath.startsWith(ASSET_PREFIX) || lcuPath.includes('..') || url.search) return void res.writeHead(404).end();
      return this.serveAsset(lcuPath, res);
    }

    res.writeHead(404).end();
  }

  private async serveAsset(lcuPath: string, res: ServerResponse) {
    let asset = this.assetCache.get(lcuPath);
    if (!asset) {
      try {
        asset = await this.opts.fetchAsset(lcuPath);
      } catch (err) {
        const code = err instanceof CommandError ? err.code : 'CLIENT_ERROR';
        res.writeHead(code === 'NOT_CONNECTED' ? 503 : 502, { 'Content-Type': 'text/plain' });
        return void res.end((err as Error).message);
      }
      if (asset.status === 200) this.cacheAsset(lcuPath, asset);
    }
    res.writeHead(asset.status, {
      'Content-Type': asset.contentType,
      // Game assets only change with a patch; let the phone keep them for a day.
      'Cache-Control': asset.status === 200 ? 'private, max-age=86400' : 'no-store',
    });
    res.end(asset.body);
  }

  private cacheAsset(path: string, asset: AssetResponse) {
    if (asset.body.length > 10 * 1024 * 1024) return;
    this.assetCache.set(path, asset);
    this.assetCacheBytes += asset.body.length;
    // Maps remember insertion order, so the first key is the oldest.
    for (const [oldPath, old] of this.assetCache) {
      if (this.assetCacheBytes <= MAX_CACHE_BYTES) break;
      this.assetCache.delete(oldPath);
      this.assetCacheBytes -= old.body.length;
    }
  }

  // --- helpers -------------------------------------------------------------------------------

  private addressAllowed(address: string | undefined) {
    if (!this.opts.config.get().localNetworkOnly) return true;
    return (this.opts.isLocalAddress ?? isPrivateAddress)(address);
  }

  private pairingInfoFor(code: string): PairingInfo {
    return { host: lanAddresses()[0] ?? '127.0.0.1', port: this.port, code, bridgeId: this.opts.config.get().bridgeId };
  }
}
