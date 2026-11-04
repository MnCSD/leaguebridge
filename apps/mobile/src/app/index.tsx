/**
 * The one main screen. It follows the League client: ready check and champ select take over the
 * whole screen when they happen; otherwise it's the Play / Runes / Settings tabs.
 */
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useBridge } from '@/bridge/BridgeProvider';
import { ChampSelectScreen } from '@/screens/ChampSelect';
import { HomeScreen, type Tab } from '@/screens/Home';
import { InGameScreen } from '@/screens/InGame';
import { LiveGameScreen } from '@/screens/live/LiveGame';
import { ReadyCheckScreen } from '@/screens/ReadyCheck';

const IN_GAME = new Set(['GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame']);

export default function Main() {
  const { bridge, state } = useBridge();
  const [tab, setTab] = useState<Tab>('play');

  if (bridge === undefined) return null; // still reading storage
  if (bridge === null) return <Redirect href="/pair" />;

  if (state?.readyCheck && state.readyCheck.state === 'InProgress') return <ReadyCheckScreen readyCheck={state.readyCheck} queueName={state.queue?.name} />;
  if (state?.champSelect) return <ChampSelectScreen cs={state.champSelect} />;
  // The live broadcast as soon as the game's own API answers; a calm card while it loads.
  if (state?.game) return <LiveGameScreen game={state.game} />;
  if (state && IN_GAME.has(state.phase)) return <InGameScreen phase={state.phase} />;
  return <HomeScreen tab={tab} onTab={setTab} />;
}
