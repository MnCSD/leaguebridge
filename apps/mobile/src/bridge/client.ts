/**
 * One WebSocket to the PC bridge (see packages/protocol/src/messages.ts for the flow).
 *
 * - pair(): first connection with the 6-digit code; resolves with the token to store.
 * - connect(): later connections with the stored token; reconnects on its own with backoff
 *   until stop() is called or the bridge says the device is no longer allowed.
 * - send(): a command; resolves on `result`, rejects with a CommandFailed on `error`.
 */
import {
  BridgeMessage,
  CLOSE_CODES,
  PROTOCOL_VERSION,
  WS_PATH,
  type BridgeState,
  type Command,
  type ErrorCode,
} from '@league-remote/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'unauthorized';

/** Each command type without the `v` and `id` the client adds. */
export type CommandInput = Command extends infer C ? (C extends Command ? Omit<C, 'v' | 'id'> : never) : never;

export class CommandFailed extends Error {
  constructor(
    readonly code: ErrorCode | 'TIMEOUT' | 'OFFLINE',
    message: string,
  ) {
    super(message);
  }
}

export interface ClientEvents {
  status(status: ConnectionStatus): void;
  /** `offsetMs`: add to Date.now() to get the bridge's clock. */
  state(state: BridgeState, offsetMs: number): void;
  welcome(bridgeName: string): void;
}

interface Target {
  host: string;
  port: number;
}

const COMMAND_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1000, 2000, 5000, 10_000];

const wsUrl = ({ host, port }: Target) => `ws://${host}:${port}${WS_PATH}`;

/** Pairs with the code shown on the PC. Resolves with the device credentials. */
export function pair(target: Target, code: string, deviceName: string) {
  return new Promise<{ deviceId: string; token: string; bridgeId: string; bridgeName: string }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl(target));
    let done = false;
    const finish = (err: Error | null, value?: Parameters<typeof resolve>[0]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("Couldn't reach your PC. Is League Remote open, on the same Wi-Fi?")), 8000);

    ws.onopen = () => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'hello', pair: { code, deviceName: deviceName.slice(0, 64) } }));
    ws.onmessage = (e) => {
      const msg = parse(e.data);
      if (msg?.type === 'welcome' && msg.token) {
        finish(null, { deviceId: msg.deviceId, token: msg.token, bridgeId: msg.bridgeId, bridgeName: msg.bridgeName });
      } else if (msg?.type === 'error') {
        finish(new Error(msg.code === 'RATE_LIMITED' ? 'Too many wrong codes. Wait a moment and try a new code.' : msg.message));
      }
    };
    ws.onerror = () => finish(new Error("Couldn't reach your PC. Is League Remote open, on the same Wi-Fi?"));
    ws.onclose = (e) => {
      if (e.code === CLOSE_CODES.unauthorized) finish(new Error('That code is wrong or expired. Check the code on your PC.'));
      else if (e.code === CLOSE_CODES.forbiddenNetwork) finish(new Error('The PC only accepts phones on its local network.'));
      else finish(new Error('The PC closed the connection.'));
    };
  });
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private pending = new Map<string, { resolve(): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly target: Target & { deviceId: string; token: string },
    private readonly on: ClientEvents,
  ) {}

  connect() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.failPending('OFFLINE', 'Disconnected');
  }

  /** Reconnect right away (e.g. the app came back to the foreground). */
  wake() {
    if (this.stopped || this.ws) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.open();
  }

  send(command: CommandInput): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new CommandFailed('OFFLINE', 'Not connected to your PC'));
    const id = `c${this.nextId++}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CommandFailed('TIMEOUT', 'Your PC did not answer in time'));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, ...command }));
    });
  }

  private open() {
    this.on.status('connecting');
    const ws = new WebSocket(wsUrl(this.target));
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'hello', auth: { deviceId: this.target.deviceId, token: this.target.token } }));
    };
    ws.onmessage = (e) => this.handle(parse(e.data));
    ws.onerror = () => {}; // onclose follows and handles it
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending('OFFLINE', 'Lost the connection to your PC');
      if (e.code === CLOSE_CODES.unauthorized || e.code === CLOSE_CODES.deviceRemoved) {
        this.stopped = true;
        this.on.status('unauthorized');
        return;
      }
      if (this.stopped) return;
      this.on.status('offline');
      const delay = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]!;
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private handle(msg: BridgeMessage | null) {
    if (!msg) return;
    switch (msg.type) {
      case 'welcome':
        this.attempt = 0;
        this.on.status('connected');
        this.on.welcome(msg.bridgeName);
        break;
      case 'state':
        this.on.state(msg.state, msg.now - Date.now());
        break;
      case 'result':
        this.settle(msg.id, null);
        break;
      case 'error':
        if (msg.id) this.settle(msg.id, new CommandFailed(msg.code, msg.message));
        break;
    }
  }

  private settle(id: string, err: Error | null) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (err) p.reject(err);
    else p.resolve();
  }

  private failPending(code: 'OFFLINE', message: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CommandFailed(code, message));
      this.pending.delete(id);
    }
  }
}

function parse(data: unknown): BridgeMessage | null {
  try {
    const parsed = BridgeMessage.safeParse(JSON.parse(String(data)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
