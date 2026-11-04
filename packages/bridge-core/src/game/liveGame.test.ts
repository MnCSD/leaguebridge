import { LiveGame } from '@league-remote/protocol';
import { describe, expect, it } from 'vitest';
import { FakeLiveGame } from '../dev/fakeLiveGame';
import { LiveGameTracker, normalizeLiveGame, type RawAllGameData } from './liveGame';

const fake = new FakeLiveGame();
const at = (t: number, history: [number, number][] = []) => normalizeLiveGame(fake.snapshot(t), history, 1_000);

describe('live game (normalized from the game API)', () => {
  it('matches the LiveGame schema and finds me', () => {
    const g = LiveGame.parse(at(200));
    expect(g.myTeam).toBe('ORDER');
    expect(g.players).toHaveLength(10);
    expect(g.players.filter((p) => p.isMe)).toEqual([expect.objectContaining({ name: 'FakeMe', champion: 'Irelia', championName: 'Irelia' })]);
    expect(g.players.find((p) => p.name === 'Treeline')!.champion).toBe('LeeSin');
    expect(g.mode).toBe('CLASSIC');
  });

  it('first blood and kills credit the right players and teams', () => {
    const g = at(200);
    const fb = g.events.find((e) => e.kind === 'firstBlood')!;
    expect(fb).toMatchObject({ killer: 'Gauntlets', team: 'CHAOS' });
    expect(g.events.find((e) => e.kind === 'kill')).toMatchObject({ killer: 'Gauntlets', victim: 'Axeman', team: 'CHAOS' });
  });

  it('objectives: dragons (in order), grubs, herald, towers by the team that took them', () => {
    const g = at(1100);
    expect(g.objectives.CHAOS.dragons).toEqual(['Fire', 'Earth']);
    expect(g.objectives.ORDER.dragons).toEqual(['Hextech']);
    expect(g.objectives.ORDER).toMatchObject({ grubs: 1, heralds: 1, towers: 1 }); // Turret_T2_* is CHAOS's tower
    expect(g.objectives.CHAOS.towers).toBe(1); // Turret_T1_* is ORDER's tower
    expect(g.events.find((e) => e.kind === 'dragon' && e.detail === 'Hextech')!.stolen).toBe(true);
  });

  it('my death: dead with a respawn timer', () => {
    const me = at(705).players.find((p) => p.isMe)!;
    expect(me.isDead).toBe(true);
    expect(me.respawnSeconds).toBeGreaterThan(5);
    expect(at(800).players.find((p) => p.isMe)!.isDead).toBe(false);
  });

  it('pentakill, ace, and the win', () => {
    const g = at(1440);
    expect(g.events.filter((e) => e.kind === 'multikill' && e.killer === 'FakeMe').map((e) => e.detail)).toEqual(['2', '3', '4', '5']);
    expect(g.events.find((e) => e.kind === 'ace')).toMatchObject({ killer: 'FakeMe', team: 'ORDER' });
    expect(g.result).toBe('Win');
    expect(g.events.at(-1)).toMatchObject({ kind: 'gameEnd', detail: 'Win', team: 'ORDER' });
    expect(g.players.find((p) => p.isMe)).toMatchObject({ kills: 6, deaths: 1 });
  });

  it('gold: CHAOS ahead early, ORDER ahead after the turnaround; history samples every 15s', () => {
    expect(at(900).goldDiff).toBeLessThan(0);
    expect(at(1400).goldDiff).toBeGreaterThan(0);
    let history: [number, number][] = [];
    for (let t = 0; t <= 60; t += 1) history = at(t, history).goldHistory;
    expect(history.map(([t]) => t)).toEqual([0, 15, 30, 45, 60]);
  });

  it('skips events it does not know, and survives missing fields', () => {
    const raw: RawAllGameData = {
      gameData: { gameTime: 10 },
      allPlayers: [{ riotId: 'A#1', team: 'CHAOS' }],
      activePlayer: { riotId: 'A#1' },
      events: { Events: [{ EventID: 1, EventName: 'SomethingNew' }, { EventID: 2, EventName: 'ChampionKill', KillerName: 'Minion_T1' }] },
    };
    const g = LiveGame.parse(normalizeLiveGame(raw, [], 0));
    expect(g.myTeam).toBe('CHAOS');
    expect(g.events).toEqual([expect.objectContaining({ kind: 'kill', killer: null, team: null })]);
  });

  it('the tracker polls while started and reports null when stopped', async () => {
    const updates: (LiveGame | null)[] = [];
    let calls = 0;
    const tracker = new LiveGameTracker({
      fetch: async () => (++calls === 1 ? null : fake.snapshot(300)), // first poll: still loading
      onUpdate: (g) => updates.push(g),
      pollMs: 5,
    });
    tracker.start();
    await new Promise((r) => setTimeout(r, 40));
    tracker.stop();
    expect(updates.at(-1)).toBeNull();
    expect(updates.filter(Boolean).length).toBeGreaterThan(0);
  });
});
