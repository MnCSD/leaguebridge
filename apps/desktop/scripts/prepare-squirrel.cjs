/**
 * Gives Squirrel's Update.exe our icon and name.
 *
 * While installing (and when updating), the process running is Squirrel's own Update.exe, which
 * ships with a blank placeholder icon; that's what showed on the taskbar under the splash.
 * electron-builder lets us supply our own copy of Squirrel's files (customSquirrelVendorDir), so:
 *   1. assemble the same vendor folder electron-builder would use (electron-winstaller's vendor,
 *      overlaid with the patched Squirrel build from electron-builder's download cache)
 *   2. stamp resources/icon.ico + "League Remote" onto Squirrel.exe (it becomes Update.exe)
 *      with rcedit, which ships in that same vendor folder
 * Output: build/squirrel-vendor (ignored by git). Runs automatically as part of `npm run dist`.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build', 'squirrel-vendor');
const icon = path.join(root, 'resources', 'icon.ico');

const winstallerVendor = path.join(path.dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
const cacheRoot = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache', 'squirrel.windows@1.0.0');

function patchedVendor() {
  if (!fs.existsSync(cacheRoot)) return null;
  const dir = fs.readdirSync(cacheRoot).find((d) => d.startsWith('squirrel.windows-2.0.1-patched'));
  const vendor = dir && path.join(cacheRoot, dir, 'electron-winstaller', 'vendor');
  return vendor && fs.existsSync(vendor) ? vendor : null;
}

const patched = patchedVendor();
if (!patched) {
  // First build on this machine: electron-builder hasn't downloaded Squirrel yet. Build once
  // without the custom folder (placeholder icon), then this step works from the next build on.
  console.warn('prepare-squirrel: Squirrel download not cached yet; Update.exe keeps its default icon this time.');
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(0);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(winstallerVendor, out, { recursive: true });
fs.cpSync(patched, out, { recursive: true });

const squirrelExe = path.join(out, 'Squirrel.exe');
execFileSync(path.join(out, 'rcedit.exe'), [
  squirrelExe,
  '--set-icon', icon,
  '--set-version-string', 'FileDescription', 'League Remote',
  '--set-version-string', 'ProductName', 'League Remote',
]);
console.log(`prepare-squirrel: Update.exe will use ${path.relative(root, icon)} (${path.relative(root, out)})`);
