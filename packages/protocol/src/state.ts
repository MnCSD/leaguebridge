/**
 * BridgeState: the small, clean picture of the League client that the phone sees.
 *
 * Conventions:
 *  - Anything that doesn't exist right now is `null` (no lobby, no pop, not in champ select...).
 *  - Champion / skin / spell / perk values are Riot's numeric ids; 0 means "none".
 *  - Times are epoch milliseconds on the BRIDGE's clock (`endsAt`, `startedAt`). Every message
 *    to the phone also carries the bridge's current time, so the phone can correct for clock skew
 *    and run smooth countdowns between updates.
 */
import { z } from 'zod';

export const STATE_VERSION = 1;

const Id = z.number().int();
const Epoch = z.number();

export const Timer = z.object({
  /** When the current phase ends. null = no time limit (e.g. custom games). */
  endsAt: Epoch.nullable(),
  totalMs: z.number(),
});
export type Timer = z.infer<typeof Timer>;

export const Me = z.object({
  name: z.string(),
  tagLine: z.string(),
  iconId: Id,
});
export type Me = z.infer<typeof Me>;

export const Queue = z.object({
  id: Id,
  /** e.g. "Intro", "Ranked Solo/Duo". */
  name: z.string(),
  /** e.g. "VersusAi", "PvP". */
  category: z.string(),
  isRanked: z.boolean(),
});
export type Queue = z.infer<typeof Queue>;

export const LobbyMember = z.object({
  puuid: z.string(),
  /** Not included in the lobby payload for other players; null until we can resolve it. */
  name: z.string().nullable(),
  iconId: Id,
  level: z.number(),
  isMe: z.boolean(),
  isLeader: z.boolean(),
  isBot: z.boolean(),
  ready: z.boolean(),
  /** e.g. "MIDDLE", "FILL". null = not chosen / not applicable. */
  positions: z.tuple([z.string().nullable(), z.string().nullable()]),
});
export type LobbyMember = z.infer<typeof LobbyMember>;

export const Lobby = z.object({
  partyId: z.string(),
  queueId: Id,
  canStart: z.boolean(),
  showPositionSelector: z.boolean(),
  maxSize: z.number(),
  members: z.array(LobbyMember),
});
export type Lobby = z.infer<typeof Lobby>;

export const Matchmaking = z.object({
  /** "Searching", "Found", ... */
  state: z.string(),
  startedAt: Epoch,
  estimatedMs: z.number().nullable(),
});
export type Matchmaking = z.infer<typeof Matchmaking>;

export const ReadyCheck = z.object({
  /** "InProgress", "EveryoneReady", ... */
  state: z.string(),
  /** "None", "Accepted", "Declined". */
  response: z.string(),
  endsAt: Epoch,
  totalMs: z.number(),
});
export type ReadyCheck = z.infer<typeof ReadyCheck>;

export const ChampSelectPlayer = z.object({
  cellId: Id,
  /** null when hidden (e.g. enemy names in ranked) or unknown. */
  name: z.string().nullable(),
  /** "top" | "jungle" | "middle" | "bottom" | "utility", null when positions aren't used. */
  position: z.string().nullable(),
  /** Locked-in champion, 0 if none yet. */
  championId: Id,
  /** Champion being hovered or declared as pick intent, 0 if none. Only meaningful while not locked. */
  hoverId: Id,
  /** Champion this player is hovering to BAN right now, 0 if none. Visible for teammates only. */
  banHoverId: Id,
  /** What this player is doing right now, if it's their turn (only during BAN_PICK). */
  acting: z.enum(['pick', 'ban']).nullable(),
  spell1Id: Id,
  spell2Id: Id,
  /** Selected skin id, 0 if none. */
  skinId: Id,
  isMe: z.boolean(),
  isBot: z.boolean(),
});
export type ChampSelectPlayer = z.infer<typeof ChampSelectPlayer>;

export const Chroma = z.object({
  id: Id,
  name: z.string(),
  colors: z.array(z.string()),
  owned: z.boolean(),
  /** /lol-game-data/assets/... image of the chroma, "" if none. */
  previewPath: z.string(),
});
export const Skin = z.object({
  id: Id,
  name: z.string(),
  /** Can be selected (owned, or free like the base skin). */
  owned: z.boolean(),
  disabled: z.boolean(),
  /** /lol-game-data/assets/... images (fetch through /assets), "" if none. */
  splashPath: z.string(),
  tilePath: z.string(),
  chromas: z.array(Chroma),
});
export type Skin = z.infer<typeof Skin>;

export const MyAction = z.object({
  /** The action id M5 sends hover/lock/ban to. */
  id: Id,
  type: z.enum(['pick', 'ban']),
  championId: Id,
});
export type MyAction = z.infer<typeof MyAction>;

export const ChampSelect = z.object({
  gameId: z.number(),
  queueId: Id,
  /** "PLANNING", "BAN_PICK", "FINALIZATION", "GAME_STARTING". */
  phase: z.string(),
  timer: Timer,
  simultaneousPicks: z.boolean(),
  simultaneousBans: z.boolean(),
  myCellId: Id,
  myTeam: z.array(ChampSelectPlayer),
  theirTeam: z.array(ChampSelectPlayer),
  bans: z.object({ myTeam: z.array(Id), theirTeam: z.array(Id), perTeam: z.number() }),
  /** My current turn (only during BAN_PICK), or null if I'm not acting right now. */
  myAction: MyAction.nullable(),
  /**
   * My pick action, from the start of champ select until I lock in. Setting a champion on it
   * before my turn declares pick intent (that's how the client does it during PLANNING).
   */
  myPickActionId: Id.nullable(),
  /** null = not sent by the client yet. */
  pickableChampionIds: z.array(Id).nullable(),
  bannableChampionIds: z.array(Id).nullable(),
  disabledChampionIds: z.array(Id),
  allowSkinSelection: z.boolean(),
  /** The client refuses bans on champions a teammate is hovering (normal/ranked draft). */
  banTeammateHoversBlocked: z.boolean(),
  /** Skins for my current champion. Empty until a champion is chosen. */
  skins: z.array(Skin),
});
export type ChampSelect = z.infer<typeof ChampSelect>;

export const RunePage = z.object({
  id: Id,
  name: z.string(),
  isEditable: z.boolean(),
  isTemporary: z.boolean(),
  isValid: z.boolean(),
  primaryStyleId: Id,
  subStyleId: Id,
  /** 9 perk ids: keystone, 3 primary, 2 secondary, 3 stat shards. */
  selectedPerkIds: z.array(Id),
});
export type RunePage = z.infer<typeof RunePage>;

export const Runes = z.object({
  currentPageId: Id.nullable(),
  pages: z.array(RunePage),
});
export type Runes = z.infer<typeof Runes>;

export const BridgeState = z.object({
  v: z.literal(STATE_VERSION),
  /** Is the bridge connected to the League client? */
  client: z.enum(['connected', 'disconnected']),
  /** Gameflow phase: "None", "Lobby", "Matchmaking", "ReadyCheck", "ChampSelect", "InProgress", ... */
  phase: z.string(),
  me: Me.nullable(),
  queue: Queue.nullable(),
  lobby: Lobby.nullable(),
  matchmaking: Matchmaking.nullable(),
  readyCheck: ReadyCheck.nullable(),
  champSelect: ChampSelect.nullable(),
  runes: Runes.nullable(),
});
export type BridgeState = z.infer<typeof BridgeState>;

export const EMPTY_STATE: BridgeState = {
  v: STATE_VERSION,
  client: 'disconnected',
  phase: 'None',
  me: null,
  queue: null,
  lobby: null,
  matchmaking: null,
  readyCheck: null,
  champSelect: null,
  runes: null,
};
