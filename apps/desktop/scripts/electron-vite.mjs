// Runs electron-vite with ELECTRON_RUN_AS_NODE removed.
// Some tools (VS Code among them) set ELECTRON_RUN_AS_NODE=1 for processes they start; Electron
// then behaves like plain Node.js and the app crashes with "Cannot read properties of undefined
// (reading 'isPackaged')". Clearing it here makes `npm run desktop` work from any terminal.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
// The package doesn't export its bin file, so find it next to the package's main entry (dist/).
const bin = join(dirname(createRequire(import.meta.url).resolve('electron-vite')), '..', 'bin', 'electron-vite.js');
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
