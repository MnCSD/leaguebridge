/**
 * App-wide connection to the paired PC: the saved bridge, the live BridgeState, and send().
 * Screens read it with useBridge(); commands show their error in a banner via useCommand().
 */
import type { BridgeState } from '@league-remote/protocol';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { BridgeClient, CommandFailed, pair, type CommandInput, type ConnectionStatus } from './client';
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
}

const BridgeContext = createContext<BridgeContextValue | null>(null);

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<SavedBridge | null | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [state, setState] = useState<BridgeState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const client = useRef<BridgeClient | null>(null);

  useEffect(() => {
    loadBridge().then(setBridge);
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
      welcome: () => setLastError(null),
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
  }, [bridge]);

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
    () => ({ bridge, status, state, clockOffset, pairWith, unpair, send, lastError, clearError: () => setLastError(null) }),
    [bridge, status, state, clockOffset, pairWith, unpair, send, lastError],
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
