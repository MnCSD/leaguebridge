/** Shared building blocks: backdrop, cards, buttons, gradient ring, switch, icons, banner. */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useBridge } from '@/bridge/BridgeProvider';
import { useAssetSource } from '@/bridge/gameData';
import { Logo } from './Logo';
import { colors, fonts, radius, type } from './theme';

// --- layout ----------------------------------------------------------------------------------

/**
 * Full screen with the desktop's soft glows. `art`: a splash image path shown blurred behind
 * everything and faded into the navy (champ select).
 */
export function Screen({ children, art, glow = 'teal' }: { children: ReactNode; art?: string | null; glow?: 'teal' | 'gold' | 'danger' }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Backdrop art={art} glow={glow} />
      <View style={{ flex: 1, paddingTop: insets.top }}>{children}</View>
      <ErrorBanner bottom={insets.bottom + 96} />
    </View>
  );
}

function Backdrop({ art, glow }: { art?: string | null; glow: 'teal' | 'gold' | 'danger' }) {
  const source = useAssetSource()(art);
  const tint = { teal: colors.teal, gold: colors.gold, danger: colors.danger }[glow];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {source ? (
        <FadeIn key={art} style={StyleSheet.absoluteFill}>
          <Image source={source} cachePolicy="memory-disk" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 520 }} contentFit="cover" blurRadius={2} />
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.bg} stopOpacity="0.35" />
                <Stop offset="0.35" stopColor={colors.bg} stopOpacity="0.55" />
                <Stop offset="0.62" stopColor={colors.bg} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#fade)" />
          </Svg>
        </FadeIn>
      ) : null}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="top" cx="120" cy="-40" r="380" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={tint} stopOpacity="0.18" />
            <Stop offset="1" stopColor={tint} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bottom" cx="420" cy="900" r="360" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.gold} stopOpacity="0.08" />
            <Stop offset="1" stopColor={colors.gold} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="120" cy="-40" r="380" fill="url(#top)" />
        <Circle cx="420" cy="900" r="360" fill="url(#bottom)" />
      </Svg>
    </View>
  );
}

/** App icon + wordmark (as in the desktop title bar) and the PC pill with a live connection dot. */
export function TopBar({ right }: { right?: ReactNode }) {
  const { bridge, status } = useBridge();
  const dot = status === 'connected' ? colors.teal : status === 'connecting' ? colors.gold : colors.danger;
  return (
    <View style={st.topBar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="header" accessibilityLabel="League Remote">
        <Logo size={30} />
        <Text style={type.brand}>
          League <Text style={{ color: colors.tealLight }}>Remote</Text>
        </Text>
      </View>
      {right ?? (
        <View style={st.pill}>
          <LiveDot color={dot} pulse={status === 'connected'} />
          <Text style={st.pillText} numberOfLines={1}>
            {status === 'connected' ? (bridge?.bridgeName ?? 'PC') : status === 'connecting' ? 'Connecting…' : 'PC offline'}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Soft raised surface, like the desktop cards. */
export function Card({ children, style, glass }: { children: ReactNode; style?: StyleProp<ViewStyle>; glass?: boolean }) {
  if (glass) {
    return (
      <View style={[st.card, { backgroundColor: 'rgba(13,22,35,0.55)', overflow: 'hidden' }, style]}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        {children}
      </View>
    );
  }
  return <View style={[st.card, style]}>{children}</View>;
}

export function Eyebrow({ children, style, color }: { children: ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  return <Text style={[type.eyebrow, color ? { color } : null, style]}>{children}</Text>;
}

// --- controls --------------------------------------------------------------------------------

type ButtonKind = 'primary' | 'danger' | 'gold' | 'ghost';
export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  big,
  style,
}: {
  label: string;
  onPress(): void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fill = { primary: colors.teal, danger: colors.danger, gold: colors.gold, ghost: 'rgba(255,255,255,0.06)' }[kind];
  const solid = kind !== 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={() => {
        Haptics.impactAsync(big ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        st.button,
        {
          height: big ? 60 : 50,
          backgroundColor: fill,
          borderColor: solid ? 'transparent' : colors.lineStrong,
          opacity: disabled ? 0.35 : 1,
          transform: [{ scale: pressed ? 0.975 : 1 }],
          shadowColor: solid ? fill : 'transparent',
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={solid ? colors.bg : colors.white} />
      ) : (
        <Text style={[st.buttonText, { color: solid ? colors.bg : colors.white, fontSize: big ? 18 : 16 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** iOS-style switch from the desktop app. */
export function Switch({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: value ? 1 : 0, useNativeDriver: false, bounciness: 8, speed: 18 }).start();
  }, [value, x]);
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} hitSlop={8}>
      <Animated.View
        style={[st.switch, { backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.1)', colors.teal] }) }]}
      >
        <Animated.View style={[st.knob, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
      </Animated.View>
    </Pressable>
  );
}

// --- visuals ---------------------------------------------------------------------------------

/** Gradient progress ring with content in the middle. `progress` 0..1. */
export function Ring({ size, progress, stroke = 8, danger, children }: { size: number; progress: number; stroke?: number; danger?: boolean; children?: ReactNode }) {
  const r = size / 2 - stroke - 6;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const [a, b] = danger ? [colors.danger, '#FF9A8A'] : [colors.teal, colors.tealLight];
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={b} />
            <Stop offset="1" stopColor={a} />
          </LinearGradient>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0.6" stopColor={a} stopOpacity="0" />
            <Stop offset="0.85" stopColor={a} stopOpacity="0.12" />
            <Stop offset="1" stopColor={a} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#halo)" />
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth={stroke}
          strokeDasharray={`${c * p} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
    </View>
  );
}

/** A slowly turning arc, for "waiting" states with no deadline (queue). */
export function Spinner({ size }: { size: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}>
      <Ring size={size} progress={0.22} />
    </Animated.View>
  );
}

/** Game image (champion, spell, skin...) through the bridge, with a letter while it loads. */
export function GameImage({
  path,
  size,
  width,
  height,
  rounded = radius.sm,
  fallback,
  style,
  dim,
}: {
  path?: string | null;
  size?: number;
  width?: number;
  height?: number;
  rounded?: number;
  fallback?: string;
  style?: StyleProp<ViewStyle>;
  dim?: boolean;
}) {
  const source = useAssetSource()(path);
  const w = width ?? size ?? 48;
  const h = height ?? size ?? 48;
  return (
    <View style={[{ width: w, height: h, borderRadius: rounded, backgroundColor: colors.raised, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {fallback ? <Text style={{ position: 'absolute', fontFamily: fonts.semi, color: colors.faint, fontSize: Math.min(w, h) * 0.36 }}>{fallback}</Text> : null}
      {source ? <Image source={source} cachePolicy="memory-disk" style={{ width: w, height: h, opacity: dim ? 0.45 : 1 }} contentFit="cover" transition={150} /> : null}
    </View>
  );
}

export function LiveDot({ color, pulse }: { color: string; pulse?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, v]);
  return (
    <View style={{ width: 8, height: 8 }}>
      {pulse ? (
        <Animated.View
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      ) : null}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

/** Content that rises in softly (desktop's `animate-rise`). Re-key it to replay. */
export function FadeIn({ children, style, delay = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 450, delay, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

function ErrorBanner({ bottom }: { bottom: number }) {
  const { lastError, clearError } = useBridge();
  useEffect(() => {
    if (!lastError) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [lastError, clearError]);
  if (!lastError) return null;
  return (
    <FadeIn key={lastError} style={[st.banner, { bottom }]}>
      <Pressable onPress={clearError} accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Icon name="info" color={colors.danger} size={20} />
        <Text style={st.bannerText}>{lastError}</Text>
      </Pressable>
    </FadeIn>
  );
}

// --- icons -----------------------------------------------------------------------------------

/** 24×24 stroke icons. */
const ICONS = {
  play: ['M7 4.5v15l12-7.5z'],
  runes: ['M12 6l2 6-2 6-2-6z', 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z'],
  settings: ['M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  back: ['M15 5l-7 7 7 7'],
  close: ['M6 6l12 12M18 6L6 18'],
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M20 20l-4-4'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8M12 16v4'],
  crown: ['M3 18h18M4 18l-1-10 5 4 4-7 4 7 5-4-1 10'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 8v5M12 16v.5'],
  brush: ['M4 20c3 0 5-2 5-4.5a2.5 2.5 0 0 0-5 0', 'M9 15.5L20 4.5'],
  check: ['M5 12l5 5L20 7'],
  swap: ['M7 7h11l-3-3M17 17H6l3 3'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12h16'],
  chevron: ['M9 6l6 6-6 6'],
  ban: ['M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M7 7l10 10'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  plus: ['M12 5v14M5 12h14'],
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color = colors.white, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

export const st = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, gap: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.pill,
    maxWidth: 190,
  },
  pillText: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderTopColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  buttonText: { fontFamily: fonts.semi, letterSpacing: 0.2 },
  switch: { width: 46, height: 26, borderRadius: 13, padding: 3 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#E9EDF3', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: '#2A1018',
    borderWidth: 1,
    borderColor: 'rgba(240,86,108,0.45)',
  },
  bannerText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.white },
});
