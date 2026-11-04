/**
 * Champion select. The splash of my champion sits blurred behind everything.
 *  - my ban turn: grid of bannable champions, red "Ban X"
 *  - my pick turn: grid of pickable champions, "Lock in X"
 *  - before my turn: tapping declares pick intent (the team sees it)
 *  - locked in: my loadout (spells, skin, runes) and both teams
 */
import type { ChampSelect, ChampSelectPlayer } from '@league-remote/protocol';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridge, useRemaining, useSend } from '@/bridge/BridgeProvider';
import { championIcon, useDefaultSplash, useGameData, type Champion, type GameData } from '@/bridge/gameData';
import { Button, Card, Eyebrow, FadeIn, GameImage, Icon, Ring, Screen } from '@/ui/components';
import { colors, fonts, formatClock, radius, type } from '@/ui/theme';

type Mode = 'ban' | 'pick' | 'intent' | 'waiting' | 'locked';

const POS: Record<string, string> = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'Bot', utility: 'Support' };

export function ChampSelectScreen({ cs }: { cs: ChampSelect }) {
  const data = useGameData();
  const send = useSend();
  const insets = useSafeAreaInsets();
  const me = cs.myTeam.find((p) => p.isMe);
  const locked = !!me?.championId && cs.myPickActionId === null;
  const mode: Mode = cs.myAction?.type ?? (locked ? 'locked' : cs.myPickActionId !== null && (cs.phase === 'PLANNING' || cs.phase === 'BAN_PICK') ? 'intent' : 'waiting');

  // What I've tapped; follows the client when it changes there.
  const serverChoice = mode === 'ban' || mode === 'pick' ? cs.myAction!.championId : (me?.hoverId ?? 0);
  const [selected, setSelected] = useState(serverChoice);
  useEffect(() => setSelected(serverChoice), [serverChoice, mode]);

  const myChamp = me?.championId || (mode !== 'ban' ? selected || me?.hoverId : me?.hoverId) || 0;
  const fallbackArt = useDefaultSplash(myChamp);
  const art = lockedSplash(cs, me, myChamp) ?? fallbackArt;

  const choose = (id: number) => {
    Haptics.selectionAsync().catch(() => {});
    setSelected(id);
    void send({ type: 'hover', championId: id });
  };

  return (
    <Screen art={art} glow={mode === 'ban' ? 'danger' : 'teal'}>
      <Header cs={cs} mode={mode} />
      <Teams cs={cs} data={data} />
      {mode === 'locked' || mode === 'waiting' ? (
        <Loadout cs={cs} me={me} data={data} mode={mode} bottom={insets.bottom} />
      ) : (
        <>
          <ChampionGrid cs={cs} mode={mode} data={data} selected={selected} onChoose={choose} />
          <ActionBar cs={cs} mode={mode} selected={selected} data={data} me={me} bottom={insets.bottom} />
        </>
      )}
    </Screen>
  );
}

/** Once locked in: the splash of my selected skin (its base skin if a chroma is selected). */
function lockedSplash(cs: ChampSelect, me: ChampSelectPlayer | undefined, champ: number) {
  if (!champ || me?.championId !== champ) return null;
  const skin = cs.skins.find((s) => s.id === me.skinId || s.chromas.some((c) => c.id === me.skinId)) ?? cs.skins[0];
  return skin?.splashPath || null;
}

// --- header ----------------------------------------------------------------------------------

function Header({ cs, mode }: { cs: ChampSelect; mode: Mode }) {
  const { state } = useBridge();
  const left = useRemaining(cs.timer.endsAt);
  const title =
    cs.phase === 'GAME_STARTING'
      ? 'Game starting'
      : cs.phase === 'FINALIZATION'
        ? 'Final loadout'
        : { ban: 'Ban a champion', pick: 'Pick your champion', intent: cs.phase === 'PLANNING' ? 'Declare your pick' : 'Your turn is coming', waiting: 'Waiting', locked: 'Locked in' }[mode];
  const sub = mode === 'ban' || mode === 'pick' ? 'Your turn' : cs.phase === 'PLANNING' ? 'Planning' : (state?.queue?.name ?? 'Champ select');
  const urgent = left !== null && left < 10_000 && (mode === 'ban' || mode === 'pick');

  return (
    <View style={s.header}>
      <View style={{ flex: 1, gap: 4 }}>
        <Eyebrow color={mode === 'ban' ? colors.danger : mode === 'pick' ? colors.tealLight : undefined}>{sub}</Eyebrow>
        <FadeIn key={title}>
          <Text style={[type.hero, { fontSize: 30 }]}>{title}</Text>
        </FadeIn>
      </View>
      {left !== null && cs.timer.totalMs > 0 ? (
        <Ring size={66} stroke={4} progress={left / cs.timer.totalMs} danger={urgent || mode === 'ban'}>
          <Text style={[type.number, { fontSize: 17, color: urgent ? colors.danger : colors.white }]}>{formatClock(left)}</Text>
        </Ring>
      ) : null}
    </View>
  );
}

// --- teams and bans --------------------------------------------------------------------------

function Teams({ cs, data }: { cs: ChampSelect; data: GameData }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 10, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {cs.myTeam.map((p) => (
          <Player key={p.cellId} p={p} data={data} size={54} />
        ))}
      </View>
      {cs.bans.perTeam > 0 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <BanRow ids={cs.bans.myTeam} count={cs.bans.perTeam} />
          <Icon name="ban" size={14} color={colors.faint} />
          <BanRow ids={cs.bans.theirTeam} count={cs.bans.perTeam} />
        </View>
      ) : null}
    </View>
  );
}

function Player({ p, data, size }: { p: ChampSelectPlayer; data: GameData; size: number }) {
  const champ = p.championId || p.hoverId;
  const ring = p.acting === 'ban' ? colors.danger : p.acting === 'pick' ? colors.teal : p.isMe ? colors.gold : 'transparent';
  const label = p.isMe ? 'You' : p.position ? POS[p.position] : p.championId ? (data.champions.get(p.championId)?.name ?? '') : '';
  return (
    <View style={{ alignItems: 'center', gap: 5, width: size + 8 }}>
      <View style={{ padding: 2, borderRadius: (size + 8) / 2, borderWidth: 2, borderColor: ring }}>
        <GameImage path={champ ? championIcon(champ) : null} size={size} rounded={size / 2} dim={!p.championId && !!p.hoverId} />
      </View>
      <Text style={{ fontFamily: p.isMe ? fonts.semi : fonts.medium, fontSize: 11, color: p.isMe ? colors.gold : colors.muted }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function BanRow({ ids, count }: { ids: number[]; count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: count }, (_, i) => {
        const id = ids[i];
        return (
          <View key={i} style={s.banSlot}>
            {id ? (
              <>
                <GameImage path={championIcon(id)} size={26} rounded={7} dim />
                <View style={s.banSlash} />
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// --- champion grid ---------------------------------------------------------------------------

function ChampionGrid({ cs, mode, data, selected, onChoose }: { cs: ChampSelect; mode: 'ban' | 'pick' | 'intent'; data: GameData; selected: number; onChoose(id: number): void }) {
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const COLS = 4;
  const GAP = 10;
  const tile = (width - 40 - GAP * (COLS - 1)) / COLS;

  const list = useMemo(() => {
    const banned = new Set([...cs.bans.myTeam, ...cs.bans.theirTeam]);
    const taken = new Set([...cs.myTeam, ...cs.theirTeam].filter((p) => !p.isMe).map((p) => p.championId));
    const allowed = mode === 'ban' ? cs.bannableChampionIds : cs.pickableChampionIds;
    const allowedSet = allowed ? new Set(allowed) : null;
    const disabled = new Set(cs.disabledChampionIds);
    const q = query.trim().toLowerCase();
    return data.championList.filter(
      (c) =>
        (!allowedSet || allowedSet.has(c.id)) &&
        !banned.has(c.id) &&
        !taken.has(c.id) &&
        (mode === 'ban' || !disabled.has(c.id)) &&
        (!q || c.name.toLowerCase().includes(q)),
    );
  }, [cs, mode, data, query]);

  const accent = mode === 'ban' ? colors.danger : colors.teal;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${list.length} champions`}
          placeholderTextColor={colors.faint}
          style={s.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel="Search champions"
        />
      </View>
      {data.championList.length === 0 ? (
        <Text style={[type.small, { textAlign: 'center', paddingTop: 40 }]}>Loading champions…</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => String(c.id)}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={24}
          renderItem={({ item }) => <Tile champ={item} size={tile} selected={item.id === selected} accent={accent} onPress={() => onChoose(item.id)} />}
          ListEmptyComponent={<Text style={[type.small, { textAlign: 'center', paddingTop: 30 }]}>No champion matches “{query}”.</Text>}
        />
      )}
    </View>
  );
}

function Tile({ champ, size, selected, accent, onPress }: { champ: Champion; size: number; selected: boolean; accent: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={champ.name} accessibilityState={{ selected }} style={{ width: size, alignItems: 'center', gap: 6 }}>
      {({ pressed }) => (
        <>
          <View
            style={{
              borderRadius: 16,
              padding: 2,
              borderWidth: 2,
              borderColor: selected ? accent : 'transparent',
              shadowColor: accent,
              shadowOpacity: selected ? 0.8 : 0,
              shadowRadius: 12,
              transform: [{ scale: pressed ? 0.94 : selected ? 1.03 : 1 }],
            }}
          >
            <GameImage path={champ.icon} size={size - 8} rounded={12} fallback={champ.name[0]} />
          </View>
          <Text style={{ fontFamily: selected ? fonts.semi : fonts.medium, fontSize: 12, color: selected ? colors.white : colors.muted }} numberOfLines={1}>
            {champ.name}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// --- bottom action bar -----------------------------------------------------------------------

function ActionBar({ cs, mode, selected, data, me, bottom }: { cs: ChampSelect; mode: 'ban' | 'pick' | 'intent'; selected: number; data: GameData; me?: ChampSelectPlayer; bottom: number }) {
  const send = useSend();
  const [busy, setBusy] = useState(false);
  const name = data.champions.get(selected)?.name;
  const act = (cmd: Parameters<typeof send>[0]) => {
    setBusy(true);
    void send(cmd).finally(() => setBusy(false));
  };

  return (
    <View style={[s.actionBar, { paddingBottom: bottom + 14 }]}>
      {mode !== 'ban' && me ? <LoadoutChips cs={cs} me={me} data={data} canSkin={false} /> : null}
      {mode === 'ban' ? (
        <Button kind="danger" big busy={busy} disabled={!selected} label={name ? `Ban ${name}` : 'Choose a champion to ban'} onPress={() => act({ type: 'ban', championId: selected })} />
      ) : mode === 'pick' ? (
        <Button big busy={busy} disabled={!selected} label={name ? `Lock in ${name}` : 'Choose your champion'} onPress={() => act({ type: 'lockIn', championId: selected })} />
      ) : (
        <Text style={[type.small, { textAlign: 'center', paddingVertical: 8 }]}>
          {name ? `Your team sees ${name} as your pick.` : 'Tap a champion to show your team what you want to play.'}
        </Text>
      )}
    </View>
  );
}

/** Spells · runes · skin shortcuts. */
function LoadoutChips({ cs, me, data, canSkin }: { cs: ChampSelect; me: ChampSelectPlayer; data: GameData; canSkin: boolean }) {
  const { state } = useBridge();
  const page = state?.runes?.pages.find((p) => p.id === state.runes?.currentPageId);
  const keystone = data.perks.get(page?.selectedPerkIds[0] ?? 0);
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable onPress={() => router.push('/spells')} style={s.chip} accessibilityLabel="Summoner spells">
        <GameImage path={data.spells.get(me.spell1Id)?.icon} size={28} rounded={7} />
        <GameImage path={data.spells.get(me.spell2Id)?.icon} size={28} rounded={7} />
      </Pressable>
      <Pressable onPress={() => router.push('/runes')} style={[s.chip, { flex: 1 }]} accessibilityLabel="Rune page">
        <GameImage path={keystone?.icon} size={28} rounded={14} style={{ backgroundColor: 'transparent' }} />
        <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text }} numberOfLines={1}>
          {page?.name ?? 'Runes'}
        </Text>
        <Icon name="chevron" size={16} color={colors.faint} />
      </Pressable>
      {canSkin && cs.allowSkinSelection ? (
        <Pressable onPress={() => router.push('/skins')} style={s.chip} accessibilityLabel="Skins">
          <Icon name="brush" size={20} color={colors.gold} />
        </Pressable>
      ) : null}
    </View>
  );
}

// --- locked in / waiting ---------------------------------------------------------------------

function Loadout({ cs, me, data, mode, bottom }: { cs: ChampSelect; me?: ChampSelectPlayer; data: GameData; mode: 'locked' | 'waiting'; bottom: number }) {
  const champ = me?.championId ? data.champions.get(me.championId) : undefined;
  const skin = cs.skins.flatMap((s) => [s, ...s.chromas]).find((s) => s.id === me?.skinId);
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottom + 30, gap: 14 }}>
      {champ ? (
        <FadeIn style={{ paddingTop: 70, gap: 2 }}>
          <Eyebrow color={colors.gold}>Your champion</Eyebrow>
          <Text style={[type.hero, { fontSize: 44, lineHeight: 48 }]}>{champ.name}</Text>
          {skin && skin.name && skin.id !== champ.id * 1000 ? <Text style={[type.small, { fontSize: 16 }]}>{skin.name}</Text> : null}
        </FadeIn>
      ) : (
        <FadeIn style={{ paddingTop: 40 }}>
          <Card glass style={{ padding: 22, gap: 6 }}>
            <Text style={type.title}>Not your turn yet</Text>
            <Text style={type.small}>The screen switches when it's your turn to ban or pick.</Text>
          </Card>
        </FadeIn>
      )}

      {me && mode === 'locked' ? (
        <FadeIn delay={80}>
          <LoadoutChips cs={cs} me={me} data={data} canSkin />
        </FadeIn>
      ) : null}

      <FadeIn delay={140}>
        <Card glass style={{ padding: 16, gap: 10 }}>
          <Eyebrow color={colors.danger}>Enemy team</Eyebrow>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {cs.theirTeam.map((p) => (
              <Player key={p.cellId} p={p} data={data} size={46} />
            ))}
          </View>
        </Card>
      </FadeIn>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  banSlot: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  banSlash: { position: 'absolute', width: 40, height: 2, backgroundColor: colors.danger, transform: [{ rotate: '45deg' }] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: 'rgba(7,13,23,0.72)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  searchInput: { flex: 1, color: colors.white, fontFamily: fonts.medium, fontSize: 16 },
  actionBar: { paddingHorizontal: 20, paddingTop: 14, gap: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: 'rgba(7,13,23,0.92)' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.line,
  },
});
