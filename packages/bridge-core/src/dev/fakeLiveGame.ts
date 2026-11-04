/**
 * A fake running game for testing the phone's in-game screen without playing. DEV ONLY.
 *
 * Serves https://127.0.0.1:<port>/liveclientdata/allgamedata like the real game (self-signed
 * certificate, no auth) and plays a scripted match: kills, first blood, dragons, grubs, herald,
 * towers, my death, my pentakill + ace, baron, inhibitors and a win. `speed` fast-forwards it.
 */
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { generate } from 'selfsigned';
import type { RawAllGameData } from '../game/liveGame';

type Side = 'ORDER' | 'CHAOS';
interface FakePlayer {
  name: string;
  champion: string;
  team: Side;
  position: string;
  /** Item ids bought over the game, with prices, in order. */
  build: [number, number][];
  /** How fast they farm (cs per minute). */
  farm: number;
}

const BUILDS: Record<string, [number, number][]> = {
  fighter: [[1055, 450], [3047, 1100], [3078, 3333], [3071, 3100], [3053, 3100], [6333, 3300]],
  jungle: [[1103, 450], [3111, 1100], [6692, 3200], [3071, 3100], [3026, 3000], [3156, 3100]],
  mage: [[1056, 400], [3020, 1100], [6655, 2900], [3089, 3600], [3157, 3250], [3135, 2800]],
  adc: [[1055, 450], [3006, 1100], [6672, 3000], [3031, 3500], [3085, 2600], [3036, 3000]],
  support: [[3865, 400], [3158, 900], [3190, 2200], [3109, 2300], [3222, 2300], [3504, 2300]],
};

const PLAYERS: FakePlayer[] = [
  { name: 'FakeMe', champion: 'Irelia', team: 'ORDER', position: 'MIDDLE', build: BUILDS.fighter!, farm: 8.4 },
  { name: 'Treeline', champion: 'LeeSin', team: 'ORDER', position: 'JUNGLE', build: BUILDS.jungle!, farm: 5.5 },
  { name: 'Axeman', champion: 'Darius', team: 'ORDER', position: 'TOP', build: BUILDS.fighter!, farm: 7.4 },
  { name: 'Rockets', champion: 'Jinx', team: 'ORDER', position: 'BOTTOM', build: BUILDS.adc!, farm: 8.8 },
  { name: 'Lantern', champion: 'Thresh', team: 'ORDER', position: 'UTILITY', build: BUILDS.support!, farm: 1.1 },
  { name: 'NineTails', champion: 'Ahri', team: 'CHAOS', position: 'MIDDLE', build: BUILDS.mage!, farm: 8.0 },
  { name: 'Gauntlets', champion: 'Vi', team: 'CHAOS', position: 'JUNGLE', build: BUILDS.jungle!, farm: 5.9 },
  { name: 'Demacia', champion: 'Garen', team: 'CHAOS', position: 'TOP', build: BUILDS.fighter!, farm: 7.0 },
  { name: 'Sheriff', champion: 'Caitlyn', team: 'CHAOS', position: 'BOTTOM', build: BUILDS.adc!, farm: 9.2 },
  { name: 'Prism', champion: 'Lux', team: 'CHAOS', position: 'UTILITY', build: BUILDS.support!, farm: 1.3 },
];

type ScriptEvent = { at: number } & Record<string, unknown>;

/** The match, in game seconds. CHAOS leads early, ORDER turns it around with a pentakill. */
const SCRIPT: ScriptEvent[] = [
  { at: 0, EventName: 'GameStart' },
  { at: 65, EventName: 'MinionsSpawning' },
  { at: 190, EventName: 'ChampionKill', KillerName: 'Gauntlets', VictimName: 'Axeman', Assisters: [] },
  { at: 190, EventName: 'FirstBlood', Recipient: 'Gauntlets' },
  { at: 300, EventName: 'DragonKill', DragonType: 'Fire', Stolen: 'False', KillerName: 'Gauntlets', Assisters: ['Sheriff'] },
  { at: 360, EventName: 'HordeKill', KillerName: 'Treeline', Assisters: [] },
  { at: 410, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'NineTails', Assisters: ['Treeline'] },
  { at: 520, EventName: 'ChampionKill', KillerName: 'Sheriff', VictimName: 'Rockets', Assisters: ['Prism'] },
  { at: 525, EventName: 'ChampionKill', KillerName: 'Prism', VictimName: 'Lantern', Assisters: ['Sheriff'] },
  { at: 526, EventName: 'Multikill', KillerName: 'Sheriff', KillStreak: 2 },
  { at: 610, EventName: 'TurretKilled', TurretKilled: 'Turret_T1_R_03_A', KillerName: 'Sheriff', Assisters: [] },
  { at: 700, EventName: 'ChampionKill', KillerName: 'NineTails', VictimName: 'FakeMe', Assisters: ['Gauntlets'] },
  { at: 720, EventName: 'DragonKill', DragonType: 'Earth', Stolen: 'False', KillerName: 'Gauntlets', Assisters: [] },
  { at: 840, EventName: 'HeraldKill', KillerName: 'Treeline', Assisters: ['FakeMe'] },
  { at: 880, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_C_05_A', KillerName: 'FakeMe', Assisters: ['Treeline'] },
  { at: 1020, EventName: 'DragonKill', DragonType: 'Hextech', Stolen: 'True', KillerName: 'Treeline', Assisters: [] },
  { at: 1180, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'Demacia', Assisters: [] },
  { at: 1182, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'Gauntlets', Assisters: ['Lantern'] },
  { at: 1182.5, EventName: 'Multikill', KillerName: 'FakeMe', KillStreak: 2 },
  { at: 1184, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'NineTails', Assisters: [] },
  { at: 1184.5, EventName: 'Multikill', KillerName: 'FakeMe', KillStreak: 3 },
  { at: 1186, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'Sheriff', Assisters: ['Rockets'] },
  { at: 1186.5, EventName: 'Multikill', KillerName: 'FakeMe', KillStreak: 4 },
  { at: 1188, EventName: 'ChampionKill', KillerName: 'FakeMe', VictimName: 'Prism', Assisters: [] },
  { at: 1188.5, EventName: 'Multikill', KillerName: 'FakeMe', KillStreak: 5 },
  { at: 1189, EventName: 'Ace', Acer: 'FakeMe', AcingTeam: 'ORDER' },
  { at: 1230, EventName: 'BaronKill', Stolen: 'False', KillerName: 'Treeline', Assisters: ['FakeMe', 'Axeman'] },
  { at: 1320, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_C_04_A', KillerName: 'Rockets', Assisters: [] },
  { at: 1350, EventName: 'InhibKilled', InhibKilled: 'Barracks_T2_C1', KillerName: 'Axeman', Assisters: ['FakeMe'] },
  { at: 1420, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_C_01_A', KillerName: 'FakeMe', Assisters: [] },
  { at: 1440, EventName: 'GameEnd', Result: 'Win' },
];
const GAME_LENGTH = 1450;

export class FakeLiveGame {
  port = 0;
  private server: https.Server | null = null;
  private startedAt = 0;

  /** `speed`: game seconds per real second. `startAt`: jump to this game time. */
  constructor(private readonly opts: { port?: number; speed?: number; startAt?: number } = {}) {}

  get running() {
    return this.server !== null;
  }

  /** Current game clock in seconds (stops at the end). */
  get gameTime() {
    const t = (this.opts.startAt ?? 0) + ((Date.now() - this.startedAt) / 1000) * (this.opts.speed ?? 1);
    return Math.min(t, GAME_LENGTH);
  }

  async start() {
    if (this.server) return;
    const pems = await generate([{ name: 'commonName', value: 'fake-live-game' }], { keyType: 'ec', algorithm: 'sha256' });
    this.server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
      if (req.url !== '/liveclientdata/allgamedata') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.snapshot()));
    });
    await new Promise<void>((resolve) => this.server!.listen(this.opts.port ?? 2999, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    this.startedAt = Date.now();
  }

  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** What the real game would answer right now. */
  snapshot(t = this.gameTime): RawAllGameData {
    const happened = SCRIPT.filter((e) => e.at <= t);
    const kills = happened.filter((e) => e.EventName === 'ChampionKill');
    const minutes = t / 60;

    const allPlayers = PLAYERS.map((p) => {
      const deaths = kills.filter((k) => k.VictimName === p.name);
      const lastDeath = deaths[deaths.length - 1];
      const level = Math.min(18, 1 + Math.floor(t / 85));
      const respawn = lastDeath ? Math.max(0, lastDeath.at + 8 + level * 1.6 - t) : 0;
      // Items arrive over time; CHAOS farms a bit faster until the pentakill at ~19:40, after
      // which ORDER's bounties and objectives let it catch up and pass them (continuous, no jumps).
      const after = Math.max(0, t - 1180) / 60;
      const earned = p.team === 'CHAOS' ? minutes * 1.03 - after * 0.15 : minutes * 0.95 + after * 1.1;
      const progress = earned / 4.2 + 1;
      const bought = Math.min(p.build.length, Math.floor(progress));
      // Between full items, components (Long Swords) towards the next one, like real shopping.
      const next = p.build[bought];
      const components = next ? Math.floor((progress % 1) * (next[1] / 350)) : 0;
      return {
        championName: p.champion === 'LeeSin' ? 'Lee Sin' : p.champion,
        rawChampionName: `game_character_displayname_${p.champion}`,
        riotId: `${p.name}#FAKE`,
        riotIdGameName: p.name,
        summonerName: `${p.name}#FAKE`,
        team: p.team,
        position: p.position,
        level,
        isBot: false,
        isDead: respawn > 0,
        respawnTimer: respawn,
        items: [
          ...p.build.slice(0, bought).map(([itemID, price], slot) => ({ itemID, price, count: 1, slot })),
          ...(components ? [{ itemID: 1036, price: 350, count: components, slot: bought }] : []),
          { itemID: 3340, price: 0, count: 1, slot: 6 },
        ],
        scores: {
          kills: kills.filter((k) => k.KillerName === p.name).length,
          deaths: deaths.length,
          assists: kills.filter((k) => (k.Assisters as string[]).includes(p.name)).length,
          creepScore: Math.floor(Math.max(0, minutes - 1.5) * p.farm),
          wardScore: Math.round(minutes * (p.position === 'UTILITY' ? 2.1 : 0.6)),
        },
      };
    });

    return {
      activePlayer: { riotId: 'FakeMe#FAKE', riotIdGameName: 'FakeMe', currentGold: Math.round(500 + 1400 * Math.abs(Math.sin(t / 47))) },
      allPlayers,
      events: { Events: happened.map(({ at, ...e }, i) => ({ EventID: i, EventTime: at, ...e })) },
      gameData: { gameMode: 'CLASSIC', gameTime: t },
    };
  }
}
