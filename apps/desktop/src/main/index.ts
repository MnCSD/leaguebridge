/**
 * Electron main process: runs the bridge (bridge-core) and the phone server, and owns the window
 * and tray icon. The window only displays a UiSnapshot and sends back a few button clicks.
 *
 * Command line (all optional):
 *   --league-path <dir>   League install folder (e.g. .fake-league with `npm run fake-lcu`)
 *   --mock <file>         Replay a recording instead of using League
 *   --hidden              Start in the tray (used by "Start with Windows")
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import {
  Bridge,
  ConfigStore,
  createLogger,
  DEFAULT_LEAGUE_PATH,
  defaultConfigPath,
  lanAddressList,
  PhoneServer,
} from '@league-remote/bridge-core';
import type { BridgeState, PairingInfo } from '@league-remote/protocol';
import QRCode from 'qrcode';
// `?asset` = electron-vite gives us file paths that work in dev and when built.
// Regenerate these from resources/*.svg with `npm run icons -w apps/desktop`.
import iconIco from '../../resources/icon.ico?asset';
import iconPng from '../../resources/icon.png?asset';
import trayPng from '../../resources/tray.png?asset';
import tray2xPng from '../../resources/tray@2x.png?asset';
import type { SettingKey, UiSnapshot, UiStatus } from '../shared';

// --- installer (Squirrel) events ------------------------------------------------------------
//
// The Squirrel installer runs the app once with a special flag on install/update/uninstall.
// We create or remove the Start Menu + desktop shortcuts (via Squirrel's Update.exe) and exit,
// without opening a window. The installed layout is:
//   %LOCALAPPDATA%\LeagueRemote\Update.exe
//   %LOCALAPPDATA%\LeagueRemote\app-0.1.0\LeagueRemote.exe   <- process.execPath

const isSquirrel = app.isPackaged && process.platform === 'win32';
const updateExe = join(dirname(process.execPath), '..', 'Update.exe');
const exeName = basename(process.execPath);

function handleSquirrelEvent(): boolean {
  const event = process.argv[1];
  if (!isSquirrel || !event?.startsWith('--squirrel-') || event === '--squirrel-firstrun') return false;
  const runUpdate = (updateArgs: string[]) => {
    // Quit once Update.exe has finished (or failed); Squirrel waits for us to exit.
    spawn(updateExe, updateArgs, { detached: true }).on('close', () => app.quit()).on('error', () => app.quit());
  };
  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate(['--createShortcut', exeName]);
      break;
    case '--squirrel-uninstall':
      app.setLoginItemSettings({ openAtLogin: false, path: updateExe, args: loginItemArgs() });
      runUpdate(['--removeShortcut', exeName]);
      break;
    default: // --squirrel-obsolete: an old version being replaced
      app.quit();
  }
  return true;
}

/** "Start with Windows" goes through Update.exe, so it keeps working after the app updates. */
function loginItemArgs() {
  return ['--processStart', `"${exeName}"`, '--process-start-args', '"--hidden"'];
}

const squirrelEvent = handleSquirrelEvent();

// --- paths & args ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  args: process.argv.slice(app.isPackaged ? 1 : 2),
  options: {
    'league-path': { type: 'string' },
    mock: { type: 'string' },
    hidden: { type: 'boolean', default: false },
    config: { type: 'string' },
    port: { type: 'string' },
    // Dev aid: save a PNG of the window's own page (never other windows) every 2 seconds.
    screenshot: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});

const configStore = new ConfigStore((args.config as string | undefined) ?? defaultConfigPath());
const dataDir = dirname(configStore.path); // %APPDATA%\LeagueRemote
// Keep Electron's own cache files in our folder too, not in a separate "League Remote" folder.
app.setPath('userData', join(dataDir, 'electron'));

const logFile = join(dataDir, 'logs', 'bridge.log');
mkdirSync(dirname(logFile), { recursive: true });
if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) renameSync(logFile, logFile.replace(/\.log$/, '.old.log'));
const log = createLogger('info', { file: logFile });

// --- desktop-only settings (the bridge's own settings live in config.json) ------------------

interface DesktopSettings {
  startWithWindows: boolean;
  minimizeToTray: boolean;
  notifications: boolean;
}
const desktopFile = join(dataDir, 'desktop.json');
const desktop: DesktopSettings = { startWithWindows: false, minimizeToTray: true, notifications: false };
try {
  Object.assign(desktop, JSON.parse(readFileSync(desktopFile, 'utf8')));
} catch {
  /* first run: defaults */
}
const saveDesktop = () => writeFileSync(desktopFile, JSON.stringify(desktop, null, 2));

// Windows only shows toast notifications for apps with an App User Model ID (AUMID); without one
// they're dropped silently. The toast's header ("League Remote" + icon) is looked up from that id:
//  - installed app: Squirrel's Start Menu shortcut carries the id "com.squirrel.<name>.<exe>"
//    and the name "League Remote", so the app must use exactly that id.
//  - dev: there's no shortcut, so register the name and icon for the id under the current user
//    (HKCU\Software\Classes\AppUserModelId\<id>, Windows' documented way for unpackaged apps).
//    Otherwise the header says "Electron".
const AUMID = isSquirrel ? `com.squirrel.LeagueRemote.${exeName.replace(/\.exe$/i, '')}` : 'com.leagueremote.bridge.dev';
if (process.platform === 'win32') {
  app.setAppUserModelId(AUMID);
  if (!app.isPackaged) registerDevToastIdentity();
}

function registerDevToastIdentity() {
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
  const set = (name: string, value: string) =>
    execFile('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, (err) => {
      if (err) log.warn({ err: err.message }, `Could not register ${name} for notifications`);
    });
  set('DisplayName', 'League Remote');
  set('IconUri', iconPng);
}

// Only one bridge at a time: a second launch just shows the existing window.
// (During an installer event we only manage shortcuts and exit; see handleSquirrelEvent.)
if (squirrelEvent) {
  // nothing else to start
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

// --- bridge + phone server ------------------------------------------------------------------

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let server: PhoneServer | null = null;
let serverError: string | null = null;
let hostIndex = 0;

const bridge = new Bridge({
  leaguePath: (args['league-path'] as string | undefined) ?? process.env.LEAGUE_PATH ?? DEFAULT_LEAGUE_PATH,
  log,
  autoAccept: configStore.get().autoAccept,
  mock: args.mock ? { file: args.mock as string, loop: true, maxGapMs: 3000 } : undefined,
  onStateChange: () => {
    server?.publishState();
    pushSnapshot();
  },
});

async function start() {
  log.info(`League Remote desktop ${app.getVersion()} starting`);
  Menu.setApplicationMenu(null);

  server = new PhoneServer({
    config: configStore,
    log,
    bridgeName: hostname(),
    port: args.port ? Number(args.port) : undefined,
    getState: () => bridge.state,
    handleCommand: (c) => bridge.handleCommand(c),
    fetchAsset: (p) => bridge.fetchAsset(p),
    onChange: () => {
      notifyNewConnections();
      pushSnapshot();
    },
  });
  try {
    await server.start();
    server.newPairingCode();
  } catch (err) {
    const port = args.port ?? configStore.get().port;
    const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    serverError = inUse
      ? `Port ${port} is in use. Is "npm run bridge" still running? Close it and restart this app.`
      : `Phone server could not start on port ${port}: ${(err as Error).message}`;
    log.error(serverError);
    server = null;
  }

  void bridge.start();
  createTray();
  createWindow();

  // An expired code is replaced automatically while the window is open. Used or locked codes
  // are not: you click "New code", so pairing only happens when you mean it to.
  setInterval(() => {
    if (server?.pairing.status() === 'expired' && win?.isVisible()) {
      server.newPairingCode();
    }
    pushSnapshot();
  }, 1000);
}

app.on('before-quit', () => {
  quitting = true;
  bridge.stop();
  void server?.stop();
});
// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => {});

// --- window ---------------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 880,
    height: 580,
    useContentSize: true, // 880x580 is the page size, not including any window frame
    resizable: false,
    maximizable: false,
    frame: false, // the design draws its own title bar
    show: false,
    backgroundColor: '#010A13',
    title: 'League Remote',
    // .ico holds 16-256 px versions, so Windows picks a sharp one for the taskbar and title.
    icon: process.platform === 'win32' ? iconIco : iconPng,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // `npm run desktop` (dev): load from Vite's dev server, so UI edits show up instantly.
  // Built app: load the bundled files.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => {
    if (!args.hidden) win?.show();
  });
  if (typeof args.screenshot === 'string' && !app.isPackaged) {
    const file = args.screenshot;
    setInterval(() => {
      void win?.webContents.capturePage().then((img) => writeFileSync(file, img.toPNG()));
    }, 2000);
  }
  // Alt+F4 / taskbar close behave like the window's own close button.
  win.on('close', (e) => {
    if (!quitting && desktop.minimizeToTray) {
      e.preventDefault();
      win?.hide();
    } else if (!quitting) {
      app.quit();
    }
  });
  // Links never open inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function showWindow() {
  if (!win) return;
  if (server?.pairing.status() === 'expired') server.newPairingCode();
  win.show();
  win.focus();
}

function createTray() {
  // 16 px artwork drawn for that size, plus a 32 px version for high-DPI screens.
  const trayIcon = nativeImage.createFromPath(trayPng);
  trayIcon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(tray2xPng) });
  tray = new Tray(trayIcon);
  tray.setToolTip('League Remote');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

// --- snapshot for the window ----------------------------------------------------------------

let lastSnapshotJson = '';
let qrCache = { text: '', dataUrl: '' };

async function buildSnapshot(): Promise<UiSnapshot> {
  const config = configStore.get();
  const hosts = lanAddressList();
  const host = hosts[hostIndex % Math.max(1, hosts.length)]?.address ?? '127.0.0.1';
  const pairing = server?.pairing;
  const current = pairing?.current() ?? null;
  const port = server?.listeningPort ?? config.port;

  let qrDataUrl: string | null = null;
  if (current) {
    const info: PairingInfo = { host, port, code: current.code, bridgeId: config.bridgeId };
    const text = JSON.stringify(info);
    if (qrCache.text !== text) {
      qrCache = { text, dataUrl: await QRCode.toDataURL(text, { margin: 0, width: 336, color: { dark: '#010A13', light: '#F0E6D2' } }) };
    }
    qrDataUrl = qrCache.dataUrl;
  }
  const status = pairing?.status();
  const note = !server
    ? 'Phone server is off'
    : status === 'used'
      ? 'Phone paired'
      : status === 'locked'
        ? 'Too many wrong codes'
        : status === 'expired'
          ? 'Code expired'
          : null;

  const online = server?.connectedDevices() ?? [];
  return {
    version: app.getVersion(),
    leagueClient: bridge.connected,
    phones: [...new Set(online.map((d) => d.name))],
    status: describeStatus(bridge.state),
    pairing: { code: current?.code ?? null, note, qrDataUrl, host, hosts, port, expiresAt: current?.expiresAt ?? null },
    serverError,
    settings: {
      autoAccept: config.autoAccept.enabled,
      startWithWindows: desktop.startWithWindows,
      minimizeToTray: desktop.minimizeToTray,
      notifications: desktop.notifications,
      localNetworkOnly: config.localNetworkOnly,
    },
    devices: config.devices.map((d) => ({
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      connected: online.some((o) => o.id === d.id),
    })),
  };
}

const CHAMP_SELECT_PHASES: Record<string, string> = {
  PLANNING: 'Planning',
  BAN_PICK: 'Bans & picks',
  FINALIZATION: 'Finalizing loadouts',
  GAME_STARTING: 'Game starting',
};

function describeStatus(s: BridgeState): UiStatus {
  const base = { urgent: false, timer: null } as const;
  if (s.client === 'disconnected') {
    return args.mock
      ? { ...base, label: 'Replay paused', detail: 'Mock mode: waiting for the recording', tone: 'off' }
      : { ...base, label: 'Waiting for League', detail: 'Start the League client; the bridge connects by itself', tone: 'off' };
  }
  const queue = s.queue?.name;
  switch (s.phase) {
    case 'None':
      return { ...base, label: 'Idle', detail: 'Connected to the League client', tone: 'off' };
    case 'Lobby':
      return { ...base, label: 'In Lobby', detail: queue ? `${queue} lobby` : 'Pick a game mode to get started', tone: 'gold' };
    case 'Matchmaking': {
      const est = s.matchmaking?.estimatedMs;
      const estText = est ? `estimated ${Math.floor(est / 60000)}:${String(Math.round(est / 1000) % 60).padStart(2, '0')}` : 'searching';
      return {
        ...base,
        label: 'In Queue',
        detail: `${queue ?? 'Matchmaking'} · ${estText}`,
        tone: 'gold',
        timer: s.matchmaking ? { kind: 'elapsed', at: s.matchmaking.startedAt } : null,
      };
    }
    case 'ReadyCheck':
      if (s.readyCheck?.response === 'Accepted') return { ...base, label: 'Accepted', detail: 'Waiting for the other players', tone: 'on' };
      if (s.readyCheck?.response === 'Declined') return { ...base, label: 'Declined', detail: 'Back to the lobby', tone: 'off' };
      return {
        label: 'Match Found',
        detail: configStore.get().autoAccept.enabled ? 'Accept now, or auto-accept steps in at the last moment' : 'Accept on your phone or in the client',
        tone: 'on',
        urgent: true,
        timer: s.readyCheck ? { kind: 'countdown', at: s.readyCheck.endsAt, totalMs: s.readyCheck.totalMs } : null,
      };
    case 'ChampSelect': {
      const cs = s.champSelect;
      const phase = cs ? (CHAMP_SELECT_PHASES[cs.phase] ?? cs.phase) : 'Champion select';
      const turn = cs?.myAction ? ` · your turn to ${cs.myAction.type}` : '';
      return {
        label: 'Champ Select',
        detail: `${phase}${turn}`,
        tone: cs?.myAction ? 'on' : 'gold',
        urgent: !!cs?.myAction,
        timer: cs?.timer.endsAt ? { kind: 'countdown', at: cs.timer.endsAt, totalMs: cs.timer.totalMs } : null,
      };
    }
    case 'GameStart':
      return { ...base, label: 'Loading In', detail: queue ?? 'The game is starting', tone: 'on' };
    case 'InProgress':
      return { ...base, label: 'In Game', detail: queue ? `${queue} · good luck` : 'Good luck, have fun', tone: 'on' };
    case 'Reconnect':
      return { ...base, label: 'Game Running', detail: 'Reconnect is available in the client', tone: 'gold' };
    case 'WaitingForStats':
    case 'PreEndOfGame':
    case 'EndOfGame':
      return { ...base, label: 'Game Over', detail: 'Waiting for the post-game screen', tone: 'off' };
    default:
      return { ...base, label: s.phase, detail: queue ?? '', tone: 'gold' };
  }
}

/** Sends the snapshot to the window, but only if something changed. */
function pushSnapshot() {
  void buildSnapshot().then((snap) => {
    const json = JSON.stringify(snap);
    if (json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    win?.webContents.send('snapshot', snap);
    tray?.setToolTip(`League Remote: ${snap.status.label}${snap.phones.length ? ` | ${snap.phones.join(', ')} connected` : ''}`);
  });
}

function toast(body: string) {
  if (!Notification.isSupported()) {
    log.warn('Desktop notifications are not supported on this system');
    return;
  }
  // Windows loads the icon from disk itself, so use the copy kept outside the app archive.
  const icon = iconPng.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
  const n = new Notification({ title: 'League Remote', body, icon });
  n.on('failed', (_e, error) => log.warn({ error }, 'Desktop notification failed'));
  n.show();
}

let knownOnline = new Set<string>();
function notifyNewConnections() {
  const devices = server?.connectedDevices() ?? [];
  if (desktop.notifications) {
    for (const d of devices) if (!knownOnline.has(d.id)) toast(`${d.name} connected`);
  }
  knownOnline = new Set(devices.map((d) => d.id));
}

// --- window -> main ---------------------------------------------------------------------------

ipcMain.handle('snapshot', () => buildSnapshot());

ipcMain.handle('setSetting', (_e, key: SettingKey, value: boolean) => {
  if (typeof value !== 'boolean') return;
  const apply: Record<SettingKey, () => void> = {
    autoAccept: () => {
      configStore.update((c) => (c.autoAccept.enabled = value));
      bridge.autoAccepter.updateSettings(configStore.get().autoAccept);
    },
    localNetworkOnly: () => configStore.update((c) => (c.localNetworkOnly = value)),
    startWithWindows: () => {
      desktop.startWithWindows = value;
      // Installed: start through Squirrel's Update.exe (survives updates, which change the exe's folder).
      // Development: "electron.exe" needs the app folder as an argument.
      app.setLoginItemSettings(
        isSquirrel
          ? { openAtLogin: value, path: updateExe, args: loginItemArgs() }
          : { openAtLogin: value, path: process.execPath, args: [app.getAppPath(), '--hidden'] },
      );
    },
    minimizeToTray: () => (desktop.minimizeToTray = value),
    notifications: () => {
      desktop.notifications = value;
      // Immediate feedback that toasts actually reach you (Focus Assist can hide them).
      if (value) toast("Notifications are on. You'll see one when your phone connects.");
    },
  };
  if (!(key in apply)) return;
  apply[key]();
  saveDesktop();
  log.info(`Setting ${key} = ${value}`);
  pushSnapshot();
});

ipcMain.handle('removeDevice', (_e, id: string) => {
  server?.removeDevice(String(id));
  pushSnapshot();
});

ipcMain.handle('newPairingCode', () => {
  server?.newPairingCode();
  pushSnapshot();
});

ipcMain.handle('nextHost', () => {
  hostIndex++;
  pushSnapshot();
});

ipcMain.handle('openLog', () => shell.openPath(logFile));
ipcMain.handle('minimizeToTray', () => win?.hide());
ipcMain.handle('close', () => win?.close()); // goes through the 'close' handler above
