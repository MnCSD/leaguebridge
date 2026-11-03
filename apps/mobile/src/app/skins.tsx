/** Skins for my locked champion: big splash preview, chromas, and the owned/locked grid. */
import type { Skin } from '@league-remote/protocol';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridge, useSend } from '@/bridge/BridgeProvider';
import { useGameData } from '@/bridge/gameData';
import { Button, GameImage, Icon } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { colors, fonts, radius, type } from '@/ui/theme';

export default function SkinsSheet() {
  const { state } = useBridge();
  const send = useSend();
  const data = useGameData();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cs = state?.champSelect;
  const me = cs?.myTeam.find((p) => p.isMe);
  const champId = me?.championId ?? 0;
  const skins = cs?.skins ?? [];

  const selectedBase = skins.find((s) => s.id === me?.skinId || s.chromas.some((c) => c.id === me?.skinId));
  const [preview, setPreview] = useState<Skin | undefined>(selectedBase);
  const shown = preview ?? selectedBase ?? skins[0];
  // Width of the content column, measured (the window width is wrong when a scrollbar takes space).
  const [contentW, setContentW] = useState(width - 40);

  if (!cs || !champId || !shown) {
    return (
      <Sheet title="Skins">
        <Text style={[type.small, { paddingHorizontal: 20 }]}>Lock in a champion to choose a skin.</Text>
      </Sheet>
    );
  }

  const apply = (id: number) => {
    Haptics.selectionAsync().catch(() => {});
    void send({ type: 'setSkin', skinId: id });
  };
  const GAP = 12;
  const tileW = Math.floor((contentW - GAP) / 2);
  const ownedCount = skins.filter((s) => s.owned).length;

  return (
    <Sheet eyebrow={`${data.champions.get(champId)?.name ?? 'Champion'} · ${ownedCount} owned`} title="Skins">
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View
          onLayout={(e) => setContentW(Math.floor(e.nativeEvent.layout.width))}
          style={{ marginHorizontal: 20, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.lineStrong }}
        >
          <GameImage path={shown.splashPath} width={contentW} height={contentW * 0.59} rounded={0} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: 'rgba(7,13,23,0.6)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[type.title, { flex: 1, fontSize: 19 }]} numberOfLines={1}>
              {shown.name || 'Default'}
            </Text>
            {!shown.owned ? <Text style={{ fontFamily: fonts.semi, color: colors.muted, fontSize: 13 }}>Not owned</Text> : null}
          </View>
        </View>

        {shown.chromas.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20 }}>
            {[{ id: shown.id, colors: [] as string[], owned: shown.owned, name: 'Base' }, ...shown.chromas].map((c) => {
              const on = me?.skinId === c.id;
              return (
                <Pressable
                  key={c.id}
                  disabled={!c.owned}
                  onPress={() => apply(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={c.name || 'Chroma'}
                  accessibilityState={{ selected: on, disabled: !c.owned }}
                  style={{ width: 36, height: 36, borderRadius: 18, padding: 3, borderWidth: 2, borderColor: on ? colors.white : 'transparent', opacity: c.owned ? 1 : 0.35 }}
                >
                  <View style={{ flex: 1, borderRadius: 14, backgroundColor: c.colors[0] ?? colors.gold, borderWidth: 1, borderColor: colors.lineStrong }} />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 16, paddingHorizontal: 20 }}>
          {skins.map((s) => {
            const on = s.id === shown.id;
            const usable = s.owned && !s.disabled;
            return (
              <Pressable key={s.id} onPress={() => setPreview(s)} style={{ width: tileW, gap: 6 }} accessibilityRole="button" accessibilityLabel={s.name} accessibilityState={{ selected: on }}>
                <View style={{ borderRadius: 16, padding: 2, borderWidth: 2, borderColor: on ? colors.teal : 'transparent' }}>
                  <GameImage path={s.tilePath} width={tileW - 8} height={Math.round((tileW - 8) * 1.18)} rounded={12} dim={!usable} />
                  {!usable ? (
                    <View style={{ position: 'absolute', top: 10, right: 10, padding: 5, borderRadius: 9, backgroundColor: 'rgba(7,13,23,0.75)' }}>
                      <Icon name="ban" size={14} color={colors.muted} />
                    </View>
                  ) : null}
                </View>
                <Text style={{ fontFamily: on ? fonts.semi : fonts.medium, fontSize: 14, color: on ? colors.white : colors.muted }} numberOfLines={1}>
                  {s.name || 'Default'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <Button
            big
            label={me?.skinId === shown.id ? 'Selected' : shown.owned ? 'Use this skin' : "You don't own this skin"}
            disabled={!shown.owned || shown.disabled || me?.skinId === shown.id}
            onPress={() => apply(shown.id)}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
