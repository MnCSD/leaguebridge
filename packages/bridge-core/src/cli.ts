/**
 * `npm run bridge` — connect to the League client (or replay a recording), keep BridgeState,
 * optionally auto-accept queue pops, and record every event to recordings/*.jsonl.
 *
 * Options:
 *   --league-path <dir>          League install folder (or env LEAGUE_PATH). Default: C:\Riot Games\League of Legends
 *   --auto-accept                Accept queue pops automatically (off by default)
 *   --accept-before-timeout <s>  Seconds before the 12s pop expires to accept. Default: 2
 *   --mock <recording.jsonl>     Replay a recording instead of connecting to League (never records)
 *     --speed <n>                Replay speed. Default: 1 (real time)
 *     --max-gap <s>              Shorten quiet stretches to at most this. Default: 3. Use 0 to keep real gaps
 *     --loop                     Start again when the recording ends
 *   --json                       Print the full BridgeState as JSON on every change
 *   --events                     Print raw client events for the endpoints we care about
 *   --all                        Print every raw client event
 *   --data                       With --events/--all, also print each event's data (truncated)
 *   --out <dir>                  Where recordings go. Default: recordings
 *   --no-record                  Don't write a recording
 *   --port <n>                   Phone server port. Default: 4242 (from the config file)
 *   --no-server                  Don't start the phone server
 *   --config <file>              Config file. Default: %APPDATA%\LeagueRemote\config.json
 *   --log-level <level>          debug | info | warn. Default: info
 *
 * Keys while running: p = new pairing code, d = list paired devices, Ctrl+C = quit.
 */
import { hostname } from 'node:os';
import { emitKeypressEvents } from 'node:readline';
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';
import { Bridge } from './bridge';
import { ConfigStore, defaultConfigPath } from './server/config';
import { lanAddressList } from './server/network';
import { PhoneServer } from './server/phoneServer';
import { DEFAULT_AUTO_ACCEPT } from './gameflow/autoAccept';
import { DEFAULT_LEAGUE_PATH } from './lcu/credentials';
import type { LcuEvent } from './lcu/socket';
import { Recorder } from './record/recorder';
import { describeState } from './state/describe';
import { createLogger } from './util/logger';
import { redactDeep } from './util/redact';

const { values: args } = parseArgs({
  options: {
    'league-path': { type: 'string' },
    'auto-accept': { type: 'boolean', default: false },
    'accept-before-timeout': { type: 'string', default: String(DEFAULT_AUTO_ACCEPT.beforeTimeoutSec) },
    mock: { type: 'string' },
    speed: { type: 'string', default: '1' },
    'max-gap': { type: 'string', default: '3' },
    loop: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    events: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    data: { type: 'boolean', default: false },
    out: { type: 'string', default: 'recordings' },
    'no-record': { type: 'boolean', default: false },
    'log-level': { type: 'string', default: 'info' },
    port: { type: 'string' },
    'no-server': { type: 'boolean', default: false },
    config: { type: 'string' },
  },
});

const log = createLogger(args['log-level']);
const leaguePath = args['league-path'] ?? process.env.LEAGUE_PATH ?? DEFAULT_LEAGUE_PATH;
const { windowSec } = DEFAULT_AUTO_ACCEPT;

function numberArg(name: string, value: string, min: number, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    log.error(`--${name} must be a number between ${min} and ${max}`);
    process.exit(1);
  }
  return n;
}

const beforeTimeoutSec = numberArg('accept-before-timeout', args['accept-before-timeout'], 0, windowSec - 1);
const speed = numberArg('speed', args.speed, 0.1, 1000);
const maxGapSec = numberArg('max-gap', args['max-gap'], 0);

/** Raw endpoints printed with --events. Everything is always recorded. */
const INTERESTING = ['/lol-lobby/v2/lobby', '/lol-champ-select/v1/session', '/lol-perks/v1/currentpage'];

const recorder = args.mock || args['no-record'] ? null : new Recorder(args.out);
if (recorder) log.info({ file: recorder.path }, 'Recording events');

let eventCount = 0;
function printEvent(e: LcuEvent) {
  eventCount++;
  const wanted = args.all || (args.events && INTERESTING.some((p) => e.uri.startsWith(p)));
  if (!wanted) return;
  let msg = `${e.eventType.padEnd(6)} ${e.uri}`;
  if (args.data) {
    const json = JSON.stringify(redactDeep(e.data, bridge.secrets));
    msg += `  ${json.length > 200 ? json.slice(0, 200) + '...' : json}`;
  }
  log.info(msg);
}

/** Print each part of the state only when its one-line description changes. */
const lastLines: Record<string, string | null> = {};
function printState(state: Parameters<typeof describeState>[0]) {
  if (args.json) console.log(JSON.stringify(state, null, 2));
  for (const [section, line] of Object.entries(describeState(state))) {
    if (line === (lastLines[section] ?? null)) continue;
    lastLines[section] = line;
    log.info(line ?? `${section}: (none)`);
  }
}

const config = new ConfigStore(args.config ?? defaultConfigPath());
const autoAcceptOn = args['auto-accept'] || config.get().autoAccept.enabled;

let server: PhoneServer | null = null;

const bridge = new Bridge({
  leaguePath,
  log,
  recorder,
  autoAccept: { ...config.get().autoAccept, enabled: autoAcceptOn, beforeTimeoutSec },
  mock: args.mock
    ? { file: args.mock, speed, maxGapMs: maxGapSec > 0 ? maxGapSec * 1000 : undefined, loop: args.loop }
    : undefined,
  onEvent: printEvent,
  onStateChange: (state) => {
    printState(state);
    server?.publishState();
  },
  onMockEnd: () => {
    log.info({ events: eventCount }, 'Recording finished');
    void shutdown();
  },
});

if (args.mock) log.info(`MOCK MODE: replaying ${args.mock} at ${speed}x (quiet gaps capped at ${maxGapSec || 'no limit'}s)`);
log.info(
  autoAcceptOn
    ? `Auto-accept ON: accepts at ${windowSec - beforeTimeoutSec}s of the ${windowSec}s pop`
    : 'Auto-accept OFF (start with --auto-accept to enable)',
);

// --- phone server ------------------------------------------------------------------------------

async function showPairing() {
  if (!server) return;
  const info = server.newPairingCode();
  const qr = await QRCode.toString(JSON.stringify(info), { type: 'terminal', small: true });
  console.log(`\n${qr}`);
  console.log(`  Pairing code: ${info.code.slice(0, 3)} ${info.code.slice(3)}   (valid 5 minutes, single use)`);
  const all = lanAddressList();
  const chosen = all.find((a) => a.address === info.host);
  console.log(`  PC address:   ${info.host}:${info.port}${chosen ? `   (${chosen.adapter})` : ''}`);
  const others = all.filter((a) => a.address !== info.host);
  if (others.length) console.log(`  Other addresses: ${others.map((a) => `${a.address} (${a.adapter})`).join(', ')}`);
  console.log(`  Keys: p = new pairing code, d = list paired devices, Ctrl+C = quit\n`);
}

function listDevices() {
  const devices = config.get().devices;
  const online = new Set(server?.connectedDevices().map((d) => d.id));
  if (devices.length === 0) return log.info('No paired devices yet');
  for (const d of devices) log.info(`Device: ${d.name}${online.has(d.id) ? ' (connected)' : ''} | paired ${d.pairedAt.slice(0, 10)} | id ${d.id}`);
}

if (!args['no-server']) {
  server = new PhoneServer({
    config,
    log,
    bridgeName: hostname(),
    port: args.port ? numberArg('port', args.port, 1, 65535) : undefined,
    getState: () => bridge.state,
    handleCommand: (command) => bridge.handleCommand(command),
    fetchAsset: (path) => bridge.fetchAsset(path),
  });
  try {
    const port = await server.start();
    log.info(`Phone server listening on port ${port} (local network only: ${config.get().localNetworkOnly ? 'yes' : 'no'})`);
    log.info(`Config and paired devices: ${config.path}`);
    await showPairing();
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Phone server could not start (is another bridge running on that port?)');
    server = null;
  }
}

// Keyboard shortcuts (only in a real terminal). Raw mode means we handle Ctrl+C ourselves.
if (process.stdin.isTTY && server) {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (_s, key: { name?: string; ctrl?: boolean }) => {
    if (key.ctrl && key.name === 'c') return void shutdown();
    if (key.name === 'p') void showPairing();
    if (key.name === 'd') listDevices();
  });
}

// --- lifecycle ---------------------------------------------------------------------------------

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log.info({ events: eventCount }, 'Stopping...');
  bridge.stop();
  await server?.stop();
  await recorder?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Never crash on a stray error: log it and keep going.
process.on('unhandledRejection', (err) => log.error({ err: String(err) }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => log.error({ err: err.message }, 'Uncaught exception'));

bridge.start();
