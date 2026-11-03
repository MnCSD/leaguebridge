/** Match found: big countdown ring, Accept / Decline. Buzzes when it appears. */
import type { ReadyCheck } from '@league-remote/protocol';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRemaining, useSend } from '@/bridge/BridgeProvider';
import { Button, Eyebrow, FadeIn, Icon, Ring, Screen } from '@/ui/components';
import { colors, fonts, type } from '@/ui/theme';

export function ReadyCheckScreen({ readyCheck, queueName }: { readyCheck: ReadyCheck; queueName?: string }) {
  const send = useSend();
  const insets = useSafeAreaInsets();
  const left = useRemaining(readyCheck.endsAt) ?? 0;
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const accepted = readyCheck.response === 'Accepted';
  const declined = readyCheck.response === 'Declined';

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const t = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}), 700);
    return () => clearTimeout(t);
  }, []);

  // Breathing glow behind the ring while waiting for me.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const respond = (type: 'accept' | 'decline') => {
    setBusy(type);
    void send({ type }).finally(() => setBusy(null));
  };

  return (
    <Screen glow={declined ? 'danger' : 'teal'}>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 48, paddingBottom: insets.bottom + 20 }}>
        <FadeIn style={{ alignItems: 'center', gap: 6 }}>
          <Eyebrow>{queueName ?? 'Match'}</Eyebrow>
          <Text style={[type.hero, { fontSize: 40 }]}>Match found</Text>
        </FadeIn>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={{
              position: 'absolute',
              width: 300,
              height: 300,
              borderRadius: 150,
              backgroundColor: colors.tealGlow,
              opacity: accepted ? 0.15 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.28] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] }) }],
            }}
          />
          <Ring size={270} progress={left / readyCheck.totalMs} stroke={10} danger={left < 4000 && !accepted}>
            {accepted ? (
              <FadeIn style={{ alignItems: 'center', gap: 8 }}>
                <Icon name="check" size={64} color={colors.tealLight} strokeWidth={2.4} />
                <Text style={[type.body, { color: colors.tealLight, fontFamily: fonts.semi }]}>Accepted</Text>
              </FadeIn>
            ) : (
              <>
                <Text style={[type.number, { fontSize: 96, lineHeight: 104, fontFamily: fonts.bold }]}>{Math.ceil(left / 1000)}</Text>
                <Text style={type.small}>seconds to accept</Text>
              </>
            )}
          </Ring>
        </View>

        <View style={{ width: '100%', gap: 12 }}>
          {accepted ? (
            <Text style={[type.small, { textAlign: 'center', paddingBottom: 12 }]}>Waiting for the other players…</Text>
          ) : (
            <>
              <Button label="Accept" big busy={busy === 'accept'} onPress={() => respond('accept')} style={{ height: 72 }} />
              <Button label="Decline" kind="ghost" busy={busy === 'decline'} onPress={() => respond('decline')} />
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}
