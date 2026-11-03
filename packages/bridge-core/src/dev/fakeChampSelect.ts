/**
 * Champion select + rune pages for the fake League client. DEV ONLY.
 *
 * Shapes follow the real Co-op and Draft recordings:
 *  - draft: 10 simultaneous bans (all "in progress" even during PLANNING), a "ten_bans_reveal"
 *    step, then snake-order picks [[0],[5,6],[1,2],[7,8],[3,4],[9]]; enemies have hidden names
 *  - blind (Co-op style): all 5 allies pick at once, no bans, no enemy team shown
 *  - pick intent is stored on your upcoming pick action; hovering sets championPickIntent
 *  - the skin carousel appears once you lock in
 * Error answers are guesses until a live check: { httpStatus, message }.
 */

type Emit = (uri: string, eventType: string, data: unknown) => void;

interface Action {
  id: number;
  actorCellId: number;
  championId: number;
  completed: boolean;
  isInProgress: boolean;
  isAllyAction: boolean;
  type: string;
}
interface Member {
  cellId: number;
  championId: number;
  championPickIntent: number;
  gameName: string;
  tagLine: string;
  nameVisibilityType: string;
  assignedPosition: string;
  spell1Id: number;
  spell2Id: number;
  selectedSkinId: number;
  playerType: string;
}
interface Session {
  gameId: number;
  queueId: number;
  localPlayerCellId: number;
  hasSimultaneousBans: boolean;
  hasSimultaneousPicks: boolean;
  allowSkinSelection: boolean;
  disallowBanningTeammateHoveredChampions: boolean;
  bans: { myTeamBans: number[]; theirTeamBans: number[]; numBans: number };
  timer: { phase: string; adjustedTimeLeftInPhase: number; totalTimeInPhase: number; isInfinite: boolean };
  myTeam: Member[];
  theirTeam: Member[];
  actions: Action[][];
}
export interface FakePage {
  id: number;
  name: string;
  current: boolean;
  isEditable: boolean;
  isTemporary: boolean;
  isValid: boolean;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
}

const SESSION = '/lol-champ-select/v1/session';
const POSITIONS = ['top', 'jungle', 'middle', 'bottom', 'utility'];
const SNAKE = [[0], [5, 6], [1, 2], [7, 8], [3, 4], [9]];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Rune paths, in the /lol-perks/v1/styles shape. */
const SHARDS = [
  { type: 'kStatMod', perks: [5008, 5005, 5007] },
  { type: 'kStatMod', perks: [5008, 5010, 5001] },
  { type: 'kStatMod', perks: [5011, 5013, 5001] },
];
export const FAKE_STYLES = [
  {
    id: 8000,
    name: 'Precision',
    allowedSubStyles: [8100, 8200, 8300, 8400],
    slots: [
      { type: 'kKeyStone', perks: [8005, 8008, 8021, 8010] },
      { type: 'kMixedRegularSplashable', perks: [9101, 9111, 8009] },
      { type: 'kMixedRegularSplashable', perks: [9104, 9105, 9103] },
      { type: 'kMixedRegularSplashable', perks: [8014, 8017, 8299] },
      ...SHARDS,
    ],
  },
  {
    id: 8100,
    name: 'Domination',
    allowedSubStyles: [8000, 8200, 8300, 8400],
    slots: [
      { type: 'kKeyStone', perks: [8112, 8128, 9923] },
      { type: 'kMixedRegularSplashable', perks: [8126, 8139, 8143] },
      { type: 'kMixedRegularSplashable', perks: [8136, 8120, 8138] },
      { type: 'kMixedRegularSplashable', perks: [8135, 8105, 8106] },
      ...SHARDS,
    ],
  },
];
/** A valid Precision (Conqueror) / Domination page. */
export const VALID_PAGE_PERKS = [8010, 9111, 9104, 8014, 8143, 8135, 5008, 5008, 5001];

export class FakeChampSelect {
  session: Session | null = null;
  /** Champions "you own" (pickable). */
  readonly owned = range(1, 40);
  readonly bannable = range(1, 60);
  pages: FakePage[] = [
    { id: 101, name: 'My page', current: true, isEditable: true, isTemporary: false, isValid: true, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [...VALID_PAGE_PERKS] },
    { id: 102, name: 'Recommended', current: false, isEditable: false, isTemporary: true, isValid: true, primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8126, 8136, 8135, 9111, 9104, 5008, 5008, 5001] },
  ];
  maxPages = 5;
  private nextPageId = 200;
  private group = 0;

  constructor(
    private readonly emit: Emit,
    private readonly setPhase: (phase: string) => void,
  ) {}

  // --- scenario controls (tests / interactive fake-lcu) ---------------------------------------

  /** Opens champion select. Draft starts in PLANNING unless `planning: false`. */
  start(opts: { mode?: 'draft' | 'blind'; myCell?: number; planning?: boolean } = {}) {
    const mode = opts.mode ?? 'draft';
    const me = opts.myCell ?? 2;
    const member = (cellId: number, ally: boolean): Member => ({
      cellId,
      championId: 0,
      championPickIntent: 0,
      gameName: ally ? (cellId === me ? 'FakeMe' : `Ally${cellId}`) : '',
      tagLine: ally ? 'EUW' : '',
      nameVisibilityType: ally ? 'VISIBLE' : 'HIDDEN',
      assignedPosition: ally && mode === 'draft' ? POSITIONS[cellId]! : '',
      spell1Id: 4,
      spell2Id: 14,
      selectedSkinId: 0,
      playerType: 'PLAYER',
    });
    let id = 1;
    const act = (cell: number, type: string, inProgress = false): Action => ({
      id: id++,
      actorCellId: cell,
      championId: 0,
      completed: false,
      isInProgress: inProgress,
      isAllyAction: cell < 5,
      type,
    });
    const actions =
      mode === 'draft'
        ? [range(0, 9).map((c) => act(c, 'ban', true)), [act(-1, 'ten_bans_reveal')], ...SNAKE.map((g) => g.map((c) => act(c, 'pick')))]
        : [range(0, 4).map((c) => act(c, 'pick', true))];

    this.group = 0;
    this.session = {
      gameId: 4_000_000_001,
      queueId: mode === 'draft' ? 400 : 870,
      localPlayerCellId: me,
      hasSimultaneousBans: true,
      hasSimultaneousPicks: mode === 'blind',
      allowSkinSelection: true,
      disallowBanningTeammateHoveredChampions: mode === 'draft',
      bans: { myTeamBans: [], theirTeamBans: [], numBans: 0 },
      timer: this.timer(mode === 'draft' && opts.planning !== false ? 'PLANNING' : 'BAN_PICK'),
      myTeam: range(0, 4).map((c) => member(c, true)),
      theirTeam: mode === 'draft' ? range(5, 9).map((c) => member(c, false)) : [],
      actions,
    };
    this.setPhase('ChampSelect');
    this.emit(SESSION, 'Create', this.session);
    this.emit('/lol-champ-select/v1/pickable-champion-ids', 'Create', this.owned);
    this.emit('/lol-champ-select/v1/bannable-champion-ids', 'Create', this.bannable);
    this.emitDisabled();
  }

  /** PLANNING -> BAN_PICK. */
  beginTurns() {
    if (!this.session) return;
    this.session.timer = this.timer('BAN_PICK');
    this.emitSession();
  }

  /** A teammate hovers / declares intent (e.g. to test "a teammate wants to play this"). */
  teammateHover(cellId: number, championId: number) {
    const m = this.member(cellId);
    if (!m) return;
    m.championPickIntent = championId;
    const pick = this.session!.actions.flat().find((a) => a.actorCellId === cellId && a.type === 'pick' && !a.completed);
    if (pick) pick.championId = championId;
    this.emitSession();
  }

  /** Everyone else finishes their current turn (bans 41+cell, picks 20+cell). */
  othersAct() {
    const s = this.session;
    if (!s) return;
    for (const a of s.actions[this.group] ?? []) {
      if (a.actorCellId === s.localPlayerCellId || a.completed || !a.isInProgress) continue;
      a.championId ||= a.type === 'ban' ? 41 + a.actorCellId : 20 + a.actorCellId;
      this.complete(a);
    }
    this.advance();
    this.emitSession();
  }

  end() {
    if (!this.session) return;
    this.session = null;
    this.emit(SESSION, 'Delete', null);
    this.setPhase('GameStart');
  }

  // --- HTTP ----------------------------------------------------------------------------------

  /** Returns a response for routes this class owns, or null. */
  handle(method: string, url: string, body: unknown): { status: number; data?: unknown } | null {
    const err = (status: number, message: string) => ({ status, data: { errorCode: 'RPC_ERROR', httpStatus: status, message } });
    const s = this.session;

    if (method === 'GET' && url === SESSION) return s ? { status: 200, data: s } : err(404, 'No active delegate');

    const action = /^\/lol-champ-select\/v1\/session\/actions\/(\d+)(\/complete)?$/.exec(url);
    if (action) {
      if (!s) return err(404, 'No active delegate');
      const a = s.actions.flat().find((x) => x.id === Number(action[1]));
      if (!a) return err(404, 'Action not found');
      if (a.actorCellId !== s.localPlayerCellId) return err(500, "You can only change your own actions");
      if (a.completed) return err(500, 'Action already completed');

      if (method === 'PATCH' && !action[2]) {
        const championId = Number((body as { championId?: number } | null)?.championId);
        if (!championId) return err(400, 'championId required');
        if (a.type === 'ban' && !a.isInProgress) return err(500, 'Not your turn to ban');
        if (a.type === 'pick' && !this.owned.includes(championId)) return err(500, 'Champion not available');
        a.championId = championId;
        if (a.type === 'pick') this.member(a.actorCellId)!.championPickIntent = championId;
        this.emitSession();
        return { status: 204 };
      }
      if (method === 'POST' && action[2]) {
        if (!a.isInProgress || s.timer.phase !== 'BAN_PICK') return err(500, 'Action is not in progress');
        if (!a.championId) return err(500, 'No champion selected');
        this.complete(a);
        this.advance();
        this.emitSession();
        return { status: 204 };
      }
    }

    if (method === 'PATCH' && url === `${SESSION}/my-selection`) {
      if (!s) return err(404, 'No active delegate');
      const me = this.member(s.localPlayerCellId)!;
      const b = (body ?? {}) as Partial<Member>;
      if (b.spell1Id !== undefined) me.spell1Id = b.spell1Id;
      if (b.spell2Id !== undefined) me.spell2Id = b.spell2Id;
      if (b.selectedSkinId !== undefined) me.selectedSkinId = b.selectedSkinId;
      this.emitSession();
      return { status: 204 };
    }

    // Rune pages
    if (method === 'GET' && url === '/lol-perks/v1/pages') return { status: 200, data: this.pages };
    if (method === 'GET' && url === '/lol-perks/v1/currentpage') return { status: 200, data: this.pages.find((p) => p.current) };
    if (method === 'GET' && url === '/lol-perks/v1/styles') return { status: 200, data: FAKE_STYLES };
    if (method === 'PUT' && url === '/lol-perks/v1/currentpage') {
      const page = this.pages.find((p) => p.id === Number(body));
      if (!page) return err(404, 'Page not found');
      this.makeCurrent(page.id);
      return { status: 204 };
    }
    if (method === 'POST' && url === '/lol-perks/v1/pages') {
      if (this.pages.filter((p) => !p.isTemporary).length >= this.maxPages) return err(400, 'Max pages reached');
      const page = { ...(body as FakePage), id: this.nextPageId++, isEditable: true, isTemporary: false, isValid: true, current: false };
      this.pages.push(page);
      this.makeCurrent(page.id);
      return { status: 200, data: page };
    }
    const pagePut = /^\/lol-perks\/v1\/pages\/(\d+)$/.exec(url);
    if (method === 'PUT' && pagePut) {
      const page = this.pages.find((p) => p.id === Number(pagePut[1]));
      if (!page) return err(404, 'Page not found');
      if (!page.isEditable) return err(400, 'Page is not editable');
      Object.assign(page, body, { id: page.id });
      this.makeCurrent(page.id);
      return { status: 201 };
    }
    return null;
  }

  // --- internals -----------------------------------------------------------------------------

  private complete(a: Action) {
    const s = this.session!;
    a.completed = true;
    a.isInProgress = false;
    if (a.type === 'pick') {
      const m = this.member(a.actorCellId)!;
      m.championId = a.championId;
      m.championPickIntent = 0;
      if (a.actorCellId === s.localPlayerCellId) {
        m.selectedSkinId = a.championId * 1000;
        this.emitSkins(a.championId);
      }
    }
    this.emitDisabled();
  }

  /** When the current group is done, start the next one (or finish). */
  private advance() {
    const s = this.session!;
    const current = s.actions[this.group];
    if (!current || current.some((a) => !a.completed)) return;
    this.group++;
    let next = s.actions[this.group];
    if (next?.[0]?.type === 'ten_bans_reveal') {
      next[0].completed = true;
      this.group++;
      next = s.actions[this.group];
    }
    if (next) {
      for (const a of next) a.isInProgress = true;
      s.timer = this.timer('BAN_PICK');
    } else {
      s.timer = this.timer('FINALIZATION');
    }
  }

  private makeCurrent(id: number) {
    for (const p of this.pages) p.current = p.id === id;
    this.emit('/lol-perks/v1/pages', 'Update', this.pages);
    this.emit('/lol-perks/v1/currentpage', 'Update', this.pages.find((p) => p.current));
  }

  private emitSkins(championId: number) {
    const base = championId * 1000;
    this.emit('/lol-champ-select/v1/skin-carousel-skins', 'Update', [
      { id: base, championId, name: 'Classic', unlocked: true, disabled: false, childSkins: [] },
      {
        id: base + 1,
        championId,
        name: 'Owned Skin',
        unlocked: true,
        disabled: false,
        childSkins: [{ id: base + 2, name: 'Owned Skin (Ruby)', colors: ['#E0115F'], unlocked: false }],
      },
      { id: base + 3, championId, name: 'Shop Skin', unlocked: false, disabled: false, childSkins: [] },
    ]);
  }

  private emitDisabled() {
    const s = this.session;
    if (!s) return;
    const done = s.actions.flat().filter((a) => a.completed && a.championId && (a.type === 'ban' || a.type === 'pick'));
    this.emit('/lol-champ-select/v1/disabled-champion-ids', 'Update', [...new Set(done.map((a) => a.championId))]);
  }

  private emitSession() {
    if (this.session) this.emit(SESSION, 'Update', this.session);
  }

  private member(cellId: number) {
    return [...(this.session?.myTeam ?? []), ...(this.session?.theirTeam ?? [])].find((m) => m.cellId === cellId);
  }

  private timer(phase: string) {
    return { phase, adjustedTimeLeftInPhase: 30_000, totalTimeInPhase: 30_000, isInfinite: false };
  }
}
