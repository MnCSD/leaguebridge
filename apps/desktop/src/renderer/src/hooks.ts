import { useEffect, useState } from 'react';
import type { BridgeApi, UiSnapshot } from '../../shared';

declare global {
  interface Window {
    /** Exposed by the preload script; the only way the window talks to the bridge. */
    bridgeApi: BridgeApi;
  }
}

export const api = window.bridgeApi;

/** The latest snapshot from the main process (null until the first one arrives). */
export function useSnapshot(): UiSnapshot | null {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  useEffect(() => {
    api.onSnapshot(setSnap);
    void api.getSnapshot().then(setSnap);
  }, []);
  return snap;
}

/** Re-renders every `ms` so timers tick between snapshots. */
export function useNow(ms = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
