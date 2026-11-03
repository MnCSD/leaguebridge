import type { BridgeState, Command } from '@league-remote/protocol';
import type { Logger } from 'pino';
import { ChampSelectCommands } from './champselect/commands';
import type { PerkStyle } from './champselect/runes';
import { CommandError } from './server/errors';
import type { AssetResponse } from './server/phoneServer';
import { URIS } from './state/reducer';
import { AutoAccepter, READY_CHECK_URI, type AutoAcceptSettings, type ReadyCheck } from './gameflow/autoAccept';
import { PHASE_URI, PhaseTracker } from './gameflow/phase';
import { LcuConnector } from './lcu/connector';
import type { LcuHttp } from './lcu/http';
import type { LcuEvent } from './lcu/socket';
import { Replayer, type ReplayOptions } from './mock/replayer';
import type { Recorder } from './record/recorder';
import { StateStore } from './state/store';

export interface BridgeOptions {
  leaguePath: string;
  log: Logger;
  autoAccept: AutoAcceptSettings;
  recorder?: Recorder | null;
  /** Replay a recording instead of talking to the real client. */
  mock?: ReplayOptions;
  /** How often to look for the lockfile while the client is closed. */
  pollMs?: number;
  /** Called for every raw client event (after the bridge has handled it). */
  onEvent?: (event: LcuEvent) => void;
  /** Called whenever BridgeState actually changes. */
  onStateChange?: (state: BridgeState, prev: BridgeState) => void;
  /** Mock mode only: called when the recording has finished playing. */
  onMockEnd?: () => void;
}

/** Read-only GETs taken on every connect, so we (and the recording) know the starting state. */
const SNAPSHOT_URIS = [
  PHASE_URI,
  READY_CHECK_URI,
  '/lol-lobby/v2/lobby',
  '/lol-matchmaking/v1/search',
  '/lol-champ-select/v1/session',
  '/lol-perks/v1/pages',
  '/lol-perks/v1/currentpage',
  '/lol-summoner/v1/current-summoner',
];

/**
 * The bridge's core, with no UI: keeps the client connection alive (or replays a recording),
 * maintains BridgeState and runs auto-accept. The terminal CLI, the tests and (later) the
 * Electron app all drive this same class.
 */
export class Bridge {
  readonly phase: PhaseTracker;
  readonly autoAccepter: AutoAccepter;
  readonly store: StateStore;
  private http: LcuHttp | null = null;
  private clientConnected = false;
  private secretList: string[] = [];
  private readonly source: LcuConnector | Replayer;
  /** puuid -> "Name#TAG" for lobby members (null while a lookup is running or failed). */
  private readonly names = new Map<string, string | null>();
  /** Champion id -> name, for readable error messages. Loaded once per connection. */
  private championNames = new Map<number, string>();
  private perkStyles: Promise<PerkStyle[] | null> | null = null;
  private readonly champSelect = new ChampSelectCommands({
    getState: () => this.state,
    request: (method, path, body) => this.clientRequest(method, path, body),
    championName: (id) => this.championNames.get(id) ?? `Champion ${id}`,
    perkStyles: () => this.loadPerkStyles(),
  });

  constructor(private readonly opts: BridgeOptions) {
    const { log } = opts;

    this.phase = new PhaseTracker((now, before) => log.info(`Phase: ${before ?? '?'} -> ${now}`));
    this.autoAccepter = new AutoAccepter(opts.autoAccept, () => this.acceptReadyCheck(), log);
    this.store = new StateStore((state, prev) => {
      this.lookUpLobbyNames(state);
      opts.onStateChange?.(state, prev);
    });

    if (opts.mock) {
      this.source = new Replayer(opts.mock, {
        onConnected: () => this.handleConnected(),
        onDisconnected: () => this.handleDisconnected(),
        onUpdate: (uri, data) => this.apply(uri, data),
        onEvent: (uri, eventType, data) => opts.onEvent?.({ uri, eventType, data }),
        onEnd: () => opts.onMockEnd?.(),
      });
    } else {
      this.source = new LcuConnector(
        { leaguePath: opts.leaguePath, log, pollMs: opts.pollMs },
        {
          onConnected: async (http, creds) => {
            this.http = http;
            this.secretList = [creds.password];
            opts.recorder?.setSecrets(this.secretList);
            opts.recorder?.write({ kind: 'connected' });
            this.handleConnected();
            await this.takeSnapshots(http);
            void this.loadChampionNames(http);
          },
          onDisconnected: () => {
            this.http = null;
            opts.recorder?.write({ kind: 'disconnected' });
            this.handleDisconnected();
          },
          onEvent: (e) => {
            opts.recorder?.write({ kind: 'event', uri: e.uri, eventType: e.eventType, data: e.data });
            this.apply(e.uri, e.eventType === 'Delete' ? null : e.data);
            opts.onEvent?.(e);
          },
        },
      );
    }
  }

  get connected() {
    return this.clientConnected;
  }

  get state(): BridgeState {
    return this.store.state;
  }

  /** Strings that must never be printed or stored (the current client password). */
  get secrets(): readonly string[] {
    return this.secretList;
  }

  /** Runs until stop() (or, in mock mode without loop, until the recording ends). Never rejects. */
  start(): Promise<void> {
    return this.source.run();
  }

  stop() {
    this.autoAccepter.reset();
    this.source.stop();
  }

  private handleConnected() {
    this.clientConnected = true;
    this.store.setClient('connected');
  }

  private handleDisconnected() {
    this.clientConnected = false;
    this.names.clear();
    this.perkStyles = null;
    this.phase.reset();
    this.autoAccepter.reset();
    this.store.setClient('disconnected');
  }

  private async acceptReadyCheck() {
    await this.clientRequest('POST', '/lol-matchmaking/v1/ready-check/accept');
    this.opts.log.info('Match accepted');
  }

  // --- phone commands ------------------------------------------------------------------------

  /** Runs a command from the phone. Throws CommandError with a clear reason if it can't. */
  async handleCommand(command: Command): Promise<void> {
    switch (command.type) {
      case 'accept':
      case 'decline': {
        const rc = this.state.readyCheck;
        if (!rc || rc.state !== 'InProgress') throw new CommandError('INVALID_STATE', 'There is no match to accept or decline right now');
        if (rc.response !== 'None') throw new CommandError('INVALID_STATE', `You already ${rc.response.toLowerCase()} this match`);
        await this.clientRequest('POST', `/lol-matchmaking/v1/ready-check/${command.type}`);
        return;
      }
      default:
        return this.champSelect.run(command);
    }
  }

  /** Champion names from the client's game data, for error messages. Failure is fine: ids are used. */
  private async loadChampionNames(http: LcuHttp) {
    try {
      const res = await http.get<{ id: number; name: string }[]>('/lol-game-data/assets/v1/champion-summary.json');
      if (res.status === 200 && Array.isArray(res.data)) {
        this.championNames = new Map(res.data.filter((c) => c.id > 0).map((c) => [c.id, c.name]));
      }
    } catch (err) {
      this.opts.log.debug({ err: (err as Error).message }, 'Could not load champion names');
    }
  }

  /** Rune paths for validating saved pages; loaded on first use, once per connection. */
  private loadPerkStyles(): Promise<PerkStyle[] | null> {
    const http = this.http;
    if (!http) return Promise.resolve(null);
    this.perkStyles ??= http
      .get<PerkStyle[]>('/lol-perks/v1/styles')
      .then((res) => (res.status === 200 && Array.isArray(res.data) ? res.data : null))
      .catch(() => null);
    return this.perkStyles;
  }

  /** For the phone server's /assets proxy. Only /lol-game-data/... paths reach this. */
  async fetchAsset(lcuPath: string): Promise<AssetResponse> {
    if (!this.http) {
      throw new CommandError('NOT_CONNECTED', this.opts.mock ? 'Images need the real League client (mock mode has none)' : 'League client is not running');
    }
    return this.http.getRaw(lcuPath);
  }

  /** A write request to the client, with the errors the phone should see. Mock mode only logs. */
  private async clientRequest(method: string, path: string, body?: unknown) {
    if (this.opts.mock) {
      this.opts.log.info(`[mock] Would send ${method} ${path} (no real client)`);
      return;
    }
    if (!this.http) throw new CommandError('NOT_CONNECTED', 'League client is not running');
    const res = await this.http.request<{ message?: string }>(method, path, body);
    if (res.status >= 300) {
      throw new CommandError('CLIENT_ERROR', `League client refused (HTTP ${res.status})${res.data?.message ? `: ${res.data.message}` : ''}`);
    }
  }

  /** Lobby payloads have no names for other members; fetch each unknown one once. */
  private lookUpLobbyNames(state: BridgeState) {
    const http = this.http;
    if (!http || !state.lobby) return;
    for (const m of state.lobby.members) {
      if (m.name || m.isBot || !m.puuid || this.names.has(m.puuid)) continue;
      this.names.set(m.puuid, null); // mark as in flight, so it's only requested once
      http
        .get<{ gameName?: string; tagLine?: string }>(`/lol-summoner/v2/summoners/puuid/${encodeURIComponent(m.puuid)}`)
        .then((res) => {
          if (res.status !== 200 || !res.data?.gameName) {
            this.opts.log.debug({ status: res.status }, 'Lobby member name lookup failed');
            return;
          }
          this.names.set(m.puuid, res.data.tagLine ? `${res.data.gameName}#${res.data.tagLine}` : res.data.gameName);
          const known = Object.fromEntries([...this.names].filter((e): e is [string, string] => e[1] !== null));
          this.store.update(URIS.names, known);
        })
        .catch((err: Error) => this.opts.log.debug({ err: err.message }, 'Lobby member name lookup failed'));
    }
  }

  private async takeSnapshots(http: LcuHttp) {
    for (const uri of SNAPSHOT_URIS) {
      try {
        const res = await http.get(uri);
        this.opts.recorder?.write({ kind: 'snapshot', uri, status: res.status, data: res.data });
        // A 404 means "doesn't exist right now" (no lobby, no pop, ...).
        this.apply(uri, res.status === 200 ? res.data : null);
      } catch (err) {
        this.opts.log.warn({ uri, err: (err as Error).message }, 'Snapshot request failed');
      }
    }
  }

  /** One place where snapshots, live events and replayed events all update our state. */
  private apply(uri: string, data: unknown) {
    // Phase first, so "Phase: X -> Y" is logged before the state changes it causes.
    if (uri === PHASE_URI) this.phase.set(data);
    this.store.update(uri, data);
    if (uri === READY_CHECK_URI) this.autoAccepter.onReadyCheck(data as ReadyCheck | null);
  }
}
