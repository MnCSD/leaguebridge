/**
 * Desk mode: the phone standing next to the keyboard. Huge clock and score, the gold lead and the
 * latest event, over a living background: your champion's splash, blurred and dark, under a color
 * "mood" that follows the game (dead, baron buff, a fresh dragon, ahead or behind, the result).
 * Moods crossfade slowly. Stays awake; dims itself when nothing happens, lights up on new events.
 */
import type { LiveEvent, LiveGame, Team } from '@league-remote/protocol';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useAssetSource, useDefaultSplash, useGameData } from '@/bridge/gameData';
import { GameImage, LiveDot } from '@/ui/components';
import { colors, fonts, radius, type } from '@/ui/theme';
import { GoldGraph } from './GoldGraph';
import { Moments } from './Moments';
import { championIconFor, championId, describeEvent, dragonInfo, formatGameTime, formatGold, playerByName, teamColor, useCountdown } from './util';

const BARON_BUFF = 180;
const ELDER_BUFF = 150;
const DRAGON_GLOW = 45;
const ACE_GLOW = 30;

interface Mood {
  /** Changes when the mood changes (drives the crossfade). */
  key: string;
  /** Main color of the glow, and how strong it is (0..1). */
  color: string;
  strength: number;
  /** Small pill under the score, e.g. "Baron buff · 2:41". */
  label: string | null;
  /** Seconds left on the label's timer, counted from game time `since`. */
  timer?: { until: number };
  /** Drain the splash's color (death). */
  muted?: boolean;
}

/** What the background should feel like right now, most important situation first. */
function moodFor(game: LiveGame, clock: number): Mood {
  const me = game.players.find((p) => p.isMe);
  const ours = (t: Team | null) => t === game.myTeam;
  const recent = (kind: LiveEvent['kind'], seconds: number, pred: (e: LiveEvent) => boolean = () => true) =>
    [...game.events].reverse().find((e) => e.kind === kind && clock - e.time < seconds && clock >= e.time && pred(e));

  if (game.result === 'Win') return { key: 'win', color: '#F2C66D', strength: 0.75, label: 'Victory' };
  if (game.result === 'Lose') return { key: 'lose', color: '#B3263A', strength: 0.7, label: 'Defeat' };
  if (me?.isDead) return { key: 'dead', color: '#B3263A', strength: 0.55, label: 'Respawning', muted: true };

  const baron = recent('baron', BARON_BUFF);
  if (baron) return { key: `baron-${baron.id}`, color: ours(baron.team) ? '#9B6BFF' : '#C2185B', strength: 0.65, label: ours(baron.team) ? 'Baron buff' : 'Enemy has Baron', timer: { until: baron.time + BARON_BUFF } };

  const elder = recent('dragon', ELDER_BUFF, (e) => e.detail === 'Elder');
  if (elder) return { key: `elder-${elder.id}`, color: '#F2C66D', strength: 0.65, label: ours(elder.team) ? 'Elder buff' : 'Enemy has Elder', timer: { until: elder.time + ELDER_BUFF } };

  const dragon = recent('dragon', DRAGON_GLOW);
  if (dragon) return { key: `dragon-${dragon.id}`, color: dragonInfo(dragon.detail).color, strength: 0.6, label: `${dragonInfo(dragon.detail).name} dragon · ${ours(dragon.team) ? 'yours' : 'theirs'}` };

  const ace = recent('ace', ACE_GLOW);
  if (ace) return { key: `ace-${ace.id}`, color: ours(ace.team) ? colors.teal : colors.danger, strength: 0.6, label: ours(ace.team) ? 'Ace · push now' : 'Your team was aced' };

  // Default: the gold lead colors the room; the bigger the lead, the stronger.
  const lead = game.goldDiff;
  const strength = 0.22 + Math.min(Math.abs(lead) / 8000, 1) * 0.33;
  const stage = clock < 14 * 60 ? 'Early game' : clock < 25 * 60 ? 'Mid game' : 'Late game';
  const side = Math.abs(lead) < 500 ? 'even' : lead > 0 ? 'ahead' : 'behind';
  return {
    key: `lead-${side}-${stage}`,
    color: side === 'behind' ? colors.danger : colors.teal,
    strength: side === 'even' ? 0.2 : strength,
    label: `${stage} · ${side === 'even' ? 'even' : `${side} by ${formatGold(Math.abs(lead))}`}`,
  };
}

export function DeskMode({ game, clock, onClose }: { game: LiveGame; clock: number; onClose(): void }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const data = useGameData();
  const me = game.players.find((p) => p.isMe);
  const splash = useDefaultSplash(championId(data, me));
  const mood = moodFor(game, clock);
  const last = game.events.filter((e) => e.kind !== 'firstBlood').at(-1);
  const killer = playerByName(game, last?.killer ?? null);

  // Dim after 12s of nothing new; light up on every event and every mood change.
  const glow = useRef(new Animated.Value(1)).current;
  const wake = `${last?.id}-${mood.key}`;
  useEffect(() => {
    glow.setValue(1);
    const t = setTimeout(() => Animated.timing(glow, { toValue: 0, duration: 1800, useNativeDriver: true }).start(), 12_000);
    return () => clearTimeout(t);
  }, [wake, glow]);

  return (
    <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000' }} accessibilityRole="button" accessibilityLabel="Leave desk mode">
      <Ambient splash={splash} mood={mood} />
      <Animated.View
        style={{
          flex: 1,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 28,
          opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <LiveDot color={game.result ? colors.gold : mood.color} pulse={!game.result} />
          <Text style={[type.eyebrow, { color: colors.text }]}>{game.result ? (game.result === 'Win' ? 'Victory' : 'Defeat') : 'Live'}</Text>
          {me ? <Text style={[type.eyebrow, { color: colors.muted }]}>· {me.championName}</Text> : null}
        </View>
        <Text style={[type.number, s.clock]}>{formatGameTime(clock)}</Text>
        {me ? (
          <Text style={[type.number, { fontSize: 44, lineHeight: 50, color: colors.white }]}>
            {me.kills} <Text style={{ color: 'rgba(255,255,255,0.35)' }}>/</Text> {me.deaths} <Text style={{ color: 'rgba(255,255,255,0.35)' }}>/</Text> {me.assists}
          </Text>
        ) : null}
        <MoodPill mood={mood} game={game} clock={clock} />

        <View style={{ flex: 1 }} />
        <View style={s.panel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[type.eyebrow, { color: colors.text }]}>Gold lead</Text>
            <Text style={[type.number, { fontSize: 30, color: game.goldDiff >= 0 ? colors.tealLight : '#FF8A9A' }]}>{formatGold(game.goldDiff, true)}</Text>
          </View>
          <GoldGraph history={game.goldHistory} current={game.goldDiff} gameTime={game.gameTime} height={104} />
        </View>
        {last ? (
          <View style={[s.panel, { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }]}>
            {killer ? <GameImage path={championIconFor(data, killer)} size={40} rounded={20} /> : <View style={[s.dot, { backgroundColor: teamColor(last.team, game.myTeam) }]} />}
            <Text style={[type.title, { flex: 1, fontSize: 19, color: teamColor(last.team, game.myTeam) }]} numberOfLines={2}>
              {describeEvent(last)}
            </Text>
            <Text style={[type.number, { fontSize: 14, color: colors.muted }]}>{formatGameTime(last.time)}</Text>
          </View>
        ) : null}
        <Text style={[type.small, { textAlign: 'center', paddingTop: 18, color: 'rgba(255,255,255,0.4)' }]}>Tap anywhere to leave desk mode</Text>
      </Animated.View>
      <Moments game={game} />
    </Pressable>
  );
}

/** "Baron buff · 2:41", "Respawning · 12", "Mid game · ahead by 2.4k"... */
function MoodPill({ mood, game, clock }: { mood: Mood; game: LiveGame; clock: number }) {
  const me = game.players.find((p) => p.isMe);
  const respawn = useCountdown(me?.isDead ? me.respawnSeconds : 0, game.receivedAt);
  if (!mood.label) return null;
  const time = mood.timer ? formatGameTime(Math.max(0, mood.timer.until - clock)) : mood.key === 'dead' ? String(Math.ceil(respawn)) : null;
  return (
    <View style={[s.pill, { borderColor: `${mood.color}88`, backgroundColor: `${mood.color}26` }]}>
      <View style={[s.dot, { backgroundColor: mood.color, width: 8, height: 8 }]} />
      <Text style={{ fontFamily: fonts.semi, fontSize: 15, color: colors.white }}>
        {mood.label}
        {time ? <Text style={[type.number, { color: mood.color }]}>  {time}</Text> : null}
      </Text>
    </View>
  );
}

// --- the background --------------------------------------------------------------------------------

/** Splash + mood glow; a new mood fades in over the old one. */
function Ambient({ splash, mood }: { splash: string | null; mood: Mood }) {
  const [layers, setLayers] = useState<Mood[]>([mood]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1]!.key === mood.key ? l.map((x, i) => (i === l.length - 1 ? mood : x)) : [...l.slice(-1), mood]));
  }, [mood.key, mood.strength, mood.color]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = useAssetSource()(splash);
  const muted = mood.muted;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {source ? (
        <Image
          source={source}
          cachePolicy="memory-disk"
          style={[StyleSheet.absoluteFill, { opacity: muted ? 0.16 : 0.32 }]}
          contentFit="cover"
          blurRadius={14}
          transition={900}
        />
      ) : null}
      {layers.map((m, i) => (
        <MoodLayer key={m.key} mood={m} fadeIn={i > 0} onShown={() => setLayers((l) => (l.length > 1 ? l.slice(-1) : l))} />
      ))}
    </View>
  );
}

function MoodLayer({ mood, fadeIn, onShown }: { mood: Mood; fadeIn: boolean; onShown(): void }) {
  const v = useRef(new Animated.Value(fadeIn ? 0 : 1)).current;
  const shown = useRef(onShown);
  shown.current = onShown;
  useEffect(() => {
    if (!fadeIn) return;
    Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => shown.current());
  }, [fadeIn, v]);
  const id = mood.key.replace(/[^a-z0-9]/gi, '');
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: v }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`fade${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0.15" />
            <Stop offset="0.55" stopColor="#000" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.9" />
          </LinearGradient>
          <RadialGradient id={`top${id}`} cx="30%" cy="8%" r="75%">
            <Stop offset="0" stopColor={mood.color} stopOpacity={mood.strength} />
            <Stop offset="1" stopColor={mood.color} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`low${id}`} cx="85%" cy="100%" r="60%">
            <Stop offset="0" stopColor={mood.color} stopOpacity={mood.strength * 0.6} />
            <Stop offset="1" stopColor={mood.color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#fade${id})`} />
        <Rect width="100%" height="100%" fill={`url(#top${id})`} />
        <Rect width="100%" height="100%" fill={`url(#low${id})`} />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  clock: { fontFamily: fonts.bold, fontSize: 104, lineHeight: 112, letterSpacing: -3, color: colors.white },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', marginTop: 16, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  panel: { padding: 14, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
