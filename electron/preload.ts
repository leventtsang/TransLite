import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { QueueEvent, QueueItem, TransLiteApi } from '../src/shared/types';

const api: TransLiteApi = {
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
  selectVideos: () => ipcRenderer.invoke('videos:select'),
  pathsFromDroppedFiles: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  probeVideos: (paths) => ipcRenderer.invoke('videos:probe', paths),
  startQueue: (items: QueueItem[]) => ipcRenderer.invoke('queue:start', items),
  cancelJob: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),
  retryJob: (jobId) => ipcRenderer.invoke('queue:retry', jobId),
  removeJob: (jobId) => ipcRenderer.invoke('queue:remove', jobId),
  openOutput: (path) => ipcRenderer.invoke('file:open', path),
  showInFolder: (path) => ipcRenderer.invoke('file:show', path),
  onQueueEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: QueueEvent) => callback(payload);
    ipcRenderer.on('queue:event', listener);
    return () => ipcRenderer.removeListener('queue:event', listener);
  },
};

contextBridge.exposeInMainWorld('translite', api);
