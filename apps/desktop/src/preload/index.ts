/**
 * Runs before the window's page, with access to Electron's IPC. It exposes ONLY the small API
 * below to the page (`window.bridgeApi`); the page itself has no Node or Electron access.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeApi, UiSnapshot } from '../shared';

const api: BridgeApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  onSnapshot: (listener) => {
    ipcRenderer.on('snapshot', (_e, s: UiSnapshot) => listener(s));
  },
  setSetting: (key, value) => ipcRenderer.invoke('setSetting', key, value),
  removeDevice: (id) => ipcRenderer.invoke('removeDevice', id),
  newPairingCode: () => ipcRenderer.invoke('newPairingCode'),
  nextHost: () => ipcRenderer.invoke('nextHost'),
  openLog: () => ipcRenderer.invoke('openLog'),
  minimizeToTray: () => ipcRenderer.invoke('minimizeToTray'),
  close: () => ipcRenderer.invoke('close'),
};

contextBridge.exposeInMainWorld('bridgeApi', api);
