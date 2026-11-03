import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BridgeState, type ChampSelect } from '@league-remote/protocol';
import { describe, expect, it } from 'vitest';
import type { RecordingLine } from '../record/recorder';
import { applyUpdate, buildState, URIS } from './reducer';
import { StateStore } from './store';

/**
 * Replays the anonymized fixture of a real Co-op vs AI "Intro" game through the store, keeping
 * every state change with the recording time it happened at.
 * Fixture made with: npm run make-fixture -- recordings/<real>.jsonl <fixture>
 */
const BASE = 1_800_000_000_000; // any fixed epoch; timers are checked relative to it
function replayFixture(name: string) {
  const lines: RecordingLine[] = readFileSync(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

  const states: { t: number; state: BridgeState }[] = [];
  let t = 0;
  const store = new StateStore((state) => states.push({ t, state }));
  for (const line of lines) {
    t = line.t;
    if (line.kind === 'connected') store.setClient('connected');
    else if (line.kind === 'disconnected') store.setClient('disconnected');
    else if (line.kind === 'snapshot') store.update(line.uri, line.status === 200 ? line.data : null, BASE + t);
    else if (line.kind === 'event') store.update(line.uri, line.eventType === 'Delete' ? null : line.data, BASE + t);
  }
  return states;
}

type Timeline = ReturnType<typeof replayFixture>;
const finder = (states: Timeline) => ({
  first: (pred: (s: BridgeState) => boolean) => states.find(({ state }) => pred(state)),
  all: (pred: (s: BridgeState) => boolean) => states.filter(({ state }) => pred(state)),
});
const meIn = (cs: ChampSelect) => cs.myTeam.find((p) => p.isMe)!;

const states = replayFixture('coop-intro-game.jsonl');
const { first, all } = finder(states);

describe('reducer on a real Co-op vs AI game', () => {
  it('every state matches the BridgeState schema', () => {
    expect(states.length).toBeGreaterThan(10);
    for (const { state } of states) BridgeState.parse(state);
  });

  it('starts connected in phase None with the current rune page', () => {
    const s = states[0]!.state;
    expect(s.client).toBe('connected');
    const runes = first((s) => s.runes !== null)!.state.runes!;
    expect(runes.currentPageId).toBe(719250439);
  });

  it('knows who I am from chat', () => {
    expect(first((s) => s.me !== null)!.state.me).toEqual({ name: 'Player1', tagLine: 'TAG', iconId: 693 });
  });

  it('builds the lobby: one member, me, leader', () => {
    const lobby = first((s) => s.lobby !== null)!.state.lobby!;
    expect(lobby.queueId).toBe(870);
    expect(lobby.members).toHaveLength(1);
    expect(lobby.members[0]).toMatchObject({ isMe: true, isLeader: true, name: 'Player1' });
  });

  it('tracks the queue with a stable start time and estimate', () => {
    const searching = all((s) => s.matchmaking?.state === 'Searching');
    expect(searching.length).toBeGreaterThan(0);
    expect(searching[0]!.state.matchmaking!.estimatedMs).toBe(41461);
    // The client sends ~40 one-per-second search updates; startedAt must not wobble with them
    // (if it did, each one would be a separate state change here).
    expect(new Set(searching.map(({ state }) => state.matchmaking!.startedAt)).size).toBe(1);
    expect(searching.length).toBeLessThan(10);
    expect(first((s) => s.queue !== null)!.state.queue).toMatchObject({ id: 870, category: 'VersusAi' });
  });

  it('ready check: 12s countdown, then my accept, then gone', () => {
    const pop = first((s) => s.readyCheck?.response === 'None')!;
    expect(pop.state.readyCheck!.endsAt - (BASE + pop.t)).toBe(12_000);
    expect(first((s) => s.readyCheck?.response === 'Accepted')).toBeDefined();
    expect(first((s) => s.phase === 'ChampSelect')!.state.readyCheck).toBeNull();
  });

  it('champ select opens: my pick turn, 5 allies, no enemies (bots), no bans', () => {
    const { state, t } = first((s) => s.champSelect !== null)!;
    const cs = state.champSelect!;
    expect(cs).toMatchObject({ myCellId: 1, phase: 'BAN_PICK', simultaneousPicks: true, queueId: 870 });
    expect(cs.myTeam).toHaveLength(5);
    expect(cs.theirTeam).toHaveLength(0);
    expect(cs.bans).toEqual({ myTeam: [], theirTeam: [], perTeam: 0 });
    expect(cs.myAction).toEqual({ id: 1, type: 'pick', championId: 0 });
    // 90s phase; the session arrived ~0.1s before the phase switched to ChampSelect.
    const left = cs.timer.endsAt! - (BASE + t);
    expect(left).toBeGreaterThan(89_000);
    expect(left).toBeLessThanOrEqual(90_000);
    expect(meIn(cs)).toMatchObject({ championId: 0, hoverId: 0, acting: 'pick', spell1Id: 6, spell2Id: 7 });
  });

  it('champ select: hover, then lock in, then spells change', () => {
    const hovering = first((s) => !!s.champSelect && meIn(s.champSelect).hoverId === 39)!.state.champSelect!;
    expect(meIn(hovering).championId).toBe(0);
    expect(hovering.myAction).toEqual({ id: 1, type: 'pick', championId: 39 });

    const locked = first((s) => !!s.champSelect && meIn(s.champSelect).championId === 39)!.state.champSelect!;
    expect(meIn(locked)).toMatchObject({ hoverId: 0, acting: null, skinId: 39037 });
    expect(locked.myAction).toBeNull();

    const finalSpells = first((s) => !!s.champSelect && meIn(s.champSelect).spell1Id === 4)!.state.champSelect!;
    expect(meIn(finalSpells)).toMatchObject({ spell1Id: 4, spell2Id: 14 });
  });

  it('champ select: pickable champions and my skins', () => {
    const cs = first((s) => (s.champSelect?.skins.length ?? 0) > 0)!.state.champSelect!;
    expect(cs.pickableChampionIds!.length).toBeGreaterThan(100);
    expect(cs.skins.find((k) => k.id === 39000)).toMatchObject({ name: 'Irelia', owned: true });
    expect(cs.skins.find((k) => k.id === 39001)).toMatchObject({ owned: false });
  });

  it('champ select ends: FINALIZATION, then gone as soon as the game starts', () => {
    expect(first((s) => s.champSelect?.phase === 'FINALIZATION')).toBeDefined();
    // Real ordering: phase -> GameStart arrives before the session Delete. Must already be null.
    for (const { state } of all((s) => s.phase === 'GameStart' || s.phase === 'InProgress')) {
      expect(state.champSelect).toBeNull();
    }
    const last = states.at(-1)!.state;
    expect(last.matchmaking).toBeNull();
    expect(last.lobby).toBeNull();
  });

  it('rune page switch to the champion recommendation is picked up', () => {
    const withIrelia = first((s) => s.runes?.pages.some((p) => p.name.includes('Irelia')) ?? false)!.state;
    const ireliaId = withIrelia.runes!.pages.find((p) => p.name.includes('Irelia'))!.id;
    expect(first((s) => s.runes?.currentPageId === ireliaId)).toBeDefined();
  });
});

describe('reducer on a real Normal Draft game', () => {
  // Me: cell 4, middle. Teammates 0-3, enemies 5-9. Simultaneous bans, then snake-order picks.
  const draft = replayFixture('normal-draft-game.jsonl');
  const d = finder(draft);
  const csWhere = (pred: (cs: ChampSelect) => boolean) => d.first((s) => !!s.champSelect && pred(s.champSelect))?.state.champSelect;

  it('every state matches the BridgeState schema', () => {
    for (const { state } of draft) BridgeState.parse(state);
  });

  it('PLANNING: nobody is acting yet, even though the client marks bans "in progress"', () => {
    const planning = d.all((s) => s.champSelect?.phase === 'PLANNING');
    expect(planning.length).toBeGreaterThan(0);
    for (const { state } of planning) {
      const cs = state.champSelect!;
      expect(cs.myAction).toBeNull();
      expect([...cs.myTeam, ...cs.theirTeam].every((p) => p.acting === null)).toBe(true);
      expect(cs.myPickActionId).not.toBeNull(); // so the phone can declare intent now
    }
    // A teammate declared intent 555 during planning, via their pick action.
    expect(csWhere((cs) => cs.phase === 'PLANNING' && cs.myTeam.some((p) => p.hoverId === 555))).toBeDefined();
  });

  it('BAN_PICK bans: my ban turn with my ban hover, teammates ban hovers visible', () => {
    const myBan = csWhere((cs) => cs.myAction?.type === 'ban' && cs.myAction.championId === 157)!;
    expect(meIn(myBan)).toMatchObject({ acting: 'ban', banHoverId: 157, cellId: 4, position: 'middle' });
    expect(csWhere((cs) => cs.myTeam[1]!.banHoverId === 200 && cs.myTeam[1]!.acting === 'ban')).toBeDefined();
  });

  it('bans: teammates appear as they lock, enemy bans all at once at the reveal', () => {
    expect(csWhere((cs) => cs.bans.myTeam.length === 1 && cs.bans.theirTeam.length === 0)).toBeDefined();
    const revealed = csWhere((cs) => cs.bans.theirTeam.length === 5)!;
    expect(revealed.bans.myTeam.sort()).toEqual([117, 157, 200, 201, 266].sort());
    expect(revealed.bans.theirTeam.sort()).toEqual([412, 50, 91, 48, 777].sort());
    expect(revealed.bans.perTeam).toBe(5); // the client's own numBans said 0
  });

  it('enemies: hidden names, no positions, their hover and picks visible', () => {
    const cs = csWhere((cs) => cs.theirTeam.find((p) => p.cellId === 8)!.hoverId === 10)!;
    expect(cs.theirTeam.find((p) => p.cellId === 8)).toMatchObject({ acting: 'pick', championId: 0, name: null, position: null });
    expect(cs.theirTeam.find((p) => p.cellId === 7)!.championId).toBe(233);
  });

  it('my pick turn: hover 1, then 39, then lock 39; the turn action is my pick action', () => {
    const hover1 = csWhere((cs) => cs.myAction?.type === 'pick' && cs.myAction.championId === 1)!;
    expect(hover1.myAction!.id).toBe(hover1.myPickActionId);
    expect(meIn(hover1)).toMatchObject({ acting: 'pick', hoverId: 1, championId: 0 });
    expect(csWhere((cs) => cs.myAction?.championId === 39)).toBeDefined();
    const locked = csWhere((cs) => meIn(cs).championId === 39)!;
    expect(locked.myAction).toBeNull();
    expect(locked.myPickActionId).toBeNull();
  });

  it('FINALIZATION: all ten champions locked', () => {
    const cs = csWhere((cs) => cs.phase === 'FINALIZATION')!;
    expect(cs.myTeam.map((p) => p.championId)).toEqual([18, 30, 41, 147, 39]);
    expect(cs.theirTeam.map((p) => p.championId)).toEqual([136, 78, 233, 10, 8]);
    expect(cs.myAction).toBeNull();
  });

  it('auto-accepted ready check went straight to champ select', () => {
    expect(d.first((s) => s.readyCheck?.response === 'Accepted')).toBeDefined();
    expect(d.first((s) => s.phase === 'ChampSelect')!.state.readyCheck).toBeNull();
  });
});

describe('reducer on a hand-built session', () => {
  it('computes the phase deadline from the time left', () => {
    const at = 5_000_000;
    const session = {
      localPlayerCellId: 0,
      timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 25_000, totalTimeInPhase: 30_000, isInfinite: false },
      myTeam: [{ cellId: 0 }],
      actions: [],
    };
    const cache = applyUpdate(applyUpdate({}, URIS.phase, 'ChampSelect', at), URIS.champSelect, session, at);
    expect(buildState(cache, 'connected').champSelect!.timer).toEqual({ endsAt: at + 25_000, totalMs: 30_000 });
  });
});

describe('disconnect', () => {
  it('drops everything back to the empty state', () => {
    const store = new StateStore();
    store.setClient('connected');
    store.update(URIS.phase, 'Lobby');
    expect(store.state.phase).toBe('Lobby');
    store.setClient('disconnected');
    expect(store.state).toMatchObject({ client: 'disconnected', phase: 'None', lobby: null });
  });
});
