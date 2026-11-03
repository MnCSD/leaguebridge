import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * Three builds: main process (Node), preload (bridge between the two), renderer (the window, React).
 *
 * Everything is bundled into out/ (externalizeDeps: false), including our own workspace packages
 * and third-party ones like ws, pino and qrcode. The installed app then needs no node_modules,
 * which keeps the installer small and simple. ws's optional native speed-ups stay external:
 * they aren't installed, and ws works without them.
 */
const bundleAll = {
  externalizeDeps: false,
  rollupOptions: { external: ['bufferutil', 'utf-8-validate'] },
};

export default defineConfig({
  main: { build: bundleAll },
  preload: { build: bundleAll },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
