/**
 * App-wide connection to the paired PC: the saved bridge, the live BridgeState, and send().
 * Screens read it with useBridge(); commands show their error in a banner via useCommand().
 */
import type { BridgeState } from '@league-remote/protocol';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { BridgeClient, CommandFailed, pair, type CommandInput, type ConnectionStatus } from './client';
import { PushSetupError, getPushToken, loadPushPreference, savePushPreference } from './notifications';
import { forgetBridge, loadBridge, saveBridge, type SavedBridge } from './storage';

interface BridgeContextValue {
  /** undefined while loading from storage, null when not paired. */
  bridge: SavedBridge | null | undefined;
  status: ConnectionStatus;
  state: BridgeState | null;
  /** Add to Date.now() to get the bridge's clock (for countdowns). */
  clockOffset: number;
  pairWith(target: { host: string; port: number }, code: string): Promise<void>;
  unpair(): Promise<void>;
  send(command: CommandInput): Promise<void>;
  /** Last command error, shown as a banner. */
  lastError: string | null;
  clearError(): void;
  /** Push notifications (match found, your turn) for this phone. */
  push: { enabled: boolean; problem: string | null; busy: boolean };
  setPushEnabled(on: boolean): Promise<void>;
}

const BridgeContext = createContext<BridgeContextValue | null>(null);

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<SavedBridge | null | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [state, setState] = useState<BridgeState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [push, setPush] = useState<BridgeContextValue['push']>({ enabled: false, problem: null, busy: false });
  const pushWanted = useRef(false);
  const client = useRef<BridgeClient | null>(null);

  useEffect(() => {
    loadBridge().then(setBridge);
    loadPushPreference().then((on) => {
      pushWanted.current = on;
      setPush((p) => ({ ...p, enabled: on }));
    });
  }, []);

  /** Gives the bridge this phone's push token (or null to stop). Errors go to push.problem. */
  const syncPush = useCallback(async (askPermission: boolean) => {
    const c = client.current;
    if (!c) return;
    try {
      const token = pushWanted.current ? await getPushToken(askPermission) : null;
      await c.send({ type: 'registerPush', token });
      setPush((p) => ({ ...p, problem: null }));
    } catch (err) {
      setPush((p) => ({ ...p, problem: err instanceof PushSetupError || err instanceof CommandFailed ? err.message : `Notifications failed: ${(err as Error).message}` }));
    }
  }, []);

  // One client per paired bridge.
  useEffect(() => {
    if (!bridge) return;
    const c = new BridgeClient(bridge, {
      status: setStatus,
      state: (s, offset) => {
        setState(s);
        setClockOffset(offset);
      },
      welcome: () => {
        setLastError(null);
        // Sync on every connection: the token can change, and a switch flipped while offline
        // (on or off) must still reach the PC.
        void syncPush(false);
      },
    });
    client.current = c;
    c.connect();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && c.wake());
    return () => {
      sub.remove();
      c.stop();
      client.current = null;
      setState(null);
    };
  }, [bridge, syncPush]);

  const setPushEnabled = useCallback(
    async (on: boolean) => {
      pushWanted.current = on;
      setPush((p) => ({ ...p, enabled: on, busy: true, problem: null }));
      await savePushPreference(on);
      await syncPush(true);
      setPush((p) => ({ ...p, busy: false }));
    },
    [syncPush],
  );

  const pairWith = useCallback(async (target: { host: string; port: number }, code: string) => {
    const name = Device.deviceName ?? Device.modelName ?? 'Phone';
    const creds = await pair(target, code, name);
    const saved: SavedBridge = { ...target, ...creds };
    await saveBridge(saved);
    setBridge(saved);
  }, []);

  const unpair = useCallback(async () => {
    await forgetBridge();
    setBridge(null);
    setStatus('offline');
  }, []);

  const send = useCallback(async (command: CommandInput) => {
    try {
      await (client.current?.send(command) ?? Promise.reject(new CommandFailed('OFFLINE', 'Not connected to your PC')));
      setLastError(null);
    } catch (err) {
      setLastError((err as Error).message);
      throw err;
    }
  }, []);

  const value = useMemo<BridgeContextValue>(
    () => ({ bridge, status, state, clockOffset, pairWith, unpair, send, lastError, clearError: () => setLastError(null), push, setPushEnabled }),
    [bridge, status, state, clockOffset, pairWith, unpair, send, lastError, push, setPushEnabled],
  );
  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge() {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used inside BridgeProvider');
  return ctx;
}

/** Sends a command; errors already go to the banner, so callers can ignore the rejection. */
export function useSend() {
  const { send } = useBridge();
  return useCallback((command: CommandInput) => send(command).catch(() => {}), [send]);
}

/** Milliseconds left until `endsAt` (bridge clock), ticking every 250ms. null if no deadline. */
export function useRemaining(endsAt: number | null | undefined) {
  const { clockOffset } = useBridge();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  if (endsAt == null) return null;
  return Math.max(0, endsAt - (now + clockOffset));
}

/** Milliseconds since `startedAt` (bridge clock), ticking every second. */
export function useElapsed(startedAt: number | null | undefined) {
  const { clockOffset } = useBridge();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (startedAt == null) return 0;
  return Math.max(0, now + clockOffset - startedAt);
}
