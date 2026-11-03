/**
 * Messages between the phone and the bridge, over one WebSocket (ws://<pc>:4242/ws).
 *
 * Flow:
 *   phone  -> hello { pair: { code, deviceName } }      first time, with the 6-digit code
 *   bridge -> welcome { deviceId, token, ... }           token: store it, it's shown only once
 *   (later connections)
 *   phone  -> hello { auth: { deviceId, token } }
 *   bridge -> welcome { deviceId, ... }
 *   bridge -> state { state, now }                       full snapshot now, again on every change
 *   phone  -> accept { id: "r1" } ...                    commands carry an id you choose
 *   bridge -> result { id: "r1", ok: true }  or  error { id: "r1", code, message }
 *
 * Every message has `v` (protocol version). The bridge closes the socket if the first message
 * isn't a valid hello within 5 seconds.
 */
import { z } from 'zod';
import { BridgeState } from './state';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 4242;
export const WS_PATH = '/ws';
/** Images and game data: GET http://<pc>:4242/assets/lol-game-data/... with `Authorization: Bearer <token>`. */
export const ASSETS_PATH = '/assets';

const V = z.literal(PROTOCOL_VERSION);
const RequestId = z.string().min(1).max(64);
const Id = z.number().int();

/** What a phone scans from the QR code (JSON). */
export const PairingInfo = z.object({
  host: z.string(),
  port: z.number().int(),
  code: z.string().regex(/^\d{6}$/),
  bridgeId: z.string(),
});
export type PairingInfo = z.infer<typeof PairingInfo>;

// --- phone -> bridge -------------------------------------------------------------------------

export const Hello = z.object({
  v: V,
  type: z.literal('hello'),
  pair: z.object({ code: z.string().regex(/^\d{6}$/), deviceName: z.string().min(1).max(64) }).optional(),
  auth: z.object({ deviceId: z.string().min(1).max(64), token: z.string().min(20).max(200) }).optional(),
});
export type Hello = z.infer<typeof Hello>;

const cmd = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ v: V, type: z.literal(type), id: RequestId, ...shape });

export const RunePageInput = z.object({
  name: z.string().min(1).max(60),
  primaryStyleId: Id,
  subStyleId: Id,
  selectedPerkIds: z.array(Id).length(9),
});
export type RunePageInput = z.infer<typeof RunePageInput>;

export const Command = z.discriminatedUnion('type', [
  cmd('accept', {}),
  cmd('decline', {}),
  /** Hover a champion in my current pick (or declare intent before my turn). */
  cmd('hover', { championId: Id }),
  /** Lock in the hovered champion, or this one if given. */
  cmd('lockIn', { championId: Id.optional() }),
  /** Ban a champion (hover + confirm in one go). */
  cmd('ban', { championId: Id }),
  cmd('setSpells', { spell1Id: Id, spell2Id: Id }),
  cmd('setSkin', { skinId: Id }),
  cmd('setRunePage', { pageId: Id }),
  /** Create a page (no pageId) or overwrite one (pageId). */
  cmd('saveRunePage', { pageId: Id.optional(), page: RunePageInput }),
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command['type'];

export const PhoneMessage = z.union([Hello, Command]);
export type PhoneMessage = z.infer<typeof PhoneMessage>;

// --- bridge -> phone -------------------------------------------------------------------------

export const Welcome = z.object({
  v: V,
  type: z.literal('welcome'),
  bridgeId: z.string(),
  bridgeName: z.string(),
  deviceId: z.string(),
  /** Only present right after pairing. Store it securely; the bridge keeps only a hash. */
  token: z.string().optional(),
});
export type Welcome = z.infer<typeof Welcome>;

export const StateMessage = z.object({
  v: V,
  type: z.literal('state'),
  state: BridgeState,
  /** Bridge clock (epoch ms) when sent. Use it to correct `endsAt`/`startedAt` for clock skew. */
  now: z.number(),
});
export type StateMessage = z.infer<typeof StateMessage>;

export const Result = z.object({ v: V, type: z.literal('result'), id: RequestId, ok: z.literal(true) });
export type Result = z.infer<typeof Result>;

export const ERROR_CODES = [
  'BAD_MESSAGE', // not JSON / doesn't match the schema
  'UNAUTHORIZED', // wrong/expired pairing code, unknown device or token
  'RATE_LIMITED', // too many pairing attempts
  'NOT_CONNECTED', // the bridge isn't connected to the League client
  'INVALID_STATE', // e.g. accept with no ready check, hover when it isn't your turn
  'NOT_ALLOWED', // e.g. a champion you can't pick, a skin you don't own
  'CLIENT_ERROR', // the League client rejected the request
  'NOT_IMPLEMENTED', // command exists in the protocol but isn't built yet
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorMessage = z.object({
  v: V,
  type: z.literal('error'),
  /** The command's id, when the error answers a command. */
  id: RequestId.optional(),
  code: ErrorCode,
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof ErrorMessage>;

export const BridgeMessage = z.discriminatedUnion('type', [Welcome, StateMessage, Result, ErrorMessage]);
export type BridgeMessage = z.infer<typeof BridgeMessage>;

/** WebSocket close codes the bridge uses (4000-4999 is the app range). */
export const CLOSE_CODES = {
  badMessage: 4000,
  authTimeout: 4001,
  unauthorized: 4003,
  forbiddenNetwork: 4004,
  deviceRemoved: 4005,
} as const;
