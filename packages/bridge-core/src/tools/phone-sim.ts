/**
 * `npm run phone-sim pair <code> [host] [port]` — a pretend phone, for testing without the app.
 *
 * Pairs with the 6-digit code, then stays connected and lets you type commands:
 *   accept | decline | find | leave | hover <champId> | lock [champId] | ban <champId>
 *   spells <id1> <id2> | skin <skinId> | runes <pageId> | pages | newpage <name>
 *   asset <path>        e.g. asset /lol-game-data/assets/v1/champion-summary.json
 *   state               print the whole current state as JSON
 *   reconnect           drop the connection and log in again with the token (tests token reuse)
 *   quit
 *
 * The device token is kept in memory only (never written to disk). Positional arguments are used
 * instead of --flags because Windows PowerShell eats the `--` npm needs to forward flags.
 */
import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import {
  ASSETS_PATH,
  BridgeMessage,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  WS_PATH,
  type BridgeState,
  type Command,
} from '@league-remote/protocol';
import WebSocket from 'ws';
import { describeState } from '../state/describe';

const [mode, code, host = '127.0.0.1', portArg] = process.argv.slice(2);
const port = Number(portArg ?? DEFAULT_PORT);
if (mode !== 'pair' || !/^\d{6}$/.test(code ?? '')) {
  console.log('Usage: npm run phone-sim pair <6-digit code> [host] [port]');
  process.exit(1);
}

let creds: { deviceId: string; token: string } | null = null;
let ws: WebSocket | null = null;
let state: BridgeState | null = null;
let nextId = 1;
const lastLines: Record<string, string | null> = {};
const say = (msg: string) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);

function connect(first: boolean) {
  ws = new WebSocket(`ws://${host}:${port}${WS_PATH}`);
  ws.on('open', () => {
    const hello = first
      ? { v: PROTOCOL_VERSION, type: 'hello', pair: { code, deviceName: `phone-sim (${hostname()})` } }
      : { v: PROTOCOL_VERSION, type: 'hello', auth: creds };
    ws!.send(JSON.stringify(hello));
  });
  ws.on('message', (raw) => {
    const parsed = BridgeMessage.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) return say(`?? unexpected message: ${raw.toString().slice(0, 200)}`);
    const msg = parsed.data;
    switch (msg.type) {
      case 'welcome':
        if (msg.token) creds = { deviceId: msg.deviceId, token: msg.token };
        say(`${msg.token ? 'Paired with' : 'Logged in to'} "${msg.bridgeName}" as device ${msg.deviceId.slice(0, 8)}`);
        break;
      case 'state':
        state = msg.state;
        for (const [section, line] of Object.entries(describeState(msg.state))) {
          if (line === (lastLines[section] ?? null)) continue;
          lastLines[section] = line;
          say(`[state] ${line ?? `${section}: (none)`}`);
        }
        break;
      case 'result':
        say(`OK (${msg.id})`);
        break;
      case 'error':
        say(`ERROR ${msg.code}${msg.id ? ` (${msg.id})` : ''}: ${msg.message}`);
        break;
    }
  });
  ws.on('close', (closeCode, reason) => say(`Disconnected (${closeCode}${reason.length ? `: ${reason}` : ''})`));
  ws.on('error', (err) => say(`Connection error: ${err.message}`));
}

// "Each command type, minus v and id" (Omit applied to each member of the union separately).
type CommandInput = Command extends infer C ? (C extends Command ? Omit<C, 'v' | 'id'> : never) : never;

function send(command: CommandInput) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return say('Not connected (try "reconnect")');
  const id = `r${nextId++}`;
  ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, ...command }));
  say(`-> ${command.type} (${id})`);
}

async function fetchAsset(path: string) {
  if (!creds) return say('Not paired yet');
  const res = await fetch(`http://${host}:${port}${ASSETS_PATH}${path}`, { headers: { Authorization: `Bearer ${creds.token}` } });
  const body = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const preview = type.includes('json') || type.startsWith('text') ? ` ${body.toString('utf8').slice(0, 300)}` : '';
  say(`asset ${res.status} ${type} ${body.length} bytes${preview}`);
}

const num = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : NaN);

connect(true);
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, a, b] = line.trim().split(/\s+/);
  switch (cmd) {
    case '':
    case undefined:
      return;
    case 'accept':
    case 'decline':
      return send({ type: cmd });
    case 'find':
      return send({ type: 'findMatch' });
    case 'leave':
      return send({ type: 'leaveQueue' });
    case 'hover':
      return send({ type: 'hover', championId: num(a) });
    case 'lock':
      return send(a ? { type: 'lockIn', championId: num(a) } : { type: 'lockIn' });
    case 'ban':
      return send({ type: 'ban', championId: num(a) });
    case 'spells':
      return send({ type: 'setSpells', spell1Id: num(a), spell2Id: num(b) });
    case 'skin':
      return send({ type: 'setSkin', skinId: num(a) });
    case 'runes':
      return send({ type: 'setRunePage', pageId: num(a) });
    case 'pages':
      if (!state?.runes) return say('No rune pages yet');
      for (const p of state.runes.pages) {
        say(`  ${p.id === state.runes.currentPageId ? '*' : ' '} ${p.id}  ${p.name}${p.isEditable ? '' : '  (read-only)'}`);
      }
      return;
    case 'newpage': {
      // Saves a copy of the current page under a new name (tests creating pages).
      const current = state?.runes?.pages.find((p) => p.id === state?.runes?.currentPageId);
      if (!current) return say('No current rune page to copy');
      const name = line.trim().split(/\s+/).slice(1).join(' ') || 'Phone copy';
      return send({
        type: 'saveRunePage',
        page: { name, primaryStyleId: current.primaryStyleId, subStyleId: current.subStyleId, selectedPerkIds: current.selectedPerkIds },
      });
    }
    case 'asset':
      return void fetchAsset(a ?? '/lol-game-data/assets/v1/champion-summary.json').catch((e: Error) => say(`asset failed: ${e.message}`));
    case 'state':
      return console.log(JSON.stringify(state, null, 2));
    case 'reconnect':
      if (!creds) return say('Not paired yet');
      ws?.close();
      return connect(false);
    case 'quit':
      ws?.close();
      return process.exit(0);
    default:
      say(
        'Commands: accept, decline, find, leave, hover <id>, lock [id], ban <id>, spells <a> <b>, skin <id>, runes <pageId>, pages, newpage <name>, asset <path>, state, reconnect, quit',
      );
  }
});
