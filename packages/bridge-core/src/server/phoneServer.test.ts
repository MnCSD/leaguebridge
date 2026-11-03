import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOSE_CODES, EMPTY_STATE, type BridgeState, type Command } from '@league-remote/protocol';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './config';
import { CommandError } from './errors';
import { PhoneServer } from './phoneServer';
import { connectPhone } from './testClient';

const log = pino({ level: 'silent' });

let dir: string;
let config: ConfigStore;
let server: PhoneServer;
let port: number;
let state: BridgeState;
let commands: Command[];
let local: boolean;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'phone-server-'));
  config = new ConfigStore(join(dir, 'config.json'));
  state = { ...EMPTY_STATE, client: 'connected', phase: 'Lobby' };
  commands = [];
  local = true;
  server = new PhoneServer({
    config,
    log,
    bridgeName: 'TEST-PC',
    port: 0,
    authTimeoutMs: 300,
    isLocalAddress: () => local,
    getState: () => state,
    handleCommand: async (c) => {
      commands.push(c);
      if (c.type === 'decline') throw new CommandError('INVALID_STATE', 'There is no match to decline');
    },
    fetchAsset: async (path) => ({ status: 200, contentType: 'image/png', body: Buffer.from(`PNG:${path}`) }),
  });
  port = await server.start();
});

afterEach(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

async function pair(name = 'Test phone') {
  const code = server.newPairingCode().code;
  const phone = await connectPhone(port);
  phone.send({ type: 'hello', pair: { code, deviceName: name } });
  const welcome = await phone.next('welcome');
  return { phone, welcome, code };
}

describe('pairing and authentication', () => {
  it('pairs with the code: welcome with a token, then the state', async () => {
    const { phone, welcome } = await pair();
    expect(welcome).toMatchObject({ bridgeName: 'TEST-PC', bridgeId: config.get().bridgeId });
    expect(welcome.token!.length).toBeGreaterThanOrEqual(40);
    expect((await phone.next('state')).state.phase).toBe('Lobby');
    phone.ws.close();
  });

  it('stores only a hash of the token, never the token', async () => {
    const { phone, welcome } = await pair();
    const file = await readFile(config.path, 'utf8');
    expect(file).not.toContain(welcome.token!);
    expect(JSON.parse(file).devices).toHaveLength(1);
    phone.ws.close();
  });

  it('logs in again with the token (no new token is sent)', async () => {
    const { phone, welcome } = await pair();
    phone.ws.close();
    const again = await connectPhone(port);
    again.send({ type: 'hello', auth: { deviceId: welcome.deviceId, token: welcome.token } });
    const w2 = await again.next('welcome');
    expect(w2.deviceId).toBe(welcome.deviceId);
    expect(w2.token).toBeUndefined();
    again.ws.close();
  });

  it('rejects a wrong token', async () => {
    const { phone, welcome } = await pair();
    phone.ws.close();
    const bad = await connectPhone(port);
    bad.send({ type: 'hello', auth: { deviceId: welcome.deviceId, token: 'x'.repeat(43) } });
    expect((await bad.next('error')).code).toBe('UNAUTHORIZED');
    expect((await bad.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it('a pairing code works only once', async () => {
    const { phone, code } = await pair();
    phone.ws.close();
    const second = await connectPhone(port);
    second.send({ type: 'hello', pair: { code, deviceName: 'Intruder' } });
    expect((await second.next('error')).code).toBe('UNAUTHORIZED');
    expect(config.get().devices).toHaveLength(1);
  });

  it('5 wrong codes lock pairing until a new code is made', async () => {
    const code = server.newPairingCode().code;
    const wrong = code === '000000' ? '111111' : '000000';
    let last;
    for (let i = 0; i < 5; i++) {
      const p = await connectPhone(port);
      p.send({ type: 'hello', pair: { code: wrong, deviceName: 'Guesser' } });
      last = await p.next('error');
    }
    expect(last!.code).toBe('RATE_LIMITED');
    const p = await connectPhone(port);
    p.send({ type: 'hello', pair: { code, deviceName: 'Too late' } });
    expect((await p.next('error')).code).toBe('RATE_LIMITED');
  });

  it('closes connections that never say hello', async () => {
    const p = await connectPhone(port);
    expect((await p.closed).code).toBe(CLOSE_CODES.authTimeout);
  });

  it('closes connections whose first message is not a hello', async () => {
    const p = await connectPhone(port);
    p.send({ type: 'accept', id: 'r1' });
    expect((await p.next('error')).code).toBe('BAD_MESSAGE');
    expect((await p.closed).code).toBe(CLOSE_CODES.badMessage);
  });

  it('rejects phones outside the local network when "local network only" is on', async () => {
    local = false;
    const p = await connectPhone(port);
    expect((await p.closed).code).toBe(CLOSE_CODES.forbiddenNetwork);
    config.update((c) => (c.localNetworkOnly = false));
    const ok = await pair();
    expect(ok.welcome.token).toBeDefined();
    ok.phone.ws.close();
  });
});

describe('commands and state', () => {
  it('answers a command with result, or error with the same id', async () => {
    const { phone } = await pair();
    phone.send({ type: 'accept', id: 'a1' });
    expect(await phone.next('result')).toMatchObject({ id: 'a1', ok: true });
    phone.send({ type: 'decline', id: 'd1' });
    expect(await phone.next('error')).toMatchObject({ id: 'd1', code: 'INVALID_STATE', message: 'There is no match to decline' });
    expect(commands.map((c) => c.type)).toEqual(['accept', 'decline']);
    phone.ws.close();
  });

  it('rejects invalid commands without running them', async () => {
    const { phone } = await pair();
    phone.send({ type: 'hover', id: 'h1', championId: 'Irelia' });
    expect(await phone.next('error')).toMatchObject({ id: 'h1', code: 'BAD_MESSAGE' });
    phone.send({ type: 'selfDestruct', id: 'x1' });
    expect(await phone.next('error')).toMatchObject({ id: 'x1', code: 'BAD_MESSAGE' });
    expect(commands).toHaveLength(0);
    phone.ws.close();
  });

  it('pushes state changes (merged into one message)', async () => {
    const { phone } = await pair();
    await phone.next('state');
    state = { ...state, phase: 'Matchmaking' };
    server.publishState();
    state = { ...state, phase: 'ReadyCheck' };
    server.publishState();
    expect((await phone.next('state')).state.phase).toBe('ReadyCheck');
    await new Promise((r) => setTimeout(r, 250));
    expect(phone.messages.filter((m) => m.type === 'state')).toHaveLength(2); // initial + one merged
    phone.ws.close();
  });

  it('removing a device on the PC disconnects it', async () => {
    const { phone, welcome } = await pair();
    server.removeDevice(welcome.deviceId);
    expect((await phone.closed).code).toBe(CLOSE_CODES.deviceRemoved);
    expect(config.get().devices).toHaveLength(0);
  });
});

describe('assets', () => {
  const url = (path: string) => `http://127.0.0.1:${port}/assets${path}`;
  const champ = '/lol-game-data/assets/v1/champion-icons/39.png';

  it('needs a device token', async () => {
    expect((await fetch(url(champ))).status).toBe(401);
    expect((await fetch(url(champ), { headers: { Authorization: 'Bearer nope-nope-nope-nope-nope' } })).status).toBe(401);
  });

  it('proxies /lol-game-data/assets paths for a paired device', async () => {
    const { phone, welcome } = await pair();
    const res = await fetch(url(champ), { headers: { Authorization: `Bearer ${welcome.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe(`PNG:${champ}`);
    phone.ws.close();
  });

  it('refuses anything outside /lol-game-data/assets', async () => {
    const { phone, welcome } = await pair();
    const headers = { Authorization: `Bearer ${welcome.token}` };
    for (const path of ['/lol-matchmaking/v1/ready-check', '/lol-game-data/assets/../../lol-perks/v1/pages', '/riotclient/auth-token']) {
      expect((await fetch(url(path), { headers })).status).toBe(404);
    }
    phone.ws.close();
  });

  it('/health works without auth and reveals nothing secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await res.json()).toEqual({ ok: true, bridgeId: config.get().bridgeId, protocol: 1 });
  });
});
