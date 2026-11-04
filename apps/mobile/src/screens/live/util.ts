/** Helpers for the in-game screens. */
import type { LiveEvent, LiveGame, LivePlayer, Team } from '@league-remote/protocol';
import { useEffect, useState } from 'react';
import { useBridge } from '@/bridge/BridgeProvider';
import { championIcon, type GameData } from '@/bridge/gameData';
import { colors } from '@/ui/theme';

/** The game clock in seconds, ticking smoothly between updates (stops when the game ended). */
export function useGameClock(game: LiveGame) {
  const { clockOffset } = useBridge();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (game.result) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [game.result]);
  if (game.result) return game.gameTime;
  return game.gameTime + Math.max(0, now + clockOffset - game.receivedAt) / 1000;
}

/** Seconds left on a countdown the bridge measured at `receivedAt`. */
export function useCountdown(seconds: number, receivedAt: number) {
  const { clockOffset } = useBridge();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [seconds, receivedAt]);
  return Math.max(0, seconds - (now + clockOffset - receivedAt) / 1000);
}

export const formatGameTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 2412 -> "2.4k", -830 -> "-830" */
export const formatGold = (g: number, signed = false) => {
  const sign = g > 0 && signed ? '+' : g < 0 ? '-' : '';
  const a = Math.abs(g);
  return sign + (a >= 1000 ? `${(a / 1000).toFixed(1)}k` : String(Math.round(a)));
};

export const teamColor = (team: Team | null, myTeam: Team) => (team === null ? colors.muted : team === myTeam ? colors.teal : colors.danger);

/** Champion id for a live player (the API names champions by alias). */
export const championId = (data: GameData, p: Pick<LivePlayer, 'champion'> | undefined) => (p ? (data.championsByAlias.get(p.champion)?.id ?? 0) : 0);
export const championIconFor = (data: GameData, p: LivePlayer | undefined) => {
  const id = championId(data, p);
  return id ? championIcon(id) : null;
};

export const playerByName = (game: LiveGame, name: string | null) => (name ? game.players.find((p) => p.name === name) : undefined);

/** The API's dragon types, as the game calls them, with a color for each. */
export const DRAGONS: Record<string, { name: string; color: string }> = {
  Fire: { name: 'Infernal', color: '#FF7A45' },
  Earth: { name: 'Mountain', color: '#C08A4B' },
  Water: { name: 'Ocean', color: '#3FA9F5' },
  Air: { name: 'Cloud', color: '#C9DDEB' },
  Hextech: { name: 'Hextech', color: '#2ED3C4' },
  Chemtech: { name: 'Chemtech', color: '#A6E04B' },
  Elder: { name: 'Elder', color: '#F2C66D' },
};
export const dragonInfo = (type: string | null) => DRAGONS[type ?? ''] ?? { name: type ?? 'Dragon', color: colors.gold };

export const MULTIKILL: Record<string, string> = { '2': 'Double kill', '3': 'Triple kill', '4': 'Quadra kill', '5': 'Pentakill' };

/** One line for the event feed. */
export function describeEvent(e: LiveEvent): string {
  switch (e.kind) {
    case 'kill':
      return e.killer ? `${e.killer} slain ${e.victim ?? ''}` : `${e.victim ?? 'A champion'} was executed`;
    case 'firstBlood':
      return `First blood · ${e.killer ?? ''}`;
    case 'multikill':
      return `${MULTIKILL[e.detail ?? ''] ?? 'Multikill'} · ${e.killer ?? ''}`;
    case 'ace':
      return 'Ace';
    case 'dragon':
      return `${e.stolen ? 'Stolen · ' : ''}${dragonInfo(e.detail).name} dragon`;
    case 'baron':
      return `${e.stolen ? 'Stolen · ' : ''}Baron Nashor`;
    case 'herald':
      return 'Rift Herald';
    case 'grubs':
      return 'Voidgrubs';
    case 'turret':
      return 'Tower destroyed';
    case 'inhibitor':
      return 'Inhibitor destroyed';
    case 'gameEnd':
      return e.detail === 'Win' ? 'Victory' : 'Defeat';
  }
}
