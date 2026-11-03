import type { Logger } from 'pino';
import type WebSocket from 'ws';
import { readFromProcess, readLockfile, type LcuCredentials } from './credentials';
import { LcuHttp } from './http';
import { openLcuSocket, type LcuEvent } from './socket';

export interface ConnectorHandlers {
  onConnected?: (http: LcuHttp, creds: LcuCredentials) => void | Promise<void>;
  onDisconnected?: () => void;
  onEvent?: (event: LcuEvent) => void;
}

export interface ConnectorOptions {
  leaguePath: string;
  log: Logger;
  /** How often to look for the lockfile while the client is closed. */
  pollMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keeps a connection to the League client alive, forever:
 *
 *   wait for credentials -> connect -> (stay connected until the socket closes) -> back off -> repeat
 *
 * The client can start, close or restart at any time, and the port/password change every launch,
 * so credentials are re-read on every attempt. Nothing in here throws out of `run()`.
 */
export class LcuConnector {
  private stopped = false;
  private socket: WebSocket | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly opts: ConnectorOptions,
    private readonly handlers: ConnectorHandlers,
  ) {}

  async run(): Promise<void> {
    const { log } = this.opts;
    const pollMs = this.opts.pollMs ?? 2000;
    let failures = 0;
    let ticks = 0;
    let announcedWaiting = false;

    while (!this.stopped) {
      const creds = await this.findCredentials(ticks++).catch((err: Error) => {
        log.warn({ err: err.message }, 'Could not read League credentials');
        return null;
      });

      if (!creds) {
        if (!announcedWaiting) {
          log.info({ leaguePath: this.opts.leaguePath }, 'Waiting for the League client to start...');
          announcedWaiting = true;
        }
        await this.sleep(pollMs);
        continue;
      }
      announcedWaiting = false;

      const connected = await this.connectOnce(creds);
      if (this.stopped) break;

      // Reset backoff after a real session; otherwise grow it: 1s, 2s, 4s ... capped at 30s.
      failures = connected ? 0 : failures + 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
      if (!connected) log.debug({ delay }, 'Retrying connection');
      await this.sleep(delay);
    }
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.wake?.();
  }

  /** Lockfile first; the process fallback spawns PowerShell, so only try it every ~5 ticks. */
  private async findCredentials(tick: number): Promise<LcuCredentials | null> {
    const fromLockfile = await readLockfile(this.opts.leaguePath);
    if (fromLockfile) return fromLockfile;
    if (tick % 5 === 0) return readFromProcess();
    return null;
  }

  /** Returns true if we got a working connection (even if it later dropped). */
  private async connectOnce(creds: LcuCredentials): Promise<boolean> {
    const { log } = this.opts;
    const http = new LcuHttp(creds);
    try {
      this.socket = await openLcuSocket(creds, (e) => this.safe(() => this.handlers.onEvent?.(e)));
    } catch (err) {
      // Normal while the client is still booting (lockfile exists before the API is ready).
      log.debug({ err: (err as Error).message }, 'League client not reachable yet');
      http.close();
      return false;
    }

    const socket = this.socket;
    log.info({ port: creds.port, source: creds.source }, 'Connected to League client');
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.on('error', (err) => log.warn({ err: err.message }, 'LCU socket error'));
    });

    try {
      await this.handlers.onConnected?.(http, creds);
    } catch (err) {
      log.error({ err: (err as Error).message }, 'onConnected handler failed');
    }

    await closed;
    this.socket = null;
    http.close();
    log.info('Disconnected from League client');
    this.safe(() => this.handlers.onDisconnected?.());
    return true;
  }

  private safe(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.opts.log.error({ err: (err as Error).message }, 'Handler threw');
    }
  }

  /** A sleep that stop() can cut short. */
  private sleep(ms: number) {
    return Promise.race([sleep(ms), new Promise<void>((r) => (this.wake = r))]);
  }
}
