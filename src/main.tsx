import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (!window.bluray) {
  window.bluray = {
    getSystemStatus: async () => ({ ready: false, error: '请从 Windows Electron 应用启动，不要直接打开 index.html。' }),
    selectBdmvFolder: async () => undefined, selectSubtitleFiles: async () => [],
    analyzeBdmv: async () => { throw new Error('桌面接口不可用'); }, recommend: async () => { throw new Error('桌面接口不可用'); },
    chooseOutputPath: async () => undefined, startTranscode: async () => { throw new Error('桌面接口不可用'); },
    cancelTranscode: async () => undefined, openOutput: async () => '', showInFolder: async () => undefined, onQueueEvent: () => () => undefined,
  };
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
