import WebSocket from 'ws';
import type { LcuCredentials } from './credentials';
import { basicAuthHeader } from './http';

/** One event from the client's event stream. */
export interface LcuEvent {
  uri: string;
  eventType: 'Create' | 'Update' | 'Delete' | string;
  data: unknown;
}

/**
 * The client speaks WAMP 1.0 over WebSocket. We only use two message types:
 *   5 = SUBSCRIBE  -> we send  [5, "OnJsonApiEvent"]
 *   8 = EVENT      -> we get   [8, "OnJsonApiEvent", { uri, eventType, data }]
 */
export function parseWampEvent(raw: string): LcuEvent | null {
  if (!raw) return null; // the client sends an empty frame right after connecting
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(msg) || msg[0] !== 8 || msg[1] !== 'OnJsonApiEvent') return null;
  const payload = msg[2] as Partial<LcuEvent> | undefined;
  if (!payload || typeof payload.uri !== 'string') return null;
  return { uri: payload.uri, eventType: String(payload.eventType), data: payload.data ?? null };
}

/** Opens the event socket and subscribes to everything. Resolves once subscribed. */
export function openLcuSocket(creds: LcuCredentials, onEvent: (e: LcuEvent) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${creds.port}/`, {
      headers: { Authorization: basicAuthHeader(creds.password) },
      // Same reasoning as LcuHttp: self-signed cert, verification off for this socket only.
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
    });

    const onOpenError = (err: Error) => reject(new Error(err.message));
    ws.once('error', onOpenError);

    ws.once('open', () => {
      ws.off('error', onOpenError);
      ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
      resolve(ws);
    });

    ws.on('message', (buf) => {
      const event = parseWampEvent(buf.toString());
      if (event) onEvent(event);
    });
  });
}
