import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoAccepter, READY_CHECK_URI, type ReadyCheck } from './autoAccept';

const log = pino({ level: 'silent' });
const ON = { enabled: true, windowSec: 12, beforeTimeoutSec: 2 };

type Line = { t: number; uri: string; eventType: string; data: unknown };
const fixture: Line[] = readFileSync(
  fileURLToPath(new URL('../../test/fixtures/ready-check-accepted.jsonl', import.meta.url)),
  'utf8',
)
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

/** Feeds ready-check lines to the accepter at their recorded times. Returns ms of the accept call, or null. */
async function replay(lines: Line[], accepter: AutoAccepter, accept: ReturnType<typeof vi.fn>) {
  let now = 0;
  let acceptedAt: number | null = null;
  accept.mockImplementation(async () => {
    acceptedAt = Date.now(); // fake clock, starts at 0 (see beforeEach)
  });
  for (const line of lines) {
    if (line.uri !== READY_CHECK_URI) continue;
    await vi.advanceTimersByTimeAsync(line.t - now);
    now = line.t;
    accepter.onReadyCheck(line.eventType === 'Delete' ? null : (line.data as ReadyCheck));
  }
  await vi.advanceTimersByTimeAsync(20_000);
  return acceptedAt;
}

/** A pop where nobody answers: timer 0..11, then the client gives up. */
function unansweredPop(startMs = 0): Line[] {
  const lines: Line[] = [];
  for (let s = 0; s <= 11; s++) {
    lines.push({
      t: startMs + s * 1000,
      uri: READY_CHECK_URI,
      eventType: 'Update',
      data: { state: 'InProgress', playerResponse: 'None', timer: s, declinerIds: [] },
    });
  }
  lines.push({ t: startMs + 12_000, uri: READY_CHECK_URI, eventType: 'Delete', data: null });
  return lines;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('AutoAccepter', () => {
  it('real recording: player accepted at 8s, so the bridge never fires', async () => {
    const accept = vi.fn();
    const at = await replay(fixture, new AutoAccepter(ON, accept, log), accept);
    expect(at).toBeNull();
  });

  it('accepts 2s before the 12s window ends when nobody answers', async () => {
    const accept = vi.fn();
    const at = await replay(unansweredPop(), new AutoAccepter(ON, accept, log), accept);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(at).toBe(10_000);
  });

  it('accounts for time already elapsed when joining mid-pop', async () => {
    const accept = vi.fn();
    const midPop = unansweredPop().filter((l) => l.t >= 6000); // bridge connects at timer=6
    const at = await replay(midPop, new AutoAccepter(ON, accept, log), accept);
    expect(at).toBe(10_000);
  });

  it('stands down when the player declines', async () => {
    const accept = vi.fn();
    const lines = unansweredPop().slice(0, 5);
    lines.push({ t: 5000, uri: READY_CHECK_URI, eventType: 'Update', data: { state: 'InProgress', playerResponse: 'Declined', timer: 5, declinerIds: [] } });
    lines.push({ t: 5200, uri: READY_CHECK_URI, eventType: 'Delete', data: null });
    expect(await replay(lines, new AutoAccepter(ON, accept, log), accept)).toBeNull();
  });

  it('does nothing when disabled', async () => {
    const accept = vi.fn();
    await replay(unansweredPop(), new AutoAccepter({ ...ON, enabled: false }, accept, log), accept);
    expect(accept).not.toHaveBeenCalled();
  });

  it('handles back-to-back pops (e.g. someone else declined) with one accept each', async () => {
    const accept = vi.fn();
    const lines = [...unansweredPop(0), ...unansweredPop(30_000)];
    await replay(lines, new AutoAccepter(ON, accept, log), accept);
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending accept on reset (client disconnected)', async () => {
    const accept = vi.fn();
    const accepter = new AutoAccepter(ON, accept, log);
    accepter.onReadyCheck({ state: 'InProgress', playerResponse: 'None', timer: 0, declinerIds: [] });
    accepter.reset();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(accept).not.toHaveBeenCalled();
  });
});
