/**
 * The whole chain with real sockets: phone -> PhoneServer -> Bridge -> (fake) League client.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../bridge';
import { FakeLcu } from '../dev/fakeLcu';
import { DEFAULT_AUTO_ACCEPT } from '../gameflow/autoAccept';
import { ConfigStore } from './config';
import { PhoneServer } from './phoneServer';
import { connectPhone, type TestPhone } from './testClient';

const log = pino({ level: 'silent' });

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

let dir: string;
let fake: FakeLcu;
let bridge: Bridge;
let server: PhoneServer;
let phone: TestPhone;
let token: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  fake = new FakeLcu({ dir: join(dir, 'league') });
  await fake.start();
  fake.setPhase('Lobby');

  bridge = new Bridge({
    leaguePath: join(dir, 'league'),
    log,
    pollMs: 50,
    autoAccept: { ...DEFAULT_AUTO_ACCEPT, enabled: false },
    onStateChange: () => server.publishState(),
  });
  server = new PhoneServer({
    config: new ConfigStore(join(dir, 'config.json')),
    log,
    bridgeName: 'E2E',
    port: 0,
    getState: () => bridge.state,
    handleCommand: (c) => bridge.handleCommand(c),
    fetchAsset: (p) => bridge.fetchAsset(p),
  });
  const port = await server.start();
  bridge.start();
  await waitFor(() => bridge.state.phase === 'Lobby');

  phone = await connectPhone(port);
  phone.send({ type: 'hello', pair: { code: server.newPairingCode().code, deviceName: 'E2E phone' } });
  token = (await phone.next('welcome')).token!;
});

afterEach(async () => {
  phone.ws.close();
  bridge.stop();
  await server.stop();
  await fake.stop();
  await rm(dir, { recursive: true, force: true });
});

/** Waits for a state message matching `pred`. */
async function stateWhere(pred: (s: Awaited<ReturnType<TestPhone['next']>> & { type: 'state' }) => boolean) {
  for (;;) {
    const msg = await phone.next('state');
    if (pred(msg)) return msg;
  }
}

describe('phone <-> bridge <-> League client', () => {
  it('the phone sees the pop and accepts it', async () => {
    fake.pop();
    await stateWhere((m) => m.state.readyCheck?.response === 'None');
    phone.send({ type: 'accept', id: 'a1' });
    expect(await phone.next('result')).toMatchObject({ id: 'a1' });
    expect(fake.requests).toContain('POST /lol-matchmaking/v1/ready-check/accept');
    await stateWhere((m) => m.state.phase === 'ChampSelect');
  });

  it('the phone declines; a second answer is refused with a clear error', async () => {
    fake.pop();
    await stateWhere((m) => m.state.readyCheck?.response === 'None');
    phone.send({ type: 'decline', id: 'd1' });
    await phone.next('result');
    await stateWhere((m) => m.state.phase === 'Lobby');
    phone.send({ type: 'accept', id: 'a2' });
    expect(await phone.next('error')).toMatchObject({ id: 'a2', code: 'INVALID_STATE' });
  });

  it('accept with no pop is refused before reaching the client', async () => {
    phone.send({ type: 'accept', id: 'a1' });
    expect(await phone.next('error')).toMatchObject({ code: 'INVALID_STATE' });
    expect(fake.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  it('champ select from the phone: hover outside champ select is refused, inside it works', async () => {
    phone.send({ type: 'hover', id: 'h1', championId: 39 });
    expect(await phone.next('error')).toMatchObject({ id: 'h1', code: 'INVALID_STATE' });

    fake.champ.start({ mode: 'blind' });
    await stateWhere((m) => m.state.champSelect?.myAction?.type === 'pick');
    phone.send({ type: 'lockIn', id: 'l1', championId: 7 });
    expect(await phone.next('result')).toMatchObject({ id: 'l1' });
    await stateWhere((m) => m.state.champSelect?.myTeam.find((p) => p.isMe)?.championId === 7);
  });

  it('knows my name on connect and looks up party members by puuid', async () => {
    fake.summoners.set('friend-puuid', { gameName: 'Buddy', tagLine: 'EUW' });
    fake.setLobby(['friend-puuid']);
    const msg = await stateWhere((m) => m.state.lobby?.members[1]?.name === 'Buddy#EUW');
    expect(msg.state.me).toEqual({ name: 'FakeMe', tagLine: 'EUW', iconId: 7 });
    expect(msg.state.lobby!.members[0]).toMatchObject({ isMe: true, name: 'FakeMe' });
    expect(fake.requests.filter((r) => r.includes('friend-puuid'))).toHaveLength(1);
  });

  it('serves game images from the client', async () => {
    const res = await fetch(`http://127.0.0.1:${server.listeningPort}/assets/lol-game-data/assets/v1/champion-icons/39.png`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/lol-game-data/assets/v1/champion-icons/39.png');
  });

  it('tells the phone when the League client closes', async () => {
    await fake.stop();
    await stateWhere((m) => m.state.client === 'disconnected');
  });
});
