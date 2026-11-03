/**
 * M5: champion select and rune commands, end to end against the fake client
 * (Bridge -> HTTPS -> fake champ select, which mirrors the real Draft/Co-op recordings).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ChampSelect, type Command, type ErrorCode } from '@league-remote/protocol';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../bridge';
import { FakeLcu } from '../dev/fakeLcu';
import { VALID_PAGE_PERKS } from '../dev/fakeChampSelect';
import { DEFAULT_AUTO_ACCEPT } from '../gameflow/autoAccept';
import { CommandError } from '../server/errors';

const log = pino({ level: 'silent' });

async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

let dir: string;
let fake: FakeLcu;
let bridge: Bridge;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'champ-'));
  fake = new FakeLcu({ dir });
  await fake.start();
  fake.setPhase('Lobby');
  bridge = new Bridge({ leaguePath: dir, log, pollMs: 50, autoAccept: { ...DEFAULT_AUTO_ACCEPT, enabled: false } });
  void bridge.start();
  await waitFor(() => bridge.state.phase === 'Lobby' && bridge.state.runes !== null);
});

afterEach(async () => {
  bridge.stop();
  await fake.stop();
  await rm(dir, { recursive: true, force: true });
});

type Input = Command extends infer C ? (C extends Command ? Omit<C, 'v' | 'id'> : never) : never;
const run = (c: Input) => bridge.handleCommand({ v: PROTOCOL_VERSION, id: 't', ...c } as Command);

async function expectError(c: Input, code: ErrorCode, message?: RegExp) {
  const err = await run(c).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `${c.type} should fail`).toBeInstanceOf(CommandError);
  expect((err as CommandError).code).toBe(code);
  if (message) expect((err as CommandError).message).toMatch(message);
}

const cs = () => bridge.state.champSelect as ChampSelect;
const me = () => cs().myTeam.find((p) => p.isMe)!;
const until = (pred: (c: ChampSelect) => boolean) => waitFor(() => !!bridge.state.champSelect && pred(bridge.state.champSelect));

async function openDraft(planning = true) {
  fake.champ.start({ mode: 'draft', planning });
  await until((c) => c.phase === (planning ? 'PLANNING' : 'BAN_PICK') && c.pickableChampionIds !== null);
}

/** Lets everyone else act until it's my pick turn (bans done, snake order reaches cell 2). */
async function untilMyPick() {
  while (cs().myAction?.type !== 'pick') {
    fake.champ.othersAct();
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('outside champion select', () => {
  it('refuses picks with a clear reason', async () => {
    await expectError({ type: 'hover', championId: 10 }, 'INVALID_STATE', /not in champion select/);
    await expectError({ type: 'setSkin', skinId: 1 }, 'INVALID_STATE');
  });
});

describe('draft: planning and bans', () => {
  it('PLANNING: hover declares intent on my upcoming pick; bans and lock-in wait', async () => {
    await openDraft();
    await run({ type: 'hover', championId: 10 });
    await until(() => me().hoverId === 10);
    expect(cs().myAction).toBeNull();
    expect(fake.bodies.at(-1)).toEqual({ route: `PATCH /lol-champ-select/v1/session/actions/${cs().myPickActionId}`, body: { championId: 10 } });
    await expectError({ type: 'ban', championId: 30 }, 'INVALID_STATE', /isn't your turn to ban/);
    await expectError({ type: 'lockIn' }, 'INVALID_STATE', /isn't your turn to pick/);
  });

  it('refuses to ban what a teammate wants to play, what is not bannable, and duplicates', async () => {
    await openDraft(false);
    fake.champ.teammateHover(0, 15);
    await until((c) => c.myTeam[0]!.hoverId === 15);
    await expectError({ type: 'ban', championId: 15 }, 'NOT_ALLOWED', /Ally0 wants to play Hero15/);
    await expectError({ type: 'ban', championId: 70 }, 'NOT_ALLOWED', /can't be banned/);
  });

  it('bans: hover then confirm in one command', async () => {
    await openDraft(false);
    await run({ type: 'ban', championId: 33 });
    await until((c) => c.bans.myTeam.includes(33) && c.myAction === null);
    const routes = fake.bodies.map((b) => b.route).slice(-2);
    expect(routes[0]).toMatch(/^PATCH \/lol-champ-select\/v1\/session\/actions\/\d+$/);
    expect(routes[1]).toMatch(/^POST \/lol-champ-select\/v1\/session\/actions\/\d+\/complete$/);
    await expectError({ type: 'ban', championId: 34 }, 'INVALID_STATE', /isn't your turn to ban/);
  });
});

describe('draft: picks', () => {
  beforeEach(async () => {
    await openDraft(false);
    await run({ type: 'ban', championId: 33 });
    await until((c) => c.myAction === null);
  });

  it('refuses banned, taken and unowned champions', async () => {
    await untilMyPick();
    await expectError({ type: 'hover', championId: 33 }, 'NOT_ALLOWED', /Hero33 is banned/);
    await expectError({ type: 'hover', championId: 20 }, 'NOT_ALLOWED', /Hero20 has already been picked/);
    // 55: not owned (fake owns 1-40) and not banned (others ban 41-50).
    await expectError({ type: 'lockIn', championId: 55 }, 'NOT_ALLOWED', /can't play Hero55/);
  });

  it('lock in uses the hovered champion when none is given', async () => {
    await run({ type: 'hover', championId: 12 }); // intent before my turn
    await untilMyPick();
    expect(cs().myAction!.championId).toBe(12);
    await run({ type: 'lockIn' });
    await until(() => me().championId === 12);
    expect(cs().myPickActionId).toBeNull();
    await expectError({ type: 'hover', championId: 13 }, 'INVALID_STATE', /already locked in/);
  });

  it('lock in without anything hovered asks you to hover first', async () => {
    await untilMyPick();
    await expectError({ type: 'lockIn' }, 'INVALID_STATE', /Hover a champion first/);
  });

  it("passes the client's own refusal through clearly", async () => {
    await untilMyPick();
    fake.champ.owned.splice(fake.champ.owned.indexOf(13), 1); // client changes its mind after sending the list
    await expectError({ type: 'hover', championId: 13 }, 'CLIENT_ERROR', /Champion not available/);
  });
});

describe('loadout: spells and skins', () => {
  beforeEach(async () => {
    fake.champ.start({ mode: 'blind' });
    await until((c) => c.myAction?.type === 'pick');
  });

  it('blind pick: hover + lock in one go; no bans in this mode', async () => {
    await expectError({ type: 'ban', championId: 5 }, 'INVALID_STATE');
    await run({ type: 'lockIn', championId: 7 });
    await until(() => me().championId === 7);
  });

  it('spells: two different ones', async () => {
    await expectError({ type: 'setSpells', spell1Id: 4, spell2Id: 4 }, 'NOT_ALLOWED', /two different/);
    await run({ type: 'setSpells', spell1Id: 14, spell2Id: 4 });
    await until(() => me().spell1Id === 14 && me().spell2Id === 4);
  });

  it('skins: only after locking in, only owned ones', async () => {
    await expectError({ type: 'setSkin', skinId: 7001 }, 'INVALID_STATE', /Lock in a champion first/);
    await run({ type: 'lockIn', championId: 7 });
    await until((c) => c.skins.length > 0);
    await run({ type: 'setSkin', skinId: 7001 });
    await until(() => me().skinId === 7001);
    await expectError({ type: 'setSkin', skinId: 7003 }, 'NOT_ALLOWED', /don't own Shop Skin/);
    await expectError({ type: 'setSkin', skinId: 7002 }, 'NOT_ALLOWED', /don't own Owned Skin \(Ruby\)/);
    await expectError({ type: 'setSkin', skinId: 9001 }, 'NOT_ALLOWED', /isn't available for Hero7/);
  });
});

describe('rune pages', () => {
  const page = (overrides: Partial<{ name: string; primaryStyleId: number; subStyleId: number; selectedPerkIds: number[] }> = {}) => ({
    name: 'Phone page',
    primaryStyleId: 8000,
    subStyleId: 8100,
    selectedPerkIds: [...VALID_PAGE_PERKS],
    ...overrides,
  });

  it('switches the current page', async () => {
    await run({ type: 'setRunePage', pageId: 102 });
    await waitFor(() => bridge.state.runes?.currentPageId === 102);
    await expectError({ type: 'setRunePage', pageId: 999 }, 'NOT_ALLOWED', /doesn't exist/);
  });

  it('creates a new page and makes it current', async () => {
    await run({ type: 'saveRunePage', page: page() });
    await waitFor(() => {
      const runes = bridge.state.runes;
      return !!runes && runes.pages.some((p) => p.name === 'Phone page' && p.id === runes.currentPageId);
    });
  });

  it('edits an editable page; refuses the recommended (read-only) one', async () => {
    await run({ type: 'saveRunePage', pageId: 101, page: page({ name: 'Renamed' }) });
    await waitFor(() => bridge.state.runes?.pages.find((p) => p.id === 101)?.name === 'Renamed');
    await expectError({ type: 'saveRunePage', pageId: 102, page: page() }, 'NOT_ALLOWED', /can't be edited/);
  });

  it('validates the page against the rune paths', async () => {
    await expectError({ type: 'saveRunePage', page: page({ subStyleId: 8000 }) }, 'NOT_ALLOWED', /must be different/);
    const wrongKeystone = [...VALID_PAGE_PERKS];
    wrongKeystone[0] = 8112; // Domination keystone on a Precision page
    await expectError({ type: 'saveRunePage', page: page({ selectedPerkIds: wrongKeystone }) }, 'NOT_ALLOWED', /keystone/);
    const sameRow = [...VALID_PAGE_PERKS];
    sameRow[5] = 8139; // both secondary runes from Domination row 1
    await expectError({ type: 'saveRunePage', page: page({ selectedPerkIds: sameRow }) }, 'NOT_ALLOWED', /two different rows/);
  });

  it("reports the client's page limit", async () => {
    fake.champ.maxPages = 1;
    await expectError({ type: 'saveRunePage', page: page() }, 'CLIENT_ERROR', /Max pages/);
  });
});
