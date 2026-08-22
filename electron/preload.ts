import { contextBridge, ipcRenderer } from 'electron';
import type { BlurayApi, BlurayQueueEvent, BlurayTitle, BlurayTranscodeSettings } from '../src/shared/blurayTypes';

const api: BlurayApi = {
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
  selectBdmvFolder: () => ipcRenderer.invoke('bd:select-folder'),
  selectSubtitleFiles: () => ipcRenderer.invoke('bd:select-subtitles'),
  analyzeBdmv: (path) => ipcRenderer.invoke('bd:analyze', path),
  recommend: (title: BlurayTitle) => ipcRenderer.invoke('bd:recommend', title),
  chooseOutputPath: (defaultName) => ipcRenderer.invoke('bd:output', defaultName),
  startTranscode: (title: BlurayTitle, settings: BlurayTranscodeSettings) => ipcRenderer.invoke('bd:start', title, settings),
  cancelTranscode: () => ipcRenderer.invoke('bd:cancel'),
  openOutput: (path) => ipcRenderer.invoke('file:open', path),
  showInFolder: (path) => ipcRenderer.invoke('file:show', path),
  onQueueEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BlurayQueueEvent) => callback(payload);
    ipcRenderer.on('bd:event', listener);
    return () => ipcRenderer.removeListener('bd:event', listener);
  },
};
contextBridge.exposeInMainWorld('bluray', api);
