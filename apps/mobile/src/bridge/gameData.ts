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
  /** Short description, plain text (the client's markup removed). */
  desc: string;
}

/** A rune path (Precision, Domination...) and its rows, from perkstyles.json. */
export interface RuneStyle {
  id: number;
  name: string;
  icon: string;
  allowedSubStyles: number[];
  defaultSubStyle: number;
  /** 9 perk ids the client uses for a fresh page on this path. */
  defaultPerks: number[];
  /** Keystone row, then 3 rune rows. */
  runeRows: number[][];
  /** 3 stat shard rows with their labels (Offense, Flex, Defense). */
  shardRows: { label: string; perks: number[] }[];
}

export interface GameData {
  champions: Map<number, Champion>;
  /** Sorted by name; excludes the "None" entry (-1). */
  championList: Champion[];
  spells: Map<number, Spell>;
  perks: Map<number, Perk>;
  styles: Map<number, RuneStyle>;
}

const EMPTY: GameData = { champions: new Map(), championList: [], spells: new Map(), perks: new Map(), styles: new Map() };

const assetUrl = (b: Pick<SavedBridge, 'host' | 'port'>, path: string) => `http://${b.host}:${b.port}${ASSETS_PATH}${path}`;

type AssetSource = { uri: string; headers: { Authorization: string } };
let sources: { bridge: SavedBridge; byPath: Map<string, AssetSource> } | null = null;

/**
 * expo-image source for a /lol-game-data/assets/... path. The same object is returned for the
 * same path, so re-renders (every state update) don't make images reload.
 */
export function useAssetSource() {
  const { bridge } = useBridge();
  return useMemo(() => {
    if (bridge && sources?.bridge !== bridge) sources = { bridge, byPath: new Map() };
    return (path: string | null | undefined) => {
      if (!bridge || !path || !sources) return undefined;
      let src = sources.byPath.get(path);
      if (!src) {
        src = { uri: assetUrl(bridge, path), headers: { Authorization: `Bearer ${bridge.token}` } };
        sources.byPath.set(path, src);
      }
      return src;
    };
  }, [bridge]);
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

/** The client's descriptions carry HTML-ish markup and @placeholders@; keep readable text only. */
const plainText = (s: string | undefined) =>
  (s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/@[^@]*@/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
      type Raw = { id: number; name: string; squarePortraitPath?: string; iconPath?: string; roles?: string[]; gameModes?: string[]; shortDesc?: string };
      type RawStyle = Raw & {
        allowedSubStyles?: number[];
        defaultSubStyle?: number;
        defaultPerks?: number[];
        slots?: { type?: string; slotLabel?: string; perks?: number[] }[];
      };
      const [champs, spells, perks, styles] = await Promise.all([
        get<Raw[]>('/lol-game-data/assets/v1/champion-summary.json'),
        get<Raw[]>('/lol-game-data/assets/v1/summoner-spells.json'),
        get<Raw[]>('/lol-game-data/assets/v1/perks.json'),
        get<{ styles: RawStyle[] }>('/lol-game-data/assets/v1/perkstyles.json'),
      ]);
      if (cancelled || !champs) return;
      const champions = new Map(
        champs.filter((c) => c.id > 0).map((c) => [c.id, { id: c.id, name: c.name, icon: c.squarePortraitPath ?? championIcon(c.id), roles: c.roles ?? [] }]),
      );
      const next: GameData = {
        champions,
        championList: [...champions.values()].sort((a, b) => a.name.localeCompare(b.name)),
        spells: new Map((spells ?? []).map((s) => [s.id, { id: s.id, name: s.name, icon: s.iconPath ?? '', gameModes: s.gameModes ?? [] }])),
        perks: new Map((perks ?? []).map((p) => [p.id, { id: p.id, name: p.name, icon: p.iconPath ?? '', desc: plainText(p.shortDesc) }])),
        styles: new Map(
          (styles?.styles ?? []).map((s) => {
            const slots = s.slots ?? [];
            const style: RuneStyle = {
              id: s.id,
              name: s.name,
              icon: s.iconPath ?? '',
              allowedSubStyles: s.allowedSubStyles ?? [],
              defaultSubStyle: s.defaultSubStyle ?? 0,
              defaultPerks: s.defaultPerks ?? [],
              runeRows: slots.filter((x) => x.type !== 'kStatMod').map((x) => x.perks ?? []),
              shardRows: slots.filter((x) => x.type === 'kStatMod').map((x) => ({ label: x.slotLabel ?? '', perks: x.perks ?? [] })),
            };
            return [s.id, style];
          }),
        ),
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
