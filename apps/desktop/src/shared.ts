/**
 * What the window shows, computed in the main process and sent to the window.
 * Plain data only: the window never talks to the bridge directly.
 */

export type Tone = 'on' | 'gold' | 'off';

export interface UiStatus {
  label: string;
  /** One line of context under the label, e.g. the queue name or "Your turn to ban". */
  detail: string;
  tone: Tone;
  /** Draw attention (pulse/glow), e.g. while a match is waiting to be accepted. */
  urgent: boolean;
  /**
   * A live timer: counts up from `at` (elapsed) or down to `at` (countdown).
   * `totalMs` (countdowns only) lets the ring show how much is left.
   */
  timer: { kind: 'elapsed' | 'countdown'; at: number; totalMs?: number } | null;
}

export interface UiDevice {
  id: string;
  name: string;
  pairedAt: string;
  connected: boolean;
}

export interface UiSettings {
  autoAccept: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  notifications: boolean;
  localNetworkOnly: boolean;
}
export type SettingKey = keyof UiSettings;

export interface UiSnapshot {
  version: string;
  leagueClient: boolean;
  phones: string[];
  status: UiStatus;
  pairing: {
    /** null = no valid code right now (used, expired or locked): the window offers "New code". */
    code: string | null;
    /** Why there's no code, e.g. "Phone paired". */
    note: string | null;
    qrDataUrl: string | null;
    host: string;
    /** All LAN addresses, so you can switch if the QR advertises the wrong one (hotspots, VPNs). */
    hosts: { address: string; adapter: string }[];
    port: number;
    expiresAt: number | null;
  };
  /** Set when the phone server couldn't start (e.g. port in use). */
  serverError: string | null;
  settings: UiSettings;
  devices: UiDevice[];
}

/** The API the preload script exposes to the window as `window.bridgeApi`. */
export interface BridgeApi {
  getSnapshot(): Promise<UiSnapshot>;
  onSnapshot(listener: (s: UiSnapshot) => void): void;
  setSetting(key: SettingKey, value: boolean): Promise<void>;
  removeDevice(id: string): Promise<void>;
  newPairingCode(): Promise<void>;
  nextHost(): Promise<void>;
  openLog(): Promise<void>;
  minimizeToTray(): Promise<void>;
  close(): Promise<void>;
}
