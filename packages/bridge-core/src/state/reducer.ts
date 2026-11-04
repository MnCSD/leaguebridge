/**
 * Turns raw League client payloads into a BridgeState.
 *
 * Two steps, both pure functions (no I/O, no clock), which makes them easy to test:
 *   1. applyUpdate(cache, uri, data, at)  – remember the latest payload per endpoint we care about
 *   2. buildState(cache, client, prev)    – derive the whole BridgeState from those payloads
 *
 * Rebuilding from the cache each time (instead of patching state event by event) means the order
 * events arrive in doesn't matter, e.g. skins arriving before or after the champ select session.
 * Field names below were checked against real recordings unless marked UNVERIFIED.
 */
import {
  EMPTY_STATE,
  STATE_VERSION,
  type BridgeState,
  type ChampSelect,
  type ChampSelectPlayer,
  type LiveGame,
  type Lobby,
  type Me,
  type Queue,
  type Runes,
  type Skin,
} from '@league-remote/protocol';
import { GAME_PHASES, POST_GAME_PHASES } from '../game/liveGame';

export const URIS = {
  phase: '/lol-gameflow/v1/gameflow-phase',
  session: '/lol-gameflow/v1/session',
  me: '/lol-chat/v1/me',
  summoner: '/lol-summoner/v1/current-summoner',
  /** Not a client endpoint: the bridge stores looked-up names here as { [puuid]: "Name#TAG" }. */
  names: 'bridge://names',
  lobby: '/lol-lobby/v2/lobby',
  search: '/lol-matchmaking/v1/search',
  readyCheck: '/lol-matchmaking/v1/ready-check',
  champSelect: '/lol-champ-select/v1/session',
  pickable: '/lol-champ-select/v1/pickable-champion-ids',
  bannable: '/lol-champ-select/v1/bannable-champion-ids',
  disabled: '/lol-champ-select/v1/disabled-champion-ids',
  skins: '/lol-champ-select/v1/skin-carousel-skins',
  perkPages: '/lol-perks/v1/pages',
  currentPage: '/lol-perks/v1/currentpage',
  /** Not a client endpoint: the running game, already normalized (game/liveGame.ts). */
  liveGame: 'bridge://live-game',
} as const;

type Key = keyof typeof URIS;
const KEY_BY_URI = new Map(Object.entries(URIS).map(([key, uri]) => [uri as string, key as Key]));

export const READY_CHECK_MS = 12_000;

/** Timer values that moved by less than this are treated as unchanged (see stabilizeTimers). */
const TIMER_JITTER_MS = 1500;

export interface CacheEntry {
  data: unknown;
  /** When we received it (epoch ms). Timers are computed relative to this. */
  at: number;
}
export type LcuCache = Partial<Record<Key, CacheEntry>>;

export function isTrackedUri(uri: string) {
  return KEY_BY_URI.has(uri);
}

/** `data` null/undefined = the endpoint was deleted or returned 404. Returns the same object if nothing changed. */
export function applyUpdate(cache: LcuCache, uri: string, data: unknown, at: number): LcuCache {
  const key = KEY_BY_URI.get(uri);
  if (!key) return cache;
  const next = { ...cache };
  if (data === null || data === undefined) delete next[key];
  else next[key] = { data, at };
  return next;
}

export function buildState(cache: LcuCache, client: BridgeState['client'], prev?: BridgeState): BridgeState {
  if (client === 'disconnected') return EMPTY_STATE;
  const me = buildMe(cache);
  const myPuuid = (cache.me?.data as RawChatMe | undefined)?.puuid ?? (cache.summoner?.data as RawSummoner | undefined)?.puuid;
  const phase = typeof cache.phase?.data === 'string' ? cache.phase.data : 'None';
  const next: BridgeState = {
    v: STATE_VERSION,
    client,
    phase,
    me,
    queue: buildQueue(cache),
    lobby: buildLobby(cache, me, myPuuid),
    matchmaking: buildMatchmaking(cache),
    readyCheck: buildReadyCheck(cache),
    // The client switches the phase to GameStart/InProgress a few ms BEFORE it deletes the
    // champ select session (seen in recordings), so the phase decides.
    champSelect: phase === 'ChampSelect' ? buildChampSelect(cache) : null,
    runes: buildRunes(cache),
    game: GAME_PHASES.has(phase) || POST_GAME_PHASES.has(phase) ? ((cache.liveGame?.data as LiveGame | undefined) ?? null) : null,
  };
  return prev ? stabilizeTimers(next, prev) : next;
}

/**
 * Timers are computed as "time we received the event + time left". Our receive time jitters by
 * ~100ms per event, so without this every 1-per-second update would change `endsAt` a little and
 * send a pointless update to the phone. Small changes keep the previous value; real ones go through.
 */
export function stabilizeTimers(next: BridgeState, prev: BridgeState): BridgeState {
  const close = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && Math.abs(a - b) < TIMER_JITTER_MS;

  let out = next;
  if (next.matchmaking && prev.matchmaking && close(next.matchmaking.startedAt, prev.matchmaking.startedAt)) {
    out = { ...out, matchmaking: { ...next.matchmaking, startedAt: prev.matchmaking.startedAt } };
  }
  if (next.readyCheck && prev.readyCheck && close(next.readyCheck.endsAt, prev.readyCheck.endsAt)) {
    out = { ...out, readyCheck: { ...next.readyCheck, endsAt: prev.readyCheck.endsAt } };
  }
  const cs = next.champSelect;
  const pcs = prev.champSelect;
  if (cs && pcs && cs.phase === pcs.phase && close(cs.timer.endsAt, pcs.timer.endsAt)) {
    out = { ...out, champSelect: { ...cs, timer: { ...cs.timer, endsAt: pcs.timer.endsAt } } };
  }
  return out;
}

// --- raw payload shapes (only the fields we read) --------------------------------------------

interface RawChatMe {
  gameName?: string;
  gameTag?: string;
  icon?: number;
  puuid?: string;
}
interface RawSummoner {
  gameName?: string;
  tagLine?: string;
  profileIconId?: number;
  puuid?: string;
}
interface RawGameflowSession {
  gameData?: { queue?: { id?: number; shortName?: string; description?: string; name?: string; category?: string; isRanked?: boolean } };
}
interface RawLobbyMember {
  puuid?: string;
  summonerIconId?: number;
  summonerLevel?: number;
  isLeader?: boolean;
  isBot?: boolean;
  ready?: boolean;
  firstPositionPreference?: string | null;
  secondPositionPreference?: string | null;
}
interface RawLobby {
  partyId?: string;
  canStartActivity?: boolean;
  gameConfig?: {
    queueId?: number;
    showPositionSelector?: boolean;
    maxLobbySize?: number;
    /** Custom games: both teams, bots included ({ isBot, botChampionId }). */
    customTeam100?: { isBot?: boolean; botChampionId?: number }[];
    customTeam200?: { isBot?: boolean; botChampionId?: number }[];
  };
  localMember?: RawLobbyMember;
  members?: RawLobbyMember[];
}
interface RawSearch {
  searchState?: string;
  timeInQueue?: number;
  estimatedQueueTime?: number;
}
interface RawReadyCheck {
  state?: string;
  playerResponse?: string;
  timer?: number;
}
interface RawAction {
  id: number;
  actorCellId: number;
  championId: number;
  completed: boolean;
  isInProgress: boolean;
  isAllyAction: boolean;
  type: string;
}
interface RawCsMember {
  cellId: number;
  championId?: number;
  championPickIntent?: number;
  gameName?: string;
  tagLine?: string;
  nameVisibilityType?: string;
  assignedPosition?: string;
  spell1Id?: number;
  spell2Id?: number;
  selectedSkinId?: number;
  playerType?: string;
}
interface RawCsSession {
  gameId?: number;
  queueId?: number;
  localPlayerCellId?: number;
  actions?: RawAction[][];
  myTeam?: RawCsMember[];
  theirTeam?: RawCsMember[];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[]; numBans?: number };
  timer?: { phase?: string; adjustedTimeLeftInPhase?: number; totalTimeInPhase?: number; isInfinite?: boolean };
  hasSimultaneousPicks?: boolean;
  hasSimultaneousBans?: boolean;
  allowSkinSelection?: boolean;
  disallowBanningTeammateHoveredChampions?: boolean;
}
interface RawSkin {
  id: number;
  name?: string;
  unlocked?: boolean;
  disabled?: boolean;
  splashPath?: string;
  tilePath?: string;
  childSkins?: { id: number; name?: string; colors?: string[]; unlocked?: boolean; chromaPreviewPath?: string }[];
}
interface RawPerkPage {
  id: number;
  name?: string;
  current?: boolean;
  isEditable?: boolean;
  isTemporary?: boolean;
  isValid?: boolean;
  primaryStyleId?: number;
  subStyleId?: number;
  selectedPerkIds?: number[];
}

// --- builders --------------------------------------------------------------------------------

const ids = (v: unknown): number[] | null => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : null);
const orNull = (s: string | null | undefined) => (s ? s : null);

function buildMe(cache: LcuCache): Me | null {
  // Chat updates often (icon changes show there first); the summoner endpoint is read on connect.
  const chat = cache.me?.data as RawChatMe | undefined;
  if (chat?.gameName) return { name: chat.gameName, tagLine: chat.gameTag ?? '', iconId: chat.icon ?? 0 };
  const s = cache.summoner?.data as RawSummoner | undefined;
  if (s?.gameName) return { name: s.gameName, tagLine: s.tagLine ?? '', iconId: s.profileIconId ?? 0 };
  return null;
}

/** Names the bridge looked up for lobby members (puuid -> "Name#TAG"). */
function lookedUpNames(cache: LcuCache): Record<string, string> {
  const d = cache.names?.data;
  return d && typeof d === 'object' ? (d as Record<string, string>) : {};
}

function buildQueue(cache: LcuCache): Queue | null {
  const q = (cache.session?.data as RawGameflowSession | undefined)?.gameData?.queue;
  if (!q?.id || q.id <= 0) return null;
  return {
    id: q.id,
    name: q.shortName || q.description || q.name || `Queue ${q.id}`,
    category: q.category ?? '',
    isRanked: !!q.isRanked,
  };
}

function buildLobby(cache: LcuCache, me: Me | null, myPuuid: string | undefined): Lobby | null {
  const d = cache.lobby?.data as RawLobby | undefined;
  if (!d?.members) return null;
  const localPuuid = d.localMember?.puuid ?? myPuuid;
  const names = lookedUpNames(cache);
  return {
    partyId: d.partyId ?? '',
    queueId: d.gameConfig?.queueId ?? 0,
    canStart: !!d.canStartActivity,
    showPositionSelector: !!d.gameConfig?.showPositionSelector,
    maxSize: d.gameConfig?.maxLobbySize ?? 5,
    members: d.members.map((m) => {
      const isMe = !!m.puuid && m.puuid === localPuuid;
      return {
        puuid: m.puuid ?? '',
        // Other members' names aren't in this payload; the bridge looks them up separately.
        name: isMe && me ? me.name : (m.puuid && names[m.puuid]) || null,
        iconId: m.summonerIconId ?? 0,
        level: m.summonerLevel ?? 0,
        isMe,
        isLeader: !!m.isLeader,
        isBot: !!m.isBot,
        ready: !!m.ready,
        positions: [orNull(m.firstPositionPreference), orNull(m.secondPositionPreference)],
      };
    }),
  };
}

function buildMatchmaking(cache: LcuCache) {
  const entry = cache.search;
  const d = entry?.data as RawSearch | undefined;
  if (!entry || !d?.searchState || d.searchState === 'Invalid') return null;
  return {
    state: d.searchState,
    startedAt: entry.at - (d.timeInQueue ?? 0) * 1000,
    estimatedMs: d.estimatedQueueTime && d.estimatedQueueTime > 0 ? Math.round(d.estimatedQueueTime * 1000) : null,
  };
}

function buildReadyCheck(cache: LcuCache) {
  const entry = cache.readyCheck;
  const d = entry?.data as RawReadyCheck | undefined;
  if (!entry || !d?.state || d.state === 'Invalid') return null;
  return {
    state: d.state,
    response: d.playerResponse ?? 'None',
    // `timer` counts UP (seconds since the pop appeared).
    endsAt: entry.at + READY_CHECK_MS - (d.timer ?? 0) * 1000,
    totalMs: READY_CHECK_MS,
  };
}

function buildChampSelect(cache: LcuCache): ChampSelect | null {
  const entry = cache.champSelect;
  const s = entry?.data as RawCsSession | undefined;
  if (!entry || !s || s.localPlayerCellId === undefined) return null;

  // Only pick/ban matter; draft also has a "ten_bans_reveal" step (actorCellId -1).
  const actions = (s.actions ?? []).flat().filter((a) => a.type === 'pick' || a.type === 'ban');
  const myCellId = s.localPlayerCellId;
  const timer = s.timer ?? {};
  // In PLANNING the client marks every ban action "in progress", but nobody can act yet:
  // turns only count during BAN_PICK. (Seen in a real Draft recording.)
  const turnsActive = timer.phase === 'BAN_PICK';
  const isTurn = (a: RawAction) => turnsActive && a.isInProgress && !a.completed;

  // Per-cell facts derived from the action list.
  const lockedPick = new Map<number, number>(); // cellId -> champion locked in
  const hasPickAction = new Set<number>();
  const acting = new Map<number, 'pick' | 'ban'>();
  const pickHover = new Map<number, number>(); // champion in an in-progress pick
  const banHover = new Map<number, number>(); // champion in an in-progress ban
  for (const a of actions) {
    if (a.type === 'pick') hasPickAction.add(a.actorCellId);
    if (a.type === 'pick' && a.completed && a.championId) lockedPick.set(a.actorCellId, a.championId);
    if (isTurn(a)) {
      acting.set(a.actorCellId, a.type as 'pick' | 'ban');
      if (a.championId) (a.type === 'pick' ? pickHover : banHover).set(a.actorCellId, a.championId);
    }
  }

  // Champ select doesn't mark custom-game bots (playerType is "", and isHumanoid is meaningless:
  // false for me, true for ally bots), but the lobby lists each bot with its champion.
  // (Seen in a real custom Draft game vs bots.)
  const lobbyConfig = (cache.lobby?.data as RawLobby | undefined)?.gameConfig;
  const botChampions = new Set(
    [...(lobbyConfig?.customTeam100 ?? []), ...(lobbyConfig?.customTeam200 ?? [])]
      .filter((b) => b.isBot && b.botChampionId)
      .map((b) => b.botChampionId!),
  );
  const isBot = (m: RawCsMember) =>
    (m.playerType ?? '').toLowerCase() === 'bot' ||
    (m.cellId !== myCellId && !m.gameName && !!m.championId && botChampions.has(m.championId));

  const player = (m: RawCsMember): ChampSelectPlayer => {
    // If a player has no pick action at all (seen for some bot/enemy slots), trust their championId.
    const championId = lockedPick.get(m.cellId) ?? (hasPickAction.has(m.cellId) ? 0 : (m.championId ?? 0));
    // Hover: the champion in their in-progress pick, else their declared intent.
    const hoverId = championId !== 0 ? 0 : pickHover.get(m.cellId) || m.championPickIntent || m.championId || 0;
    const hidden = m.nameVisibilityType === 'HIDDEN';
    return {
      cellId: m.cellId,
      name: !hidden && m.gameName ? (m.tagLine ? `${m.gameName}#${m.tagLine}` : m.gameName) : null,
      position: orNull(m.assignedPosition),
      championId,
      hoverId,
      banHoverId: banHover.get(m.cellId) ?? 0,
      acting: acting.get(m.cellId) ?? null,
      spell1Id: m.spell1Id ?? 0,
      spell2Id: m.spell2Id ?? 0,
      skinId: m.selectedSkinId ?? 0,
      isMe: m.cellId === myCellId,
      isBot: isBot(m),
    };
  };

  // Bans come from completed ban actions: in a real Draft game `s.bans` stayed empty (numBans 0)
  // the whole time. It's still merged in, in case other modes fill it.
  // Teammates' bans show as they lock; the enemy's appear all at once at the reveal step.
  const myBans = new Set(s.bans?.myTeamBans ?? []);
  const theirBans = new Set(s.bans?.theirTeamBans ?? []);
  let allyBanSlots = 0;
  for (const a of actions) {
    if (a.type !== 'ban') continue;
    if (a.isAllyAction) allyBanSlots++;
    if (a.completed && a.championId) (a.isAllyAction ? myBans : theirBans).add(a.championId);
  }

  const mine = actions.find((a) => a.actorCellId === myCellId && isTurn(a));
  const myPick = actions.find((a) => a.actorCellId === myCellId && a.type === 'pick' && !a.completed);
  const skins = (cache.skins?.data as RawSkin[] | undefined) ?? [];

  return {
    gameId: s.gameId ?? 0,
    queueId: s.queueId ?? 0,
    phase: timer.phase ?? '',
    timer: {
      endsAt: timer.isInfinite ? null : entry.at + (timer.adjustedTimeLeftInPhase ?? 0),
      totalMs: timer.totalTimeInPhase ?? 0,
    },
    simultaneousPicks: !!s.hasSimultaneousPicks,
    simultaneousBans: !!s.hasSimultaneousBans,
    myCellId,
    myTeam: (s.myTeam ?? []).map(player),
    theirTeam: (s.theirTeam ?? []).map(player),
    bans: { myTeam: [...myBans], theirTeam: [...theirBans], perTeam: Math.max(s.bans?.numBans ?? 0, allyBanSlots) },
    myAction: mine ? { id: mine.id, type: mine.type as 'pick' | 'ban', championId: mine.championId } : null,
    myPickActionId: myPick?.id ?? null,
    pickableChampionIds: ids(cache.pickable?.data),
    bannableChampionIds: ids(cache.bannable?.data),
    disabledChampionIds: ids(cache.disabled?.data) ?? [],
    allowSkinSelection: s.allowSkinSelection ?? true,
    banTeammateHoversBlocked: !!s.disallowBanningTeammateHoveredChampions,
    skins: Array.isArray(skins) ? skins.map(toSkin) : [],
  };
}

function toSkin(s: RawSkin): Skin {
  return {
    id: s.id,
    name: s.name ?? '',
    owned: !!s.unlocked,
    disabled: !!s.disabled,
    splashPath: s.splashPath ?? '',
    tilePath: s.tilePath ?? '',
    chromas: (s.childSkins ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? '',
      colors: c.colors ?? [],
      owned: !!c.unlocked,
      previewPath: c.chromaPreviewPath ?? '',
    })),
  };
}

function buildRunes(cache: LcuCache): Runes | null {
  const pages = cache.perkPages?.data as RawPerkPage[] | undefined;
  const current = cache.currentPage?.data as RawPerkPage | undefined;
  if (!Array.isArray(pages) && !current) return null;
  const list = Array.isArray(pages) ? [...pages] : [];
  // The current page can be a temporary one the client made on lock-in, missing from /pages.
  if (current?.id !== undefined && !list.some((p) => p.id === current.id)) list.unshift(current);
  return {
    currentPageId: current?.id ?? list.find((p) => p.current)?.id ?? null,
    pages: list.map((p) => ({
      id: p.id,
      name: p.name ?? '',
      isEditable: !!p.isEditable,
      isTemporary: !!p.isTemporary,
      isValid: p.isValid ?? true,
      primaryStyleId: p.primaryStyleId ?? 0,
      subStyleId: p.subStyleId ?? 0,
      selectedPerkIds: p.selectedPerkIds ?? [],
    })),
  };
}
