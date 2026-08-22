import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (!window.translite) {
  window.translite = {
    getSystemStatus: async () => ({ ready: true }),
    selectVideos: async () => [],
    pathsFromDroppedFiles: () => [],
    probeVideos: async () => { throw new Error('请在 Electron 桌面应用中选择视频'); },
    startQueue: async () => { throw new Error('请在 Electron 桌面应用中启动压缩'); },
    cancelJob: async () => undefined,
    retryJob: async () => undefined,
    removeJob: async () => undefined,
    openOutput: async () => '',
    showInFolder: async () => undefined,
    onQueueEvent: () => () => undefined,
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
