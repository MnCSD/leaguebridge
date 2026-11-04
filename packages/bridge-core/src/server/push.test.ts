import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_STATE, type BridgeState, type ChampSelect } from '@league-remote/protocol';
import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './config';
import { PushNotifier, isExpoPushToken, type PushMessage, type PushTicket } from './push';

const log = pino({ level: 'silent' });
const TOKEN = 'ExponentPushToken[abc123]';

let config: ConfigStore;
let sent: PushMessage[][];
let tickets: (msgs: PushMessage[]) => PushTicket[];
let push: PushNotifier;

beforeEach(() => {
  config = new ConfigStore(join(mkdtempSync(join(tmpdir(), 'push-')), 'config.json'));
  config.update((c) =>
    c.devices.push({ id: 'd1', name: 'iPhone', tokenHash: 'x', pairedAt: '', lastSeenAt: null, pushToken: TOKEN }),
  );
  sent = [];
  tickets = (msgs) => msgs.map(() => ({ status: 'ok' }));
  push = new PushNotifier({
    config,
    log,
    send: async (msgs) => {
      sent.push(msgs);
      return tickets(msgs);
    },
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

const pop = (endsAt: number, response = 'None'): BridgeState => ({
  ...EMPTY_STATE,
  client: 'connected',
  phase: 'ReadyCheck',
  queue: { id: 420, name: 'Ranked Solo/Duo', category: 'PvP', isRanked: true },
  readyCheck: { state: 'InProgress', response, endsAt, totalMs: 12_000 },
});

const turn = (actionId: number | null, type: 'ban' | 'pick' = 'pick'): BridgeState => ({
  ...EMPTY_STATE,
  client: 'connected',
  phase: 'ChampSelect',
  champSelect: {
    gameId: 7,
    timer: { endsAt: 1, totalMs: 30_000 },
    myAction: actionId === null ? null : { id: actionId, type, championId: 0 },
  } as unknown as ChampSelect,
});

describe('push notifications', () => {
  it('recognises Expo push tokens', () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[a-b_c]')).toBe(true);
    expect(isExpoPushToken('not a token')).toBe(false);
  });

  it('one "Match found" per pop, not one per state update; a new pop sends again', async () => {
    push.onState(pop(1000));
    push.onState(pop(1000));
    push.onState(pop(1000, 'Accepted')); // my answer: no new push
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ to: TOKEN, title: 'Match found', body: 'Ranked Solo/Duo · accept within 12s', ttl: 12, priority: 'high' });

    push.onState({ ...EMPTY_STATE, phase: 'Matchmaking' });
    push.onState(pop(9000));
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('one push per new turn in champ select', async () => {
    push.onState(turn(1, 'ban'));
    push.onState(turn(1, 'ban'));
    push.onState(turn(null));
    push.onState(turn(10, 'pick'));
    await flush();
    expect(sent.map((m) => m[0]!.title)).toEqual(['Your turn to ban', 'Your turn to pick']);
    expect(sent[1]![0]!.body).toBe('You have 30s');
  });

  it('sends nothing when no phone turned notifications on', async () => {
    config.update((c) => delete c.devices[0]!.pushToken);
    push.onState(pop(1000));
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('forgets a token Expo says is no longer registered', async () => {
    tickets = () => [{ status: 'error', details: { error: 'DeviceNotRegistered' } }];
    push.onState(pop(1000));
    await flush();
    await flush();
    expect(config.get().devices[0]!.pushToken).toBeUndefined();
  });

  it('a failing push service never throws', async () => {
    push = new PushNotifier({ config, log, send: async () => Promise.reject(new Error('offline')) });
    expect(() => push.onState(pop(1000))).not.toThrow();
    await flush();
  });
});
