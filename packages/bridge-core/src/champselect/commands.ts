/**
 * Champion select and rune commands from the phone.
 *
 * Each command is checked against the current BridgeState first, so the phone gets a clear reason
 * ("It isn't your turn to ban", "A teammate wants to play Ahri") instead of a raw client error.
 * Only then is the request sent, using the endpoints from the spec:
 *   PATCH /lol-champ-select/v1/session/actions/{id}   { championId }   hover / declare intent
 *   PATCH /lol-champ-select/v1/session/actions/{id}   { championId, type, completed: true }
 *                                                                       lock in / confirm ban
 *     (POST .../actions/{id}/complete answers 204 on the real client but does nothing: a live
 *      Nov 2026 test timed out a pick that way.)
 *   PATCH /lol-champ-select/v1/session/my-selection   { spell1Id, spell2Id } | { selectedSkinId }
 *   PUT   /lol-perks/v1/currentpage                   <pageId>
 *   POST  /lol-perks/v1/pages | PUT /lol-perks/v1/pages/{id}   save a page
 *
 * Action ids, "in progress" turns and planning intent follow what real Co-op and Draft recordings
 * showed (see state/reducer.ts). Request bodies and the client's error messages still need one
 * live check.
 */
import type { BridgeState, ChampSelect, Command, RunePageInput } from '@league-remote/protocol';
import { CommandError } from '../server/errors';
import { validateRunePage, type PerkStyle } from './runes';

export interface ChampSelectDeps {
  getState(): BridgeState;
  /** Sends a request to the client; throws CommandError on failure. */
  request(method: string, path: string, body?: unknown): Promise<void>;
  championName(id: number): string;
  /** Rune paths for validation, null if they couldn't be loaded. */
  perkStyles(): Promise<PerkStyle[] | null>;
}

const ACTIONS = '/lol-champ-select/v1/session/actions';
const MY_SELECTION = '/lol-champ-select/v1/session/my-selection';

type ChampCommand = Exclude<Command, { type: 'accept' | 'decline' | 'findMatch' | 'leaveQueue' | 'registerPush' }>;

export class ChampSelectCommands {
  constructor(private readonly deps: ChampSelectDeps) {}

  run(command: ChampCommand): Promise<void> {
    switch (command.type) {
      case 'hover':
        return this.hover(command.championId);
      case 'lockIn':
        return this.lockIn(command.championId);
      case 'ban':
        return this.ban(command.championId);
      case 'setSpells':
        return this.setSpells(command.spell1Id, command.spell2Id);
      case 'setSkin':
        return this.setSkin(command.skinId);
      case 'setRunePage':
        return this.setRunePage(command.pageId);
      case 'saveRunePage':
        return this.saveRunePage(command.page, command.pageId);
    }
  }

  // --- picks and bans ------------------------------------------------------------------------

  /** Hover in my current turn (pick or ban), or declare pick intent before my turn. */
  private async hover(championId: number) {
    const cs = this.champSelect();
    this.requireChampion(championId);
    const turn = cs.myAction;

    if (turn?.type === 'ban') {
      this.checkBannable(cs, championId);
      return this.deps.request('PATCH', `${ACTIONS}/${turn.id}`, { championId });
    }
    if (turn?.type === 'pick') {
      this.checkPickable(cs, championId);
      return this.deps.request('PATCH', `${ACTIONS}/${turn.id}`, { championId });
    }
    // Not my turn: the client stores pick intent on my upcoming pick action (seen in recordings).
    if (cs.myPickActionId === null) throw new CommandError('INVALID_STATE', "You've already locked in your champion");
    if (cs.phase !== 'PLANNING' && cs.phase !== 'BAN_PICK') throw new CommandError('INVALID_STATE', 'Picks are closed');
    this.checkPickable(cs, championId);
    return this.deps.request('PATCH', `${ACTIONS}/${cs.myPickActionId}`, { championId });
  }

  private async lockIn(championId?: number) {
    const cs = this.champSelect();
    const turn = cs.myAction;
    if (turn?.type !== 'pick') throw new CommandError('INVALID_STATE', "It isn't your turn to pick");
    const champ = championId ?? turn.championId;
    if (!champ) throw new CommandError('INVALID_STATE', 'Hover a champion first');
    this.checkPickable(cs, champ);
    await this.deps.request('PATCH', `${ACTIONS}/${turn.id}`, { championId: champ, type: 'pick', completed: true });
  }

  private async ban(championId: number) {
    const cs = this.champSelect();
    const turn = cs.myAction;
    if (turn?.type !== 'ban') throw new CommandError('INVALID_STATE', "It isn't your turn to ban");
    this.requireChampion(championId);
    this.checkBannable(cs, championId);
    await this.deps.request('PATCH', `${ACTIONS}/${turn.id}`, { championId, type: 'ban', completed: true });
  }

  private checkPickable(cs: ChampSelect, id: number) {
    const name = this.deps.championName(id);
    if ([...cs.bans.myTeam, ...cs.bans.theirTeam].includes(id)) throw new CommandError('NOT_ALLOWED', `${name} is banned`);
    const taken = [...cs.myTeam, ...cs.theirTeam].some((p) => !p.isMe && p.championId === id);
    if (taken) throw new CommandError('NOT_ALLOWED', `${name} has already been picked`);
    if (cs.disabledChampionIds.includes(id)) throw new CommandError('NOT_ALLOWED', `${name} can't be picked right now`);
    if (cs.pickableChampionIds && !cs.pickableChampionIds.includes(id)) {
      throw new CommandError('NOT_ALLOWED', `You can't play ${name} (not owned or not available in this mode)`);
    }
  }

  private checkBannable(cs: ChampSelect, id: number) {
    const name = this.deps.championName(id);
    if ([...cs.bans.myTeam, ...cs.bans.theirTeam].includes(id)) throw new CommandError('NOT_ALLOWED', `${name} is already banned`);
    if (cs.bannableChampionIds && !cs.bannableChampionIds.includes(id)) throw new CommandError('NOT_ALLOWED', `${name} can't be banned`);
    if (cs.banTeammateHoversBlocked) {
      const mate = cs.myTeam.find((p) => !p.isMe && p.hoverId === id);
      if (mate) throw new CommandError('NOT_ALLOWED', `${mate.name ? mate.name.split('#')[0] : 'A teammate'} wants to play ${name}`);
    }
  }

  // --- loadout -------------------------------------------------------------------------------

  private async setSpells(spell1Id: number, spell2Id: number) {
    const cs = this.champSelect();
    if (cs.phase === 'GAME_STARTING') throw new CommandError('INVALID_STATE', 'The game is already starting');
    if (spell1Id <= 0 || spell2Id <= 0) throw new CommandError('NOT_ALLOWED', 'Pick two summoner spells');
    if (spell1Id === spell2Id) throw new CommandError('NOT_ALLOWED', 'Pick two different summoner spells');
    await this.deps.request('PATCH', MY_SELECTION, { spell1Id, spell2Id });
  }

  private async setSkin(skinId: number) {
    const cs = this.champSelect();
    if (!cs.allowSkinSelection) throw new CommandError('NOT_ALLOWED', "Skins can't be changed in this mode");
    const me = cs.myTeam.find((p) => p.isMe);
    if (!me?.championId) throw new CommandError('INVALID_STATE', 'Lock in a champion first');
    const all = cs.skins.flatMap((s) => [s, ...s.chromas.map((c) => ({ ...c, disabled: s.disabled }))]);
    const skin = all.find((s) => s.id === skinId);
    if (!skin) throw new CommandError('NOT_ALLOWED', `That skin isn't available for ${this.deps.championName(me.championId)}`);
    if (!skin.owned) throw new CommandError('NOT_ALLOWED', `You don't own ${skin.name || 'that skin'}`);
    if (skin.disabled) throw new CommandError('NOT_ALLOWED', `${skin.name || 'That skin'} can't be used right now`);
    await this.deps.request('PATCH', MY_SELECTION, { selectedSkinId: skinId });
  }

  // --- runes ---------------------------------------------------------------------------------

  private async setRunePage(pageId: number) {
    const runes = this.deps.getState().runes;
    if (!runes) throw new CommandError('NOT_CONNECTED', "Rune pages aren't loaded yet");
    if (!runes.pages.some((p) => p.id === pageId)) throw new CommandError('NOT_ALLOWED', "That rune page doesn't exist");
    await this.deps.request('PUT', '/lol-perks/v1/currentpage', pageId);
  }

  private async saveRunePage(page: RunePageInput, pageId?: number) {
    const runes = this.deps.getState().runes;
    if (!runes) throw new CommandError('NOT_CONNECTED', "Rune pages aren't loaded yet");
    const problem = validateRunePage(page, await this.deps.perkStyles());
    if (problem) throw new CommandError('NOT_ALLOWED', problem);

    const body = { ...page, current: true };
    if (pageId === undefined) return this.deps.request('POST', '/lol-perks/v1/pages', body);

    const existing = runes.pages.find((p) => p.id === pageId);
    if (!existing) throw new CommandError('NOT_ALLOWED', "That rune page doesn't exist");
    if (!existing.isEditable) throw new CommandError('NOT_ALLOWED', `"${existing.name}" can't be edited`);
    await this.deps.request('PUT', `/lol-perks/v1/pages/${pageId}`, { ...body, id: pageId });
  }

  // --- helpers -------------------------------------------------------------------------------

  private champSelect(): ChampSelect {
    const cs = this.deps.getState().champSelect;
    if (!cs) throw new CommandError('INVALID_STATE', "You're not in champion select");
    return cs;
  }

  private requireChampion(id: number) {
    if (!Number.isInteger(id) || id <= 0) throw new CommandError('BAD_MESSAGE', 'Pick a champion');
  }
}
