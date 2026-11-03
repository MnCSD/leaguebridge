/** Layout for the modal sheets (spells, skins, runes): title row with a close button. */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Eyebrow, Icon, Screen } from './components';
import { colors, type } from './theme';

export function Sheet({ eyebrow, title, children, art }: { eyebrow?: string; title: string; children: ReactNode; art?: string | null }) {
  return (
    <Screen art={art}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <Text style={[type.hero, { fontSize: 30 }]}>{title}</Text>
        </View>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: colors.line }}
        >
          <Icon name="close" size={18} />
        </Pressable>
      </View>
      {children}
    </Screen>
  );
}
