import type { BridgeState, ChampSelectPlayer } from '@league-remote/protocol';

/**
 * One short human-readable line per part of the state, for the terminal.
 * Countdown values are left out on purpose, so a line only changes when something meaningful does.
 */
export function describeState(s: BridgeState): Record<string, string | null> {
  const cs = s.champSelect;
  const me = cs?.myTeam.find((p) => p.isMe);
  const runes = s.runes;
  const currentPage = runes?.pages.find((p) => p.id === runes.currentPageId);

  return {
    me: s.me ? `Me: ${s.me.name}#${s.me.tagLine} (icon ${s.me.iconId})` : null,
    queue: s.queue ? `Queue type: ${s.queue.name} (#${s.queue.id}, ${s.queue.category})` : null,
    lobby: s.lobby
      ? `Lobby: ${s.lobby.members.length}/${s.lobby.maxSize} | ` +
        s.lobby.members.map((m) => `${m.name ?? m.puuid.slice(0, 8)}${m.isLeader ? ' (leader)' : ''}${m.ready ? '' : ' (not ready)'}`).join(', ')
      : null,
    matchmaking: s.matchmaking
      ? `Matchmaking: ${s.matchmaking.state}${s.matchmaking.estimatedMs ? ` | estimated ${Math.round(s.matchmaking.estimatedMs / 1000)}s` : ''}`
      : null,
    readyCheck: s.readyCheck ? `Ready check: ${s.readyCheck.state} | you: ${s.readyCheck.response}` : null,
    champSelect: cs
      ? `Champ select ${cs.phase} | ${cs.myTeam.length}v${cs.theirTeam.length} | ` +
        `bans ${cs.bans.myTeam.length}/${cs.bans.theirTeam.length} | ` +
        (cs.myAction
          ? `MY TURN to ${cs.myAction.type}${cs.myAction.type === 'ban' && cs.myAction.championId ? ` (hovering ${cs.myAction.championId})` : ''}`
          : 'not my turn') +
        (me ? ` | me: ${playerLine(me)}` : '') +
        ` | ${cs.skins.filter((k) => k.owned).length}/${cs.skins.length} skins owned`
      : null,
    runes: runes ? `Runes: "${currentPage?.name ?? '?'}" (${runes.pages.length} pages)` : null,
  };
}

function playerLine(p: ChampSelectPlayer) {
  const champ = p.championId ? `locked ${p.championId}` : p.hoverId ? `hovering ${p.hoverId}` : 'no champion';
  return `${champ}, spells ${p.spell1Id}/${p.spell2Id}, skin ${p.skinId}`;
}
