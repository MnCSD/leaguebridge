/** Summoner spells: choose a slot (D or F), then a spell. Picking the other slot's spell swaps them. */
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridge, useSend } from '@/bridge/BridgeProvider';
import { useGameData } from '@/bridge/gameData';
import { Button, Card, Eyebrow, GameImage, Icon } from '@/ui/components';
import { Sheet } from '@/ui/Sheet';
import { colors, fonts, radius, type } from '@/ui/theme';

export default function SpellsSheet() {
  const { state } = useBridge();
  const send = useSend();
  const data = useGameData();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [slot, setSlot] = useState<0 | 1>(0);
  const me = state?.champSelect?.myTeam.find((p) => p.isMe);

  const spells = useMemo(
    () =>
      [...data.spells.values()]
        .filter((sp) => sp.id > 0 && sp.icon && (sp.gameModes.includes('CLASSIC') || sp.id === me?.spell1Id || sp.id === me?.spell2Id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, me?.spell1Id, me?.spell2Id],
  );

  if (!me) {
    return (
      <Sheet title="Summoner spells">
        <Text style={[type.small, { paddingHorizontal: 20 }]}>Spells can be changed during champion select.</Text>
      </Sheet>
    );
  }

  const current: [number, number] = [me.spell1Id, me.spell2Id];
  const set = (pair: [number, number]) => {
    Haptics.selectionAsync().catch(() => {});
    void send({ type: 'setSpells', spell1Id: pair[0], spell2Id: pair[1] });
  };
  const choose = (id: number) => {
    const other = slot === 0 ? 1 : 0;
    const next: [number, number] = [...current];
    if (current[other] === id) next[other] = current[slot];
    next[slot] = id;
    set(next);
    if (slot === 0) setSlot(1);
  };
  const tile = (width - 40 - 3 * 12) / 4;

  return (
    <Sheet eyebrow="Champ select" title="Summoner spells">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {([0, 1] as const).map((i) => {
            const sp = data.spells.get(current[i]);
            const active = slot === i;
            return (
              <Pressable key={i} onPress={() => setSlot(i)} style={{ flex: 1 }} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderColor: active ? colors.teal : colors.line, backgroundColor: active ? 'rgba(10,200,185,0.08)' : colors.surface }}>
                  <GameImage path={sp?.icon} size={44} rounded={10} />
                  <View style={{ flex: 1 }}>
                    <Eyebrow>{i === 0 ? 'D' : 'F'} key</Eyebrow>
                    <Text style={[type.body, { fontFamily: fonts.semi }]} numberOfLines={1}>
                      {sp?.name ?? '—'}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => set([current[1], current[0]])} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'center' }} accessibilityRole="button">
          <Icon name="swap" size={18} color={colors.tealLight} />
          <Text style={{ fontFamily: fonts.semi, color: colors.tealLight, fontSize: 15 }}>Swap D and F</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {spells.map((sp) => {
            const inSlot = current[slot] === sp.id;
            const inOther = current[slot === 0 ? 1 : 0] === sp.id;
            return (
              <Pressable key={sp.id} onPress={() => choose(sp.id)} style={{ width: tile, alignItems: 'center', gap: 6 }} accessibilityRole="button" accessibilityLabel={sp.name} accessibilityState={{ selected: inSlot }}>
                <View style={{ padding: 2, borderRadius: radius.md, borderWidth: 2, borderColor: inSlot ? colors.teal : inOther ? colors.lineStrong : 'transparent' }}>
                  <GameImage path={sp.icon} size={tile - 8} rounded={12} />
                </View>
                <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: inSlot ? colors.white : colors.muted }} numberOfLines={1}>
                  {sp.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Button label="Done" kind="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Sheet>
  );
}
