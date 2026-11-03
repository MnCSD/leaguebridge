import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** What we need to talk to the League client. `password` is a secret: never log it. */
export interface LcuCredentials {
  port: number;
  password: string;
  pid: number | null;
  source: 'lockfile' | 'process';
}

export const DEFAULT_LEAGUE_PATH =
  process.platform === 'darwin'
    ? '/Applications/League of Legends.app/Contents/LoL'
    : 'C:\\Riot Games\\League of Legends';

/**
 * Lockfile format: `name:pid:port:password:protocol`, e.g.
 * `LeagueClient:12345:54321:abcDEF123:https`
 */
export function parseLockfile(text: string): LcuCredentials {
  const parts = text.trim().split(':');
  if (parts.length !== 5) {
    throw new Error(`Unexpected lockfile format: expected 5 fields, got ${parts.length}`);
  }
  const [, pidStr, portStr, password, protocol] = parts as [string, string, string, string, string];
  const port = Number(portStr);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Lockfile has an invalid port');
  }
  if (!password) throw new Error('Lockfile has an empty password');
  if (protocol !== 'https') throw new Error(`Unexpected lockfile protocol "${protocol}"`);
  const pid = Number(pidStr);
  return { port, password, pid: Number.isInteger(pid) ? pid : null, source: 'lockfile' };
}

/** Returns null if the lockfile doesn't exist (= client not running). Throws on a malformed file. */
export async function readLockfile(leaguePath: string): Promise<LcuCredentials | null> {
  let text: string;
  try {
    text = await readFile(join(leaguePath, 'lockfile'), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT: not running. EBUSY/EPERM: Windows sometimes locks it briefly during startup.
    if (code === 'ENOENT' || code === 'EBUSY' || code === 'EPERM') return null;
    throw err;
  }
  return parseLockfile(text);
}

/** Pulls `--app-port` and `--remoting-auth-token` out of a LeagueClientUx command line. */
export function parseCommandLine(cmd: string): LcuCredentials | null {
  const port = /--app-port=(\d+)/.exec(cmd)?.[1];
  const token = /--remoting-auth-token=([^\s"]+)/.exec(cmd)?.[1];
  if (!port || !token) return null;
  return { port: Number(port), password: token, pid: null, source: 'process' };
}

/**
 * Fallback for non-default install paths: read the running LeagueClientUx process's command line.
 * Windows: PowerShell + CIM (wmic is removed on recent Windows 11 builds). macOS: ps.
 * The output contains the password, so it is parsed here and never logged.
 */
export function readFromProcess(): Promise<LcuCredentials | null> {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === 'win32'
        ? [
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" | Select-Object -ExpandProperty CommandLine`,
            ],
          ]
        : ['ps', ['-A', '-o', 'args']];

    execFile(cmd, args as string[], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.split(/\r?\n/).find((l) => l.includes('--remoting-auth-token='));
      resolve(line ? parseCommandLine(line) : null);
    });
  });
}
