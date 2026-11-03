import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * Three builds: main process (Node), preload (bridge between the two), renderer (the window, React).
 *
 * `externalizeDeps`: third-party packages in package.json "dependencies" stay out of the bundle
 * and load from node_modules at runtime (pino, ws... don't like being bundled). Our own workspace
 * packages are TypeScript source, so they ARE bundled (excluded from externalizing).
 */
const ours = ['@league-remote/bridge-core', '@league-remote/protocol'];

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: ours } },
  },
  preload: {
    build: { externalizeDeps: { exclude: ours } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
