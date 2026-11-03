/** Play (profile, lobby, queue), Runes and Settings tabs, with a floating glass tab bar. */
import type { BridgeState, LobbyMember } from '@league-remote/protocol';
import { BlurView } from 'expo-blur';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridge, useElapsed } from '@/bridge/BridgeProvider';
import { profileIcon } from '@/bridge/gameData';
import { Button, Card, Eyebrow, FadeIn, GameImage, Icon, LiveDot, Screen, Spinner, TopBar, type IconName } from '@/ui/components';
import { colors, fonts, formatClock, radius, type } from '@/ui/theme';
import { RunePageList } from './RunePageList';

export type Tab = 'play' | 'runes' | 'settings';

export function HomeScreen({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <TopBar />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 110, gap: 14 }}>
        {tab === 'play' ? <PlayTab /> : tab === 'runes' ? <RunesTab /> : <SettingsTab />}
      </ScrollView>
      <TabBar tab={tab} onTab={onTab} bottom={insets.bottom} />
    </Screen>
  );
}

// --- Play ------------------------------------------------------------------------------------

function PlayTab() {
  const { state, status } = useBridge();
  if (status !== 'connected' || !state) return <Offline />;
  if (state.client === 'disconnected') {
    return (
      <Empty icon="monitor" title="League isn't running" text="Start the League client on your PC. This screen updates by itself." />
    );
  }
  return (
    <>
      <Profile state={state} />
      {state.matchmaking?.state === 'Searching' ? <Queue state={state} /> : null}
      {state.lobby ? (
        <Lobby state={state} />
      ) : (
        <Empty icon="play" title="No lobby yet" text="Pick a game mode in the League client. Your lobby and queue show up here." />
      )}
    </>
  );
}

function Profile({ state }: { state: BridgeState }) {
  const me = state.me;
  return (
    <FadeIn>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 }}>
        <View style={s.avatarRing}>
          <GameImage path={me ? profileIcon(me.iconId) : null} size={58} rounded={29} fallback={me?.name[0]} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.title} numberOfLines={1}>
            {me?.name ?? 'Summoner'}
            {me ? <Text style={{ color: colors.faint }}> #{me.tagLine}</Text> : null}
          </Text>
          <Text style={type.small}>{state.queue?.name ?? 'Not in a lobby'}</Text>
        </View>
      </View>
    </FadeIn>
  );
}

function Queue({ state }: { state: BridgeState }) {
  const mm = state.matchmaking!;
  const elapsed = useElapsed(mm.startedAt);
  return (
    <FadeIn>
      <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 18 }}>
        <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={210} />
          <Eyebrow color={colors.tealLight}>In queue</Eyebrow>
          <Text style={[type.number, { fontSize: 52, lineHeight: 58 }]}>{formatClock(elapsed)}</Text>
          {mm.estimatedMs ? <Text style={type.small}>Estimated {formatClock(mm.estimatedMs)}</Text> : null}
        </View>
        <Text style={[type.small, { textAlign: 'center', paddingHorizontal: 24 }]}>
          Your phone buzzes when a match is found. Leave the queue from your PC for now.
        </Text>
      </Card>
    </FadeIn>
  );
}

const POSITION: Record<string, string> = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support', FILL: 'Fill', UNSELECTED: '' };

function Lobby({ state }: { state: BridgeState }) {
  const lobby = state.lobby!;
  const ready = lobby.members.filter((m) => m.ready).length;
  return (
    <FadeIn delay={60}>
      <Card style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Eyebrow>
            Party · {lobby.members.length}/{lobby.maxSize}
          </Eyebrow>
          <Text style={type.small}>{ready} ready</Text>
        </View>
        {lobby.members.map((m) => (
          <Member key={m.puuid || m.name} m={m} />
        ))}
        {state.matchmaking?.state !== 'Searching' ? (
          <View style={s.hint}>
            <Icon name="info" size={18} color={colors.muted} />
            <Text style={[type.small, { flex: 1 }]}>Start the queue on your PC. Find Match from the phone is coming soon.</Text>
          </View>
        ) : null}
      </Card>
    </FadeIn>
  );
}

function Member({ m }: { m: LobbyMember }) {
  const roles = m.positions.map((p) => (p ? POSITION[p] : '')).filter(Boolean).join(' · ');
  return (
    <View style={[s.member, m.isMe && { borderColor: 'rgba(10,200,185,0.35)', backgroundColor: 'rgba(10,200,185,0.06)' }]}>
      <GameImage path={profileIcon(m.iconId)} size={42} rounded={21} fallback={m.name?.[0]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[type.body, { fontFamily: fonts.semi }]} numberOfLines={1}>
            {m.isBot ? 'Bot' : (m.name?.split('#')[0] ?? 'Player')}
          </Text>
          {m.isLeader ? <Icon name="crown" size={15} color={colors.gold} strokeWidth={2} /> : null}
        </View>
        {roles ? <Text style={type.small}>{roles}</Text> : null}
      </View>
      <Text style={{ fontFamily: fonts.semi, fontSize: 12, letterSpacing: 1, color: m.ready ? colors.teal : colors.faint }}>{m.ready ? 'READY' : 'NOT READY'}</Text>
    </View>
  );
}

function Offline() {
  const { status, bridge } = useBridge();
  return (
    <Empty
      icon="monitor"
      title={status === 'connecting' ? 'Connecting…' : "Can't reach your PC"}
      text={`Make sure League Remote is running on ${bridge?.bridgeName ?? 'your PC'} and you're on the same Wi‑Fi. It reconnects by itself.`}
    />
  );
}

function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <FadeIn>
      <Card style={{ padding: 28, alignItems: 'center', gap: 12 }}>
        <View style={s.emptyIcon}>
          <Icon name={icon} size={26} color={colors.tealLight} />
        </View>
        <Text style={type.title}>{title}</Text>
        <Text style={[type.small, { textAlign: 'center', lineHeight: 20 }]}>{text}</Text>
      </Card>
    </FadeIn>
  );
}

// --- Runes / Settings ------------------------------------------------------------------------

function RunesTab() {
  return (
    <>
      <Text style={[type.hero, { fontSize: 30, paddingTop: 4 }]}>Rune pages</Text>
      <RunePageList />
    </>
  );
}

function SettingsTab() {
  const { bridge, status, unpair } = useBridge();
  return (
    <>
      <Text style={[type.hero, { fontSize: 30, paddingTop: 4 }]}>Settings</Text>
      <Card style={{ padding: 18, gap: 14 }}>
        <Eyebrow>Paired PC</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={s.emptyIcon}>
            <Icon name="monitor" size={22} color={colors.tealLight} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[type.body, { fontFamily: fonts.semi }]}>{bridge?.bridgeName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <LiveDot color={status === 'connected' ? colors.teal : colors.danger} pulse={status === 'connected'} />
              <Text style={type.small}>
                {bridge?.host}:{bridge?.port} · {status === 'connected' ? 'connected' : status}
              </Text>
            </View>
          </View>
        </View>
        <Button label="Unpair this phone" kind="ghost" onPress={() => void unpair()} />
      </Card>
      <Text style={[type.small, { textAlign: 'center', color: colors.faint }]}>League Remote 0.1 · not endorsed by Riot Games</Text>
    </>
  );
}

// --- tab bar ---------------------------------------------------------------------------------

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'play', label: 'Play', icon: 'play' },
  { id: 'runes', label: 'Runes', icon: 'runes' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function TabBar({ tab, onTab, bottom }: { tab: Tab; onTab(t: Tab): void; bottom: number }) {
  return (
    <View style={[s.tabBarWrap, { bottom: Math.max(bottom, 12) + 4 }]}>
      <View style={s.tabBar}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => onTab(t.id)} style={[s.tab, active && s.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Icon name={t.icon} size={20} color={active ? colors.tealLight : colors.muted} />
              <Text style={{ fontFamily: fonts.semi, fontSize: 13, color: active ? colors.white : colors.muted }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  avatarRing: { padding: 3, borderRadius: 34, borderWidth: 1.5, borderColor: colors.gold },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: colors.line },
  hint: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 4 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,200,185,0.1)', borderWidth: 1, borderColor: 'rgba(10,200,185,0.25)' },
  tabBarWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    padding: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(13,22,35,0.7)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 46, paddingHorizontal: 18, borderRadius: radius.pill },
  tabActive: { backgroundColor: 'rgba(10,200,185,0.14)' },
});
