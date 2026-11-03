import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_PORT } from '@league-remote/protocol';
import { DEFAULT_AUTO_ACCEPT, type AutoAcceptSettings } from '../gameflow/autoAccept';

export interface PairedDevice {
  id: string;
  name: string;
  /** sha256 of the device token. The token itself is never stored. */
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface BridgeConfig {
  /** Random, stable id of this PC's bridge; the phone uses it to recognise "its" PC. */
  bridgeId: string;
  port: number;
  /** Reject phones connecting from public IP addresses. */
  localNetworkOnly: boolean;
  autoAccept: AutoAcceptSettings;
  devices: PairedDevice[];
}

/** %APPDATA%\LeagueRemote\config.json on Windows, ~/.config/league-remote/config.json elsewhere. */
export function defaultConfigPath() {
  const base = process.env.APPDATA ?? join(homedir(), '.config');
  return join(base, process.platform === 'win32' ? 'LeagueRemote' : 'league-remote', 'config.json');
}

function defaults(): BridgeConfig {
  return { bridgeId: randomUUID(), port: DEFAULT_PORT, localNetworkOnly: true, autoAccept: { ...DEFAULT_AUTO_ACCEPT }, devices: [] };
}

/**
 * Loads and saves the bridge's settings and paired devices.
 * Saves are atomic (write a temp file, then rename), so a crash mid-save can't corrupt it.
 */
export class ConfigStore {
  private data: BridgeConfig;

  constructor(readonly path = defaultConfigPath()) {
    this.data = this.load();
  }

  get(): Readonly<BridgeConfig> {
    return this.data;
  }

  update(change: (c: BridgeConfig) => void) {
    change(this.data);
    this.save();
  }

  private load(): BridgeConfig {
    let raw: Partial<BridgeConfig> = {};
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Can't read ${this.path}: ${(err as Error).message}`);
    }
    const d = defaults();
    const config: BridgeConfig = {
      ...d,
      ...raw,
      autoAccept: { ...d.autoAccept, ...raw.autoAccept },
      devices: Array.isArray(raw.devices) ? raw.devices : [],
    };
    if (JSON.stringify(config) !== JSON.stringify(raw)) {
      this.data = config;
      this.save(); // first run, or new settings added: write the filled-in file
    }
    return config;
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }
}
