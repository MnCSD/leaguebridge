/**
 * Champion, spell and rune names + icons, loaded once per pairing from the League client through
 * the bridge's /assets proxy (game data only changes with a patch).
 */
import { ASSETS_PATH } from '@league-remote/protocol';
import { useEffect, useMemo, useState } from 'react';
import { useBridge } from './BridgeProvider';
import type { SavedBridge } from './storage';

export interface Champion {
  id: number;
  name: string;
  icon: string;
  roles: string[];
}
export interface Spell {
  id: number;
  name: string;
  icon: string;
  gameModes: string[];
}
export interface Perk {
  id: number;
  name: string;
  icon: string;
}

export interface GameData {
  champions: Map<number, Champion>;
  /** Sorted by name; excludes the "None" entry (-1). */
  championList: Champion[];
  spells: Map<number, Spell>;
  perks: Map<number, Perk>;
  styles: Map<number, Perk>;
}

const EMPTY: GameData = { champions: new Map(), championList: [], spells: new Map(), perks: new Map(), styles: new Map() };

const assetUrl = (b: Pick<SavedBridge, 'host' | 'port'>, path: string) => `http://${b.host}:${b.port}${ASSETS_PATH}${path}`;

/** expo-image source for a /lol-game-data/assets/... path. */
export function useAssetSource() {
  const { bridge } = useBridge();
  return useMemo(
    () => (path: string | null | undefined) =>
      bridge && path ? { uri: assetUrl(bridge, path), headers: { Authorization: `Bearer ${bridge.token}` } } : undefined,
    [bridge],
  );
}

export const championIcon = (id: number) => `/lol-game-data/assets/v1/champion-icons/${id}.png`;
export const profileIcon = (id: number) => `/lol-game-data/assets/v1/profile-icons/${id}.jpg`;

const splashes = new Map<number, string | null>();

/** The default skin's splash path for a champion, from its game data file (fetched once). */
export function useDefaultSplash(championId: number) {
  const { bridge } = useBridge();
  const [path, setPath] = useState(() => splashes.get(championId) ?? null);
  useEffect(() => {
    if (!bridge || !championId) return setPath(null);
    if (splashes.has(championId)) return setPath(splashes.get(championId) ?? null);
    let cancelled = false;
    splashes.set(championId, null); // in flight
    fetch(assetUrl(bridge, `/lol-game-data/assets/v1/champions/${championId}.json`), { headers: { Authorization: `Bearer ${bridge.token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ skins?: { splashPath?: string }[] }>) : null))
      .then((json) => {
        const p = json?.skins?.[0]?.splashPath ?? null;
        splashes.set(championId, p);
        if (!cancelled) setPath(p);
      })
      .catch(() => splashes.delete(championId));
    return () => {
      cancelled = true;
    };
  }, [bridge, championId]);
  return championId ? path : null;
}

let cache: { key: string; data: GameData } | null = null;

export function useGameData(): GameData {
  const { bridge, status } = useBridge();
  const key = bridge ? `${bridge.bridgeId}:${bridge.host}` : '';
  const [data, setData] = useState<GameData>(cache?.key === key ? cache.data : EMPTY);

  useEffect(() => {
    if (!bridge || status !== 'connected' || cache?.key === key) return;
    let cancelled = false;
    const get = async <T,>(path: string): Promise<T | null> => {
      try {
        const res = await fetch(assetUrl(bridge, path), { headers: { Authorization: `Bearer ${bridge.token}` } });
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    (async () => {
      type Raw = { id: number; name: string; squarePortraitPath?: string; iconPath?: string; roles?: string[]; gameModes?: string[] };
      const [champs, spells, perks, styles] = await Promise.all([
        get<Raw[]>('/lol-game-data/assets/v1/champion-summary.json'),
        get<Raw[]>('/lol-game-data/assets/v1/summoner-spells.json'),
        get<Raw[]>('/lol-game-data/assets/v1/perks.json'),
        get<{ styles: Raw[] }>('/lol-game-data/assets/v1/perkstyles.json'),
      ]);
      if (cancelled || !champs) return;
      const champions = new Map(
        champs.filter((c) => c.id > 0).map((c) => [c.id, { id: c.id, name: c.name, icon: c.squarePortraitPath ?? championIcon(c.id), roles: c.roles ?? [] }]),
      );
      const next: GameData = {
        champions,
        championList: [...champions.values()].sort((a, b) => a.name.localeCompare(b.name)),
        spells: new Map((spells ?? []).map((s) => [s.id, { id: s.id, name: s.name, icon: s.iconPath ?? '', gameModes: s.gameModes ?? [] }])),
        perks: new Map((perks ?? []).map((p) => [p.id, { id: p.id, name: p.name, icon: p.iconPath ?? '' }])),
        styles: new Map((styles?.styles ?? []).map((s) => [s.id, { id: s.id, name: s.name, icon: s.iconPath ?? '' }])),
      };
      cache = { key, data: next };
      setData(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, status, key]);

  return data;
}
