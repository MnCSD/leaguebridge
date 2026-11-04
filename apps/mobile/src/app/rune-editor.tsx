/**
 * Rune page editor. Opened with ?pageId=<id> to edit an editable page, or without to create one.
 * A page is 9 perks: [keystone, primary row 1-3, 2 secondary runes from different rows, 3 shards].
 * The bridge checks the same rules again before it saves (champselect/runes.ts).
 */
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridge } from '@/bridge/BridgeProvider';
import { useGameData, type GameData, type RuneStyle } from '@/bridge/gameData';
import { Button, Card, Eyebrow, FadeIn, GameImage } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { colors, fonts, radius, type } from '@/ui/theme';

/** Each path's color, as the client shows them. */
const PATH_COLOR: Record<number, string> = {
  8000: '#C8AA6E', // Precision
  8100: '#E0505E', // Domination
  8200: '#9FAAFC', // Sorcery
  8300: '#49C6D6', // Inspiration
  8400: '#A1D586', // Resolve
};
const pathColor = (id: number) => PATH_COLOR[id] ?? colors.teal;

interface Draft {
  name: string;
  primary: number;
  sub: number;
  perks: number[];
}

export default function RuneEditor() {
  const { pageId } = useLocalSearchParams<{ pageId?: string }>();
  const { state, send } = useBridge();
  const data = useGameData();
  const insets = useSafeAreaInsets();
  const existing = state?.runes?.pages.find((p) => String(p.id) === pageId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from the page being edited, or from Precision's defaults for a new page.
  useEffect(() => {
    if (draft || data.styles.size === 0) return;
    if (existing && existing.selectedPerkIds.length === 9) {
      setDraft({ name: existing.name, primary: existing.primaryStyleId, sub: existing.subStyleId, perks: [...existing.selectedPerkIds] });
    } else {
      const first = data.styles.get(8000) ?? [...data.styles.values()][0]!;
      setDraft({ name: 'New page', primary: first.id, sub: first.defaultSubStyle, perks: defaultsFor(first, data.styles.get(first.defaultSubStyle)) });
    }
  }, [data, existing, draft]);

  const problem = useMemo(() => (draft ? check(draft, data) : null), [draft, data]);

  if (!draft) {
    return (
      <Sheet title="Runes">
        <Text style={[type.small, { paddingHorizontal: 20 }]}>Loading rune paths…</Text>
      </Sheet>
    );
  }
  const primary = data.styles.get(draft.primary);
  const sub = data.styles.get(draft.sub);
  const editable = !!existing?.isEditable && !existing.isTemporary;

  const update = (next: Partial<Draft>) => {
    Haptics.selectionAsync().catch(() => {});
    setDraft({ ...draft, ...next });
  };

  const choosePrimary = (style: RuneStyle) => {
    if (style.id === draft.primary) return;
    const newSub = style.id === draft.sub || !style.allowedSubStyles.includes(draft.sub) ? style.defaultSubStyle : draft.sub;
    const subStyle = data.styles.get(newSub);
    const perks = [...style.defaultPerks.slice(0, 4), ...(newSub === draft.sub ? draft.perks.slice(4, 6) : secondaryDefaults(subStyle)), ...draft.perks.slice(6)];
    update({ primary: style.id, sub: newSub, perks });
  };

  const chooseSub = (style: RuneStyle) => {
    if (style.id === draft.sub) return;
    update({ sub: style.id, perks: [...draft.perks.slice(0, 4), ...secondaryDefaults(style), ...draft.perks.slice(6)] });
  };

  const choosePrimaryRune = (row: number, id: number) => {
    const perks = [...draft.perks];
    perks[row] = id;
    update({ perks });
  };

  // Two secondary runes from different rows: replace the one in the same row, else the older one.
  const chooseSecondary = (row: number, id: number) => {
    if (!sub) return;
    const rowOf = (p: number) => sub.runeRows.findIndex((r, i) => i > 0 && r.includes(p));
    const [a, b] = [draft.perks[4]!, draft.perks[5]!];
    let next: [number, number];
    if (id === a || id === b) return;
    if (rowOf(a) === row) next = [id, b];
    else if (rowOf(b) === row) next = [a, id];
    else next = [b, id];
    const perks = [...draft.perks];
    perks[4] = next[0];
    perks[5] = next[1];
    update({ perks });
  };

  const chooseShard = (row: number, id: number) => {
    const perks = [...draft.perks];
    perks[6 + row] = id;
    update({ perks });
  };

  const save = async () => {
    setBusy(true);
    try {
      await send({
        type: 'saveRunePage',
        ...(editable ? { pageId: existing!.id } : {}),
        page: { name: draft.name.trim() || 'Rune page', primaryStyleId: draft.primary, subStyleId: draft.sub, selectedPerkIds: draft.perks },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch {
      // The error banner shows why (e.g. no free page slot).
    } finally {
      setBusy(false);
    }
  };

  const keystone = data.perks.get(draft.perks[0]!);
  const accent = pathColor(draft.primary);

  return (
    <Sheet eyebrow={editable ? 'Edit rune page' : existing ? 'Save as a new page' : 'New rune page'} title="Runes">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name: name.slice(0, 60) })}
            placeholder="Page name"
            placeholderTextColor={colors.faint}
            style={s.name}
            accessibilityLabel="Page name"
          />

          {/* Primary path */}
          <Section label="Primary path" title={primary?.name} color={accent}>
            <PathPicker styles={data} selected={draft.primary} onPick={choosePrimary} />
            {primary ? (
              <>
                <RuneRow ids={primary.runeRows[0] ?? []} selected={draft.perks[0]!} size={64} color={accent} data={data} onPick={(id) => choosePrimaryRune(0, id)} />
                {keystone ? (
                  <FadeIn key={keystone.id}>
                    <Card glass style={{ padding: 14, gap: 4, borderColor: `${accent}55` }}>
                      <Text style={[type.body, { fontFamily: fonts.semi, color: accent }]}>{keystone.name}</Text>
                      <Text style={[type.small, { lineHeight: 19 }]} numberOfLines={4}>
                        {keystone.desc}
                      </Text>
                    </Card>
                  </FadeIn>
                ) : null}
                {primary.runeRows.slice(1, 4).map((row, i) => (
                  <RuneRow key={i} ids={row} selected={draft.perks[i + 1]!} size={48} color={accent} data={data} onPick={(id) => choosePrimaryRune(i + 1, id)} />
                ))}
              </>
            ) : null}
          </Section>

          {/* Secondary path */}
          <Section label="Secondary path" title={sub?.name} color={pathColor(draft.sub)}>
            <PathPicker
              styles={data}
              selected={draft.sub}
              exclude={draft.primary}
              allowed={primary?.allowedSubStyles}
              onPick={chooseSub}
            />
            {sub
              ? sub.runeRows.slice(1, 4).map((row, i) => (
                  <RuneRow
                    key={i}
                    ids={row}
                    selected={row.includes(draft.perks[4]!) ? draft.perks[4]! : row.includes(draft.perks[5]!) ? draft.perks[5]! : 0}
                    size={44}
                    color={pathColor(draft.sub)}
                    data={data}
                    onPick={(id) => chooseSecondary(i + 1, id)}
                  />
                ))
              : null}
            <Text style={[type.small, { textAlign: 'center' }]}>Pick 2, from different rows.</Text>
          </Section>

          {/* Stat shards */}
          <Section label="Stat shards" color={colors.muted}>
            {(primary?.shardRows ?? []).map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={[type.small, { width: 64 }]}>{row.label}</Text>
                <View style={{ flex: 1 }}>
                  <RuneRow ids={row.perks} selected={draft.perks[6 + i]!} size={36} color={colors.text} data={data} onPick={(id) => chooseShard(i, id)} />
                </View>
              </View>
            ))}
          </Section>
        </ScrollView>

        <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
          {problem ? <Text style={[type.small, { textAlign: 'center', color: colors.danger }]}>{problem}</Text> : null}
          <Button big busy={busy} disabled={!!problem} label={editable ? 'Save page' : 'Save as new page'} onPress={() => void save()} />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

// --- pieces ----------------------------------------------------------------------------------

function Section({ label, title, color, children }: { label: string; title?: string; color: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Eyebrow>{label}</Eyebrow>
        {title ? <Text style={{ fontFamily: fonts.semi, fontSize: 15, color }}>{title}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

function PathPicker({
  styles,
  selected,
  exclude,
  allowed,
  onPick,
}: {
  styles: GameData;
  selected: number;
  exclude?: number;
  allowed?: number[];
  onPick(style: RuneStyle): void;
}) {
  const list = [...styles.styles.values()].filter((st) => st.id !== exclude && (!allowed?.length || allowed.includes(st.id)));
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      {list.map((st) => {
        const on = st.id === selected;
        return (
          <Pressable key={st.id} onPress={() => onPick(st)} accessibilityRole="button" accessibilityLabel={st.name} accessibilityState={{ selected: on }} hitSlop={4}>
            <View style={[s.path, { borderColor: on ? pathColor(st.id) : colors.line, backgroundColor: on ? `${pathColor(st.id)}22` : 'transparent' }]}>
              <GameImage path={st.icon} size={30} rounded={0} style={{ backgroundColor: 'transparent' }} dim={!on} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function RuneRow({ ids, selected, size, color, data, onPick }: { ids: number[]; selected: number; size: number; color: string; data: GameData; onPick(id: number): void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
      {ids.map((id) => {
        const on = id === selected;
        const perk = data.perks.get(id);
        return (
          <Pressable key={id} onPress={() => onPick(id)} accessibilityRole="button" accessibilityLabel={perk?.name ?? 'Rune'} accessibilityState={{ selected: on }} hitSlop={4}>
            <View
              style={{
                padding: 3,
                borderRadius: size,
                borderWidth: 2,
                borderColor: on ? color : 'transparent',
                shadowColor: color,
                shadowOpacity: on ? 0.7 : 0,
                shadowRadius: 10,
              }}
            >
              <GameImage path={perk?.icon} size={size} rounded={size / 2} style={{ backgroundColor: on ? 'rgba(0,0,0,0.35)' : 'transparent', opacity: on ? 1 : 0.38 }} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- rules -----------------------------------------------------------------------------------

function secondaryDefaults(style: RuneStyle | undefined) {
  return [style?.runeRows[1]?.[0] ?? 0, style?.runeRows[2]?.[0] ?? 0];
}

function defaultsFor(primary: RuneStyle, sub: RuneStyle | undefined) {
  const d = primary.defaultPerks;
  return d.length === 9 ? [...d.slice(0, 4), ...secondaryDefaults(sub), ...d.slice(6)] : [...primary.runeRows.map((r) => r[0] ?? 0).slice(0, 4), ...secondaryDefaults(sub), ...primary.shardRows.map((r) => r.perks[0] ?? 0)];
}

/** Same rules as the bridge's validator, so the Save button can explain itself before sending. */
function check(d: Draft, data: GameData): string | null {
  const p = data.styles.get(d.primary);
  const s = data.styles.get(d.sub);
  if (!p || !s) return 'Pick a primary and a secondary path';
  if (!d.name.trim()) return 'Give the page a name';
  for (let i = 0; i < 4; i++) if (!p.runeRows[i]?.includes(d.perks[i]!)) return i === 0 ? 'Pick a keystone' : `Pick a rune in row ${i}`;
  const rowOf = (id: number) => s.runeRows.findIndex((r, i) => i > 0 && r.includes(id));
  const a = rowOf(d.perks[4]!);
  const b = rowOf(d.perks[5]!);
  if (a < 0 || b < 0) return 'Pick 2 secondary runes';
  if (a === b) return 'Secondary runes must be from different rows';
  for (let i = 0; i < 3; i++) if (p.shardRows[i] && !p.shardRows[i]!.perks.includes(d.perks[6 + i]!)) return 'Pick your stat shards';
  return null;
}

const s = StyleSheet.create({
  name: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.white,
    fontFamily: fonts.semi,
    fontSize: 18,
  },
  path: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: 'rgba(7,13,23,0.94)' },
});
