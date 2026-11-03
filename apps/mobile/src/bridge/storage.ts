/**
 * The paired PC, kept in the OS keychain / keystore. The token is the only secret: the bridge
 * stores just its hash, so losing it means pairing again.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SavedBridge {
  host: string;
  port: number;
  bridgeId: string;
  bridgeName: string;
  deviceId: string;
  token: string;
}

const KEY = 'league-remote.bridge.v1';

// SecureStore has no web version; the web build (a dev preview only) uses localStorage.
const store =
  Platform.OS === 'web'
    ? {
        get: async () => localStorage.getItem(KEY),
        set: async (v: string) => localStorage.setItem(KEY, v),
        remove: async () => localStorage.removeItem(KEY),
      }
    : {
        get: () => SecureStore.getItemAsync(KEY),
        set: (v: string) => SecureStore.setItemAsync(KEY, v),
        remove: () => SecureStore.deleteItemAsync(KEY),
      };

export async function loadBridge(): Promise<SavedBridge | null> {
  try {
    const raw = await store.get();
    return raw ? (JSON.parse(raw) as SavedBridge) : null;
  } catch {
    return null;
  }
}

export const saveBridge = (bridge: SavedBridge) => store.set(JSON.stringify(bridge));
export const forgetBridge = () => store.remove();
