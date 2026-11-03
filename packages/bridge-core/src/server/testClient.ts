/** Test helper: a minimal phone that records what the bridge sends. DEV ONLY. */
import { PROTOCOL_VERSION, WS_PATH, type BridgeMessage } from '@league-remote/protocol';
import WebSocket from 'ws';

export interface TestPhone {
  ws: WebSocket;
  messages: BridgeMessage[];
  /** Resolves with the next message of this type (or one already received and not yet taken). */
  next<T extends BridgeMessage['type']>(type: T, timeoutMs?: number): Promise<Extract<BridgeMessage, { type: T }>>;
  send(msg: object): void;
  closed: Promise<{ code: number; reason: string }>;
}

export function connectPhone(port: number): Promise<TestPhone> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
  const messages: BridgeMessage[] = [];
  const taken = new Set<BridgeMessage>();
  const waiters: (() => void)[] = [];
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );

  const phone: TestPhone = {
    ws,
    messages,
    closed,
    send: (msg) => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg })),
    next: (type, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "${type}" message within ${timeoutMs}ms`)), timeoutMs);
        const check = () => {
          const found = messages.find((m) => m.type === type && !taken.has(m));
          if (!found) return void waiters.push(check);
          taken.add(found);
          clearTimeout(timer);
          resolve(found as never);
        };
        check();
      }),
  };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(phone));
    ws.once('error', reject);
  });
}
