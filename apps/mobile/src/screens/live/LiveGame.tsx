/**
 * In game: your own esports broadcast. Live clock, your champion and score over its splash, the
 * gold-lead graph, objectives, the event feed and both teams with items. Big events take over the
 * screen (Moments); when you die, a respawn countdown with your gold. Desk mode (DeskMode.tsx)
 * turns the phone into an always-on dashboard with a background that follows the game. Everything here is what the game itself shows you.
 */
import type { LiveEvent, LiveGame, LivePlayer, Team } from '@league-remote/protocol';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDefaultSplash, useGameData, type GameData } from '@/bridge/gameData';
import { Card, Eyebrow, FadeIn, GameImage, Icon, Ring, Screen } from '@/ui/components';
import { Logo } from '@/ui/Logo';
import { colors, fonts, radius, type } from '@/ui/theme';
import { DeskMode } from './DeskMode';
import { GoldGraph } from './GoldGraph';
import { Moments } from './Moments';
import {
  championIconFor,
  championId,
  describeEvent,
  dragonInfo,
  formatGameTime,
  formatGold,
  playerByName,
  teamColor,
  useCountdown,
  useGameClock,
} from './util';

export function LiveGameScreen({ game }: { game: LiveGame }) {
  const data = useGameData();
  const insets = useSafeAreaInsets();
  const [desk, setDesk] = useState(false);
  const me = game.players.find((p) => p.isMe);
  const splash = useDefaultSplash(championId(data, me));
  const clock = useGameClock(game);

  if (desk) return <DeskMode game={game} clock={clock} onClose={() => setDesk(false)} />;

  return (
    <Screen art={splash} glow={game.result === 'Lose' ? 'danger' : 'teal'}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Logo size={28} />
          <View>
            <Eyebrow color={game.result ? undefined : colors.tealLight}>{game.result ? (game.result === 'Win' ? 'Victory' : 'Defeat') : 'Live'}</Eyebrow>
            <Text style={[type.number, { fontSize: 24, lineHeight: 28 }]}>{formatGameTime(clock)}</Text>
          </View>
        </View>
        <Pressable onPress={() => setDesk(true)} style={s.deskButton} accessibilityRole="button" accessibilityLabel="Desk mode">
          <Icon name="monitor" size={18} color={colors.tealLight} />
          <Text style={{ fontFamily: fonts.semi, fontSize: 14, color: colors.white }}>Desk mode</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
        {me ? <Hero me={me} game={game} /> : null}
        {me?.isDead ? <DeathCard me={me} game={game} /> : null}

        <Card glass style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Eyebrow>Gold lead</Eyebrow>
            <Text style={[type.number, { fontSize: 22, color: game.goldDiff >= 0 ? colors.tealLight : '#FF8A9A' }]}>{formatGold(game.goldDiff, true)}</Text>
          </View>
          <GoldGraph history={game.goldHistory} current={game.goldDiff} gameTime={game.gameTime} />
        </Card>

        <Objectives game={game} />
        <Feed game={game} data={data} />
        <TeamList title="Your team" team={game.myTeam} game={game} data={data} />
        <TeamList title="Enemy team" team={game.myTeam === 'ORDER' ? 'CHAOS' : 'ORDER'} game={game} data={data} />
      </ScrollView>
      <Moments game={game} />
    </Screen>
  );
}

// --- hero: me ----------------------------------------------------------------------------------

function Hero({ me, game }: { me: LivePlayer; game: LiveGame }) {
  const perMin = game.gameTime > 60 ? (me.cs / (game.gameTime / 60)).toFixed(1) : '0.0';
  return (
    <FadeIn style={{ paddingTop: 70, paddingBottom: 6, gap: 4 }}>
      <Eyebrow color={colors.gold}>{me.championName}</Eyebrow>
      <Text style={[type.number, { fontFamily: fonts.bold, fontSize: 58, lineHeight: 62, letterSpacing: -1 }]}>
        {me.kills}
        <Text style={{ color: colors.faint }}> / </Text>
        <Text style={{ color: me.deaths ? '#FF8A9A' : colors.white }}>{me.deaths}</Text>
        <Text style={{ color: colors.faint }}> / </Text>
        {me.assists}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
        <Stat label="CS" value={`${me.cs} · ${perMin}/m`} />
        <Stat label="Level" value={String(me.level)} />
        <Stat label="Gold" value={me.isDead ? formatGold(game.myGold) : game.myGold.toLocaleString()} gold />
      </View>
    </FadeIn>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={{ fontFamily: fonts.semi, fontSize: 11, letterSpacing: 1.2, color: colors.muted }}>{label.toUpperCase()}</Text>
      <Text style={[type.number, { fontSize: 15, color: gold ? colors.gold : colors.white }]}>{value}</Text>
    </View>
  );
}

// --- death -------------------------------------------------------------------------------------

function DeathCard({ me, game }: { me: LivePlayer; game: LiveGame }) {
  const left = useCountdown(me.respawnSeconds, game.receivedAt);
  const total = useRef(Math.max(me.respawnSeconds, 1)).current;
  return (
    <FadeIn>
      <Card glass style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16, borderColor: 'rgba(240,86,108,0.35)' }}>
        <Ring size={88} stroke={6} progress={left / total} danger>
          <Text style={[type.number, { fontSize: 26 }]}>{Math.ceil(left)}</Text>
        </Ring>
        <View style={{ flex: 1, gap: 4 }}>
          <Eyebrow color={colors.danger}>You're dead</Eyebrow>
          <Text style={type.title}>Back in {Math.ceil(left)}s</Text>
          <Text style={type.small}>
            <Text style={{ color: colors.gold, fontFamily: fonts.semi }}>{game.myGold.toLocaleString()} gold</Text> to spend on the way back.
          </Text>
        </View>
      </Card>
    </FadeIn>
  );
}

// --- objectives --------------------------------------------------------------------------------

function Objectives({ game }: { game: LiveGame }) {
  const enemy: Team = game.myTeam === 'ORDER' ? 'CHAOS' : 'ORDER';
  const row = (team: Team, label: string) => {
    const o = game.objectives[team];
    const color = team === game.myTeam ? colors.teal : colors.danger;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 4, height: 28, borderRadius: 2, backgroundColor: color }} />
        <Text style={{ width: 54, fontFamily: fonts.semi, fontSize: 13, color: colors.text }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 5, flex: 1 }}>
          {[0, 1, 2, 3].map((i) => {
            const d = o.dragons[i];
            return (
              <View
                key={i}
                accessibilityLabel={d ? `${dragonInfo(d).name} dragon` : 'No dragon'}
                style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: d ? dragonInfo(d).color : colors.lineStrong, backgroundColor: d ? dragonInfo(d).color : 'transparent' }}
              />
            );
          })}
        </View>
        <Count label="Towers" value={o.towers} />
        <Count label="Grubs" value={o.grubs} />
        <Count label="Herald" value={o.heralds} />
        <Count label="Baron" value={o.barons} />
      </View>
    );
  };
  return (
    <Card glass style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Eyebrow>Objectives</Eyebrow>
        <Text style={[type.small, { fontSize: 11 }]}>Dragons · Towers · Grubs · Herald · Baron</Text>
      </View>
      {row(game.myTeam, 'You')}
      {row(enemy, 'Enemy')}
    </Card>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={{ width: 30, alignItems: 'center' }}>
      <Text style={[type.number, { fontSize: 16, color: value ? colors.white : colors.faint }]}>{value}</Text>
    </View>
  );
}

// --- feed --------------------------------------------------------------------------------------

function Feed({ game, data }: { game: LiveGame; data: GameData }) {
  // Kills and objectives, newest first; multikill/first blood lines repeat a kill, so skip them here.
  const events = game.events.filter((e) => e.kind !== 'multikill' && e.kind !== 'firstBlood').slice(-7).reverse();
  if (!events.length) return null;
  return (
    <Card glass style={{ padding: 16, gap: 10 }}>
      <Eyebrow>Feed</Eyebrow>
      {events.map((e, i) => (
        <FadeIn key={e.id} delay={i === 0 ? 0 : 0}>
          <FeedRow e={e} game={game} data={data} />
        </FadeIn>
      ))}
    </Card>
  );
}

function FeedRow({ e, game, data }: { e: LiveEvent; game: LiveGame; data: GameData }) {
  const killer = playerByName(game, e.killer);
  const victim = playerByName(game, e.victim);
  const mine = killer?.isMe || victim?.isMe;
  const color = teamColor(e.team, game.myTeam);
  return (
    <View style={[s.feedRow, mine && { backgroundColor: 'rgba(10,200,185,0.08)', borderColor: 'rgba(10,200,185,0.3)' }]}>
      <Text style={[type.number, { width: 42, fontSize: 12, color: colors.faint }]}>{formatGameTime(e.time)}</Text>
      {e.kind === 'kill' ? (
        <>
          <GameImage path={championIconFor(data, killer)} size={28} rounded={14} style={{ borderWidth: 1.5, borderColor: color }} fallback={killer?.championName[0]} />
          <Icon name="chevron" size={14} color={color} strokeWidth={2.4} />
          <GameImage path={championIconFor(data, victim)} size={28} rounded={14} dim fallback={victim?.championName[0]} />
          <Text style={[type.small, { flex: 1, color: colors.text }]} numberOfLines={1}>
            {killer?.isMe ? 'You' : (killer?.name ?? 'Executed')} <Text style={{ color: colors.faint }}>→</Text> {victim?.isMe ? 'you' : (victim?.name ?? '')}
          </Text>
        </>
      ) : (
        <>
          <View style={[s.objDot, { backgroundColor: e.kind === 'dragon' ? dragonInfo(e.detail).color : color }]} />
          <Text style={[type.small, { flex: 1, color: colors.text }]} numberOfLines={1}>
            {describeEvent(e)}
            {e.team ? <Text style={{ color }}>{e.team === game.myTeam ? '  · your team' : '  · enemy'}</Text> : null}
          </Text>
        </>
      )}
    </View>
  );
}

// --- teams -------------------------------------------------------------------------------------

const ORDER_POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

function TeamList({ title, team, game, data }: { title: string; team: Team; game: LiveGame; data: GameData }) {
  const players = game.players.filter((p) => p.team === team).sort((a, b) => ORDER_POS.indexOf(a.position ?? '') - ORDER_POS.indexOf(b.position ?? ''));
  const kills = players.reduce((n, p) => n + p.kills, 0);
  const color = team === game.myTeam ? colors.teal : colors.danger;
  return (
    <Card glass style={{ padding: 14, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 }}>
        <Eyebrow color={color}>{title}</Eyebrow>
        <Text style={[type.number, { fontSize: 15, color }]}>{kills} kills</Text>
      </View>
      {players.map((p) => (
        <PlayerRow key={p.name + p.champion} p={p} data={data} game={game} />
      ))}
    </Card>
  );
}

function PlayerRow({ p, data, game }: { p: LivePlayer; data: GameData; game: LiveGame }) {
  const left = useCountdown(p.isDead ? p.respawnSeconds : 0, game.receivedAt);
  return (
    <View style={[s.player, p.isMe && { borderColor: 'rgba(200,170,110,0.5)', backgroundColor: 'rgba(200,170,110,0.06)' }]}>
      <View>
        <GameImage path={championIconFor(data, p)} size={40} rounded={12} dim={p.isDead} fallback={p.championName[0]} />
        {p.isDead && left > 0 ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[type.number, { fontSize: 15, color: '#FF8A9A' }]}>{Math.ceil(left)}</Text>
          </View>
        ) : null}
        <View style={s.level}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.white }}>{p.level}</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[type.body, { fontFamily: fonts.semi, fontSize: 14, flex: 1, color: p.isMe ? colors.gold : colors.white }]} numberOfLines={1}>
            {p.isMe ? 'You' : p.name}
          </Text>
          <Text style={[type.number, { fontSize: 14 }]}>
            {p.kills}/{p.deaths}/{p.assists}
            <Text style={{ color: colors.faint }}> · {p.cs}</Text>
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {Array.from({ length: 7 }, (_, i) => {
            const id = p.items[i];
            const item = id ? data.items.get(id) : undefined;
            return <GameImage key={i} path={item?.icon} size={i === 6 ? 18 : 22} rounded={5} style={{ opacity: id ? 1 : 0.35, alignSelf: 'center' }} />;
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  deskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(13,22,35,0.7)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  stat: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: 'rgba(7,13,23,0.6)', borderWidth: 1, borderColor: colors.line, gap: 1 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  objDot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 9 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: colors.line },
  level: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
});
