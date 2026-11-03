/**
 * End-to-end: the real Bridge (lockfile -> HTTPS -> WSS -> auto-accept) against the fake client.
 * Uses real timers and real sockets, so each test takes a second or two.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../bridge';
import { DEFAULT_AUTO_ACCEPT } from '../gameflow/autoAccept';
import { FakeLcu } from './fakeLcu';

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
let bridge: Bridge | null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-league-'));
  fake = new FakeLcu({ dir });
  bridge = null;
});

afterEach(async () => {
  bridge?.stop();
  await fake.stop();
  await rm(dir, { recursive: true, force: true });
});

function startBridge(enabled: boolean) {
  bridge = new Bridge({ leaguePath: dir, log, pollMs: 50, autoAccept: { ...DEFAULT_AUTO_ACCEPT, enabled } });
  bridge.start();
  return bridge;
}

describe('Bridge against the fake client', () => {
  it('waits for the client, connects, and reads the phase', async () => {
    const b = startBridge(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(b.connected).toBe(false); // client not started yet

    await fake.start();
    fake.setPhase('Lobby');
    await waitFor(() => b.phase.phase === 'Lobby');
  });

  it('auto-accepts at 10s of the 12s pop', async () => {
    await fake.start();
    fake.setPhase('Lobby');
    const b = startBridge(true);
    await waitFor(() => b.phase.phase === 'Lobby');

    fake.pop(9); // pretend the pop has been up for 9s, so the accept is due in ~1s
    await waitFor(() => fake.phase === 'ChampSelect', 4000);
    expect(fake.requests).toContain('POST /lol-matchmaking/v1/ready-check/accept');
    await waitFor(() => b.phase.phase === 'ChampSelect');
  });

  it('does not accept when the player declines first', async () => {
    await fake.start();
    fake.setPhase('Lobby');
    const b = startBridge(true);
    await waitFor(() => b.phase.phase === 'Lobby');

    fake.pop(8);
    await new Promise((r) => setTimeout(r, 200));
    fake.respond('Declined');
    await new Promise((r) => setTimeout(r, 2500));
    expect(fake.requests).not.toContain('POST /lol-matchmaking/v1/ready-check/accept');
  });

  it('reconnects after the client restarts with a new port and password', async () => {
    await fake.start();
    fake.setPhase('Lobby');
    const b = startBridge(false);
    await waitFor(() => b.phase.phase === 'Lobby');
    const oldPort = fake.port;
    const phaseReads = () => fake.requests.filter((r) => r === 'GET /lol-gameflow/v1/gameflow-phase').length;
    expect(phaseReads()).toBe(1);

    await fake.restart();
    expect(fake.port).not.toBe(oldPort);
    fake.setPhase('Lobby');
    // The fake only logs requests that pass auth, so a second read proves the new password was picked up.
    await waitFor(() => phaseReads() === 2, 8000);
    await waitFor(() => b.connected && b.phase.phase === 'Lobby');
  }, 12_000);
});
