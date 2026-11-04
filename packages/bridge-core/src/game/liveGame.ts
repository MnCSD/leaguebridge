/**
 * The running game, from Riot's Live Client Data API (https://127.0.0.1:2999/liveclientdata/...),
 * which the game itself serves on the PC while a match is running. Read-only, no auth; it uses a
 * self-signed certificate, so verification is off for this one local address only.
 * https://developer.riotgames.com/docs/lol#game-client-api
 *
 * Polled once a second while the gameflow phase says a game is running; the API only answers once
 * the game has loaded. Everything is parsed defensively: event fields aren't documented by Riot,
 * unknown events are skipped, missing fields become 0/"" rather than errors.
 */
import https from 'node:https';
import type { LiveEvent, LiveGame, LivePlayer, Team } from '@league-remote/protocol';

export const LIVE_CLIENT_URL = 'https://127.0.0.1:2999';
const ALL_GAME_DATA = '/liveclientdata/allgamedata';

/** Gameflow phases in which the game (and its API) may be running. */
export const GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect']);
/** Right after the game closes: keep showing the last snapshot (the result) until the lobby. */
export const POST_GAME_PHASES = new Set(['WaitingForStats', 'PreEndOfGame']);

const MAX_EVENTS = 40;
const GOLD_SAMPLE_SECONDS = 15;

// --- Riot's payload (fields as in their docs and samples; all optional on purpose) --------------

interface RawItem {
  itemID?: number;
  price?: number;
  count?: number;
  slot?: number;
}
interface RawPlayer {
  championName?: string;
  rawChampionName?: string;
  riotId?: string;
  riotIdGameName?: string;
  summonerName?: string;
  team?: string;
  position?: string;
  level?: number;
  isBot?: boolean;
  isDead?: boolean;
  respawnTimer?: number;
  items?: RawItem[];
  scores?: { kills?: number; deaths?: number; assists?: number; creepScore?: number; wardScore?: number };
}
interface RawEvent {
  EventID?: number;
  EventName?: string;
  EventTime?: number;
  KillerName?: string;
  VictimName?: string;
  Assisters?: string[];
  Recipient?: string;
  Acer?: string;
  AcingTeam?: string;
  KillStreak?: number;
  DragonType?: string;
  Stolen?: string | boolean;
  TurretKilled?: string;
  InhibKilled?: string;
  Result?: string;
}
export interface RawAllGameData {
  activePlayer?: { riotId?: string; riotIdGameName?: string; summonerName?: string; currentGold?: number };
  allPlayers?: RawPlayer[];
  events?: { Events?: RawEvent[] };
  gameData?: { gameMode?: string; gameTime?: number };
}

// --- normalizing -------------------------------------------------------------------------------

const team = (t: string | undefined): Team => (t === 'CHAOS' ? 'CHAOS' : 'ORDER');
const other = (t: Team): Team => (t === 'ORDER' ? 'CHAOS' : 'ORDER');
const gameName = (riotId: string | undefined) => (riotId ?? '').split('#')[0]!;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** "game_character_displayname_MonkeyKing" -> "MonkeyKing" */
const championAlias = (p: RawPlayer) => (p.rawChampionName ?? '').replace(/^game_character_displayname_/, '') || (p.championName ?? '').replace(/[^A-Za-z]/g, '');

/**
 * Turns one /allgamedata answer into LiveGame. `history` is the gold graph so far (the tracker keeps
 * it between polls); a new sample is added every 15s of game time.
 */
export function normalizeLiveGame(raw: RawAllGameData, history: [number, number][], receivedAt: number): LiveGame {
  const rawPlayers = raw.allPlayers ?? [];
  const meKeys = [raw.activePlayer?.riotId, raw.activePlayer?.riotIdGameName, raw.activePlayer?.summonerName].filter(Boolean).map((s) => s!.toLowerCase());
  const isMe = (p: RawPlayer) => [p.riotId, p.riotIdGameName, p.summonerName].some((k) => !!k && meKeys.includes(k.toLowerCase()));

  const players: LivePlayer[] = rawPlayers.map((p) => {
    const items = [...(p.items ?? [])].sort((a, b) => num(a.slot) - num(b.slot));
    return {
      name: p.riotIdGameName || gameName(p.riotId) || gameName(p.summonerName) || p.championName || '?',
      champion: championAlias(p),
      championName: p.championName ?? '',
      team: team(p.team),
      position: p.position && p.position !== 'NONE' ? p.position : null,
      level: num(p.level),
      kills: num(p.scores?.kills),
      deaths: num(p.scores?.deaths),
      assists: num(p.scores?.assists),
      cs: num(p.scores?.creepScore),
      wardScore: Math.round(num(p.scores?.wardScore)),
      items: items.map((i) => num(i.itemID)).filter((id) => id > 0),
      itemGold: items.reduce((sum, i) => sum + num(i.price) * Math.max(1, num(i.count)), 0),
      isDead: !!p.isDead,
      respawnSeconds: Math.max(0, num(p.respawnTimer)),
      isMe: isMe(p),
      isBot: !!p.isBot,
    };
  });
  const me = players.find((p) => p.isMe);
  const myTeam: Team = me?.team ?? 'ORDER';

  // Event names refer to players by summoner name / Riot ID / game name: accept any of them.
  const byKey = new Map<string, LivePlayer>();
  rawPlayers.forEach((p, i) => {
    for (const k of [p.riotId, p.riotIdGameName, p.summonerName, gameName(p.riotId)]) if (k) byKey.set(k.toLowerCase(), players[i]!);
  });
  const player = (name: string | undefined) => (name ? byKey.get(name.toLowerCase()) : undefined);

  const events: LiveEvent[] = [];
  const objectives = {
    ORDER: { dragons: [] as string[], barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0 },
    CHAOS: { dragons: [] as string[], barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0 },
  };
  let result: LiveGame['result'] = null;

  for (const e of raw.events?.Events ?? []) {
    const killer = player(e.KillerName);
    const base = {
      id: num(e.EventID),
      time: num(e.EventTime),
      killer: killer?.name ?? null,
      victim: player(e.VictimName)?.name ?? null,
      assisters: (e.Assisters ?? []).map((a) => player(a)?.name).filter((a): a is string => !!a),
      team: killer?.team ?? null,
      detail: null as string | null,
      stolen: e.Stolen === true || e.Stolen === 'True',
    };
    switch (e.EventName) {
      case 'ChampionKill':
        events.push({ ...base, kind: 'kill' });
        break;
      case 'FirstBlood': {
        const p = player(e.Recipient);
        events.push({ ...base, kind: 'firstBlood', killer: p?.name ?? null, team: p?.team ?? null });
        break;
      }
      case 'Multikill':
        events.push({ ...base, kind: 'multikill', detail: String(num(e.KillStreak)) });
        break;
      case 'Ace': {
        const t = e.AcingTeam === 'ORDER' || e.AcingTeam === 'CHAOS' ? e.AcingTeam : (player(e.Acer)?.team ?? null);
        events.push({ ...base, kind: 'ace', killer: player(e.Acer)?.name ?? null, team: t });
        break;
      }
      case 'DragonKill':
        events.push({ ...base, kind: 'dragon', detail: e.DragonType ?? null });
        if (killer) objectives[killer.team].dragons.push(e.DragonType ?? 'Dragon');
        break;
      case 'BaronKill':
        events.push({ ...base, kind: 'baron' });
        if (killer) objectives[killer.team].barons++;
        break;
      case 'HeraldKill':
        events.push({ ...base, kind: 'herald' });
        if (killer) objectives[killer.team].heralds++;
        break;
      case 'HordeKill':
        events.push({ ...base, kind: 'grubs' });
        if (killer) objectives[killer.team].grubs++;
        break;
      case 'TurretKilled': {
        // "Turret_T1_..." is ORDER's tower: CHAOS took it (whoever got the last hit).
        const owner = /_T1_/.test(e.TurretKilled ?? '') ? 'ORDER' : /_T2_/.test(e.TurretKilled ?? '') ? 'CHAOS' : null;
        const gainer = owner ? other(owner) : (killer?.team ?? null);
        events.push({ ...base, kind: 'turret', team: gainer });
        if (gainer) objectives[gainer].towers++;
        break;
      }
      case 'InhibKilled': {
        const owner = /_T1/.test(e.InhibKilled ?? '') ? 'ORDER' : /_T2/.test(e.InhibKilled ?? '') ? 'CHAOS' : null;
        const gainer = owner ? other(owner) : (killer?.team ?? null);
        events.push({ ...base, kind: 'inhibitor', team: gainer });
        if (gainer) objectives[gainer].inhibitors++;
        break;
      }
      case 'GameEnd':
        result = e.Result === 'Win' ? 'Win' : e.Result === 'Lose' ? 'Lose' : null;
        events.push({ ...base, kind: 'gameEnd', detail: result, team: result ? (result === 'Win' ? myTeam : other(myTeam)) : null });
        break;
    }
  }

  const teamGold = (t: Team) => players.filter((p) => p.team === t).reduce((s, p) => s + p.itemGold, 0);
  const goldDiff = teamGold(myTeam) - teamGold(other(myTeam));
  const gameTime = num(raw.gameData?.gameTime);
  const last = history[history.length - 1];
  // The phone draws the live value at the end of the line; history only keeps the samples.
  const goldHistory: [number, number][] = !last || gameTime - last[0] >= GOLD_SAMPLE_SECONDS ? [...history, [Math.round(gameTime), goldDiff]] : history;

  return {
    gameTime,
    receivedAt,
    mode: raw.gameData?.gameMode ?? '',
    myTeam,
    myGold: Math.floor(num(raw.activePlayer?.currentGold)),
    players,
    events: events.slice(-MAX_EVENTS),
    goldDiff,
    goldHistory,
    objectives,
    result,
  };
}

// --- polling -----------------------------------------------------------------------------------

export type FetchGame = () => Promise<RawAllGameData | null>;

/** GET /allgamedata from the game. null while the game isn't up (loading screen, no game). */
export function fetchFromGame(baseUrl = LIVE_CLIENT_URL): FetchGame {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  return () =>
    new Promise((resolve) => {
      const req = https.get(baseUrl + ALL_GAME_DATA, { agent, timeout: 2000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as RawAllGameData);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
    });
}

/** Polls while started; reports each normalized snapshot, and null when the game goes away. */
export class LiveGameTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private history: [number, number][] = [];
  private lastGameTime = -1;
  /** A snapshot was reported and not cleared yet. */
  private hasData = false;

  constructor(
    private readonly opts: { fetch: FetchGame; onUpdate: (game: LiveGame | null) => void; pollMs?: number; now?: () => number },
  ) {}

  get active() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.history = [];
    this.lastGameTime = -1;
    void this.poll();
  }

  /** `keepLast`: stop polling but leave the last snapshot in place (the game just ended). */
  stop(keepLast = false) {
    if (!this.running) {
      if (!keepLast && this.hasData) this.opts.onUpdate(null);
      this.hasData = keepLast && this.hasData;
      return;
    }
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!keepLast) {
      this.hasData = false;
      this.opts.onUpdate(null);
    }
  }

  private async poll() {
    const raw = await this.opts.fetch().catch(() => null);
    if (!this.running) return;
    if (raw?.gameData) {
      const now = (this.opts.now ?? Date.now)();
      // A clock that went backwards means a new game (or a replay): start the graph over.
      if (num(raw.gameData.gameTime) < this.lastGameTime) this.history = [];
      this.lastGameTime = num(raw.gameData.gameTime);
      const game = normalizeLiveGame(raw, this.history, now);
      this.history = game.goldHistory;
      this.hasData = true;
      this.opts.onUpdate(game);
    }
    this.timer = setTimeout(() => void this.poll(), this.opts.pollMs ?? 1000);
  }
}
