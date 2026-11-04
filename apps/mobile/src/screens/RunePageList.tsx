/** Rune pages with their keystone; tap one to make it the current page, the pencil to edit it. */
import type { RunePage } from '@league-remote/protocol';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBridge, useSend } from '@/bridge/BridgeProvider';
import { useGameData } from '@/bridge/gameData';
import { Card, GameImage, Icon } from '@/ui/components';
import { colors, fonts, radius, type } from '@/ui/theme';

export function RunePageList() {
  const { state } = useBridge();
  const send = useSend();
  const data = useGameData();
  const runes = state?.runes;

  if (!runes) return <Text style={type.small}>Rune pages show up once League is running.</Text>;

  // Editable pages first, then the client's temporary/recommended ones.
  const pages = [...runes.pages].sort((a, b) => Number(b.isEditable) - Number(a.isEditable));
  return (
    <View style={{ gap: 10 }}>
      {pages.map((p) => (
        <PageRow
          key={p.id}
          page={p}
          current={p.id === runes.currentPageId}
          keystone={data.perks.get(p.selectedPerkIds[0] ?? 0)}
          primary={data.styles.get(p.primaryStyleId)}
          secondary={data.styles.get(p.subStyleId)}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            void send({ type: 'setRunePage', pageId: p.id });
          }}
        />
      ))}
      <Pressable onPress={() => router.push('/rune-editor')} accessibilityRole="button" style={({ pressed }) => [s.newPage, { opacity: pressed ? 0.7 : 1 }]}>
        <Icon name="plus" size={18} color={colors.tealLight} strokeWidth={2.2} />
        <Text style={{ fontFamily: fonts.semi, fontSize: 15, color: colors.white }}>New rune page</Text>
      </Pressable>
    </View>
  );
}

function PageRow({
  page,
  current,
  keystone,
  primary,
  secondary,
  onPress,
}: {
  page: RunePage;
  current: boolean;
  keystone?: { name: string; icon: string };
  primary?: { name: string; icon: string };
  secondary?: { name: string; icon: string };
  onPress(): void;
}) {
  // The row and the pencil are sibling buttons (a button inside a button isn't allowed).
  return (
    <Card
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 14,
        borderColor: current ? 'rgba(10,200,185,0.45)' : colors.line,
        backgroundColor: current ? 'rgba(10,200,185,0.07)' : colors.surface,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Use ${page.name}`}
        accessibilityState={{ selected: current }}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, opacity: pressed ? 0.75 : 1 })}
      >
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' }}>
          <GameImage path={keystone?.icon} size={48} rounded={24} style={{ backgroundColor: 'transparent' }} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[type.body, { fontFamily: fonts.semi }]} numberOfLines={1}>
            {page.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <GameImage path={primary?.icon} size={16} rounded={8} style={{ backgroundColor: 'transparent' }} />
            <GameImage path={secondary?.icon} size={16} rounded={8} style={{ backgroundColor: 'transparent' }} />
            <Text style={type.small} numberOfLines={1}>
              {keystone?.name ?? primary?.name ?? ''}
              {page.isTemporary ? ' · temporary' : !page.isEditable ? ' · recommended' : ''}
            </Text>
          </View>
        </View>
        {current ? (
          <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={16} color={colors.bg} strokeWidth={2.6} />
          </View>
        ) : null}
      </Pressable>
      <Pressable
        onPress={() => router.push({ pathname: '/rune-editor', params: { pageId: String(page.id) } })}
        accessibilityRole="button"
        accessibilityLabel={page.isEditable && !page.isTemporary ? `Edit ${page.name}` : `Copy ${page.name} to a new page`}
        hitSlop={8}
        style={({ pressed }) => [s.edit, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="edit" size={17} color={colors.muted} />
      </Pressable>
    </Card>
  );
}

const s = StyleSheet.create({
  edit: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  newPage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
  },
});
