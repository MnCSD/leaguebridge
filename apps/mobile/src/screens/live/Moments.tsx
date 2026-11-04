/**
 * Full-screen "moments" for the big events, like a broadcast replay banner: the champion's splash,
 * a huge title and a haptic pattern. Only events that arrive while watching are shown (no replay
 * of history when the screen opens). Victory / Defeat stays until tapped.
 */
import type { LiveEvent, LiveGame } from '@league-remote/protocol';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useDefaultSplash, useGameData } from '@/bridge/gameData';
import { GameImage } from '@/ui/components';
import { colors, fonts } from '@/ui/theme';
import { MULTIKILL, championId, dragonInfo, playerByName } from './util';

interface Moment {
  key: number;
  title: string;
  subtitle: string;
  /** Player whose splash fills the background. */
  champion: string | null;
  ally: boolean;
  sticky: boolean;
  pulses: number;
}

/** Which events become a moment, and how they read. */
function toMoment(e: LiveEvent, game: LiveGame): Moment | null {
  const killer = playerByName(game, e.killer);
  const ally = e.team === game.myTeam;
  const who = killer ? `${killer.isMe ? 'You' : killer.name} · ${killer.championName}` : ally ? 'Your team' : 'Enemy team';
  const base = { key: e.id, champion: killer?.name ?? null, ally, sticky: false, pulses: 1 };
  switch (e.kind) {
    case 'multikill': {
      const n = Number(e.detail);
      // Every multikill of my team; the enemy's from triple up.
      if (!ally && n < 3) return null;
      return { ...base, title: MULTIKILL[e.detail ?? ''] ?? 'Multikill', subtitle: who, pulses: n };
    }
    case 'firstBlood':
      return { ...base, title: 'First blood', subtitle: who };
    case 'ace':
      return { ...base, title: 'Ace', subtitle: ally ? 'Your team wiped them out' : 'Your team was wiped', pulses: 2 };
    case 'baron':
      return { ...base, title: e.stolen ? 'Baron stolen' : 'Baron Nashor', subtitle: who, pulses: 2 };
    case 'dragon': {
      if (e.detail === 'Elder') return { ...base, title: 'Elder dragon', subtitle: who, pulses: 2 };
      const team = e.team ? game.objectives[e.team] : null;
      // The 4th dragon of a team is its soul.
      if (team && team.dragons.length === 4) return { ...base, title: `${dragonInfo(team.dragons[3]!).name} soul`, subtitle: ally ? 'Your team' : 'Enemy team', pulses: 2 };
      return null;
    }
    case 'gameEnd':
      return { ...base, title: e.detail === 'Win' ? 'Victory' : 'Defeat', subtitle: game.mode === 'ARAM' ? 'ARAM' : "Summoner's Rift", ally: e.detail === 'Win', sticky: true, champion: game.players.find((p) => p.isMe)?.name ?? null, pulses: 3 };
    default:
      return null;
  }
}

export function Moments({ game }: { game: LiveGame }) {
  const seen = useRef<number | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);

  useEffect(() => {
    const maxId = game.events.reduce((m, e) => Math.max(m, e.id), -1);
    if (seen.current === null) {
      seen.current = maxId; // first render: history is not news
      return;
    }
    const fresh = game.events.filter((e) => e.id > seen.current!);
    seen.current = Math.max(seen.current, maxId);
    const moments = fresh.map((e) => toMoment(e, game)).filter((m): m is Moment => !!m);
    if (!moments.length) return;
    setQueue((q) => {
      let next = [...q];
      for (const m of moments) {
        // A triple right after a double (same player): replace, don't stack.
        if (/kill$/i.test(m.title)) next = next.filter((x) => !(x.champion === m.champion && /kill$/i.test(x.title)));
        next.push(m);
      }
      return next;
    });
  }, [game]);

  const current = queue[0];
  if (!current) return null;
  return <MomentView key={current.key} moment={current} game={game} onDone={() => setQueue((q) => q.slice(1))} />;
}

function MomentView({ moment, game, onDone }: { moment: Moment; game: LiveGame; onDone(): void }) {
  const data = useGameData();
  const player = playerByName(game, moment.champion);
  const splash = useDefaultSplash(championId(data, player));
  const v = useRef(new Animated.Value(0)).current;
  const { width, height } = useWindowDimensions();
  // The parent re-renders every second (new game data): keep the latest onDone without restarting.
  const done = useRef(onDone);
  done.current = onDone;
  const accent = moment.ally ? colors.teal : colors.danger;

  useEffect(() => {
    // Haptics: one strong pulse per kill in a multikill, a short pattern for the rest.
    const heavy = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    for (let i = 0; i < moment.pulses; i++) setTimeout(heavy, i * 140);
    setTimeout(
      () => Haptics.notificationAsync(moment.ally ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {}),
      moment.pulses * 140 + 60,
    );

    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 7 }).start();
    if (moment.sticky) return;
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 2, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => done.current());
    }, 2600);
    return () => clearTimeout(t);
  }, [moment, v]);

  const opacity = v.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, zIndex: 50 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => done.current()} accessibilityRole="button" accessibilityLabel={`${moment.title}. Tap to close`}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />
        {splash ? (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: v.interpolate({ inputRange: [0, 1, 2], outputRange: [1.15, 1.02, 1] }) }] }]}>
            <GameImage
              path={splash}
              width={height * 1.7}
              height={height}
              rounded={0}
              style={{ position: 'absolute', top: 0, left: (width - height * 1.7) / 2, opacity: 0.55, backgroundColor: 'transparent' }}
            />
          </Animated.View>
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,13,23,0.35)' }]} />
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
          <Svg width={420} height={420} style={{ position: 'absolute' }} pointerEvents="none">
            <Defs>
              <RadialGradient id="momentGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={accent} stopOpacity="0.42" />
                <Stop offset="0.55" stopColor={accent} stopOpacity="0.12" />
                <Stop offset="1" stopColor={accent} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx={210} cy={210} r={210} fill="url(#momentGlow)" />
          </Svg>
          <Animated.Text
            style={[
              s.title,
              { fontSize: titleSize(moment.title), textShadowColor: accent, transform: [{ scale: v.interpolate({ inputRange: [0, 1, 2], outputRange: [1.6, 1, 0.92] }) }] },
            ]}
            numberOfLines={1}
          >
            {moment.title.toUpperCase()}
          </Animated.Text>
          <View style={[s.bar, { backgroundColor: accent }]} />
          <Text style={s.subtitle}>{moment.subtitle}</Text>
          {moment.sticky ? <Text style={s.hint}>Tap to see the scoreboard</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Big but always on one line on a phone-width screen. */
const titleSize = (title: string) => (title.length <= 6 ? 64 : title.length <= 9 ? 50 : title.length <= 12 ? 40 : 32);

const s = StyleSheet.create({
  title: {
    fontFamily: fonts.brand,
    fontSize: 54,
    letterSpacing: 1,
    color: colors.white,
    textAlign: 'center',
    textShadowRadius: 28,
    textShadowOffset: { width: 0, height: 0 },
  },
  bar: { width: 64, height: 4, borderRadius: 2, marginVertical: 16 },
  subtitle: { fontFamily: fonts.semi, fontSize: 18, color: colors.text, textAlign: 'center' },
  hint: { position: 'absolute', bottom: 60, fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
});
