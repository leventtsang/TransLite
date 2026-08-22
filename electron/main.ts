import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { QueueEvent, QueueItem } from '../src/shared/types';
import { validateAdvancedSettings } from '../src/shared/advanced';
import { probeVideo, verifyBinaries } from './ffmpeg';
import { TranscodeQueue } from './queue';

let mainWindow: BrowserWindow | null = null;
let allowClose = false;
let startupError: string | undefined;

const queue = new TranscodeQueue((event: QueueEvent) => {
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('queue:event', event);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f7f6f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 27 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('close', (event) => {
    if (!queue.isRunning || allowClose) return;
    event.preventDefault();
    void dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: '压缩尚未完成',
      message: '正在压缩视频，确定要退出吗？',
      detail: '退出会取消当前任务，未完成的临时文件将被清理。',
      buttons: ['继续压缩', '退出'],
      defaultId: 0,
      cancelId: 0,
    }).then(async ({ response }) => {
      if (response === 1) {
        await queue.shutdown();
        allowClose = true;
        app.quit();
      }
    });
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 200 && value.every((item) => typeof item === 'string' && item.length > 0);
}

function assertQueueItems(value: unknown): asserts value is QueueItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Error('任务列表无效');
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('任务参数无效');
    const candidate = item as Partial<QueueItem>;
    const settings = candidate.settings;
    const metadata = candidate.metadata;
    const validMetadata = typeof metadata?.path === 'string'
      && metadata.path.length > 0
      && metadata.path.length <= 32_768
      && finiteBetween(metadata.durationSeconds, 0.001, 31_536_000)
      && finiteBetween(metadata.width, 2, 8192)
      && finiteBetween(metadata.height, 2, 8192)
      && finiteBetween(metadata.fps, 0.001, 1000)
      && finiteBetween(metadata.videoBitrate, 1, 1_000_000_000);
    const validSettings = settings?.mode === 'simple'
      ? ['quality', 'balanced', 'small'].includes(settings.preset?.id)
        && finiteBetween(settings.preset.width, 2, 8192)
        && finiteBetween(settings.preset.height, 2, 8192)
        && finiteBetween(settings.preset.fps, 0.001, 120)
        && finiteBetween(settings.preset.videoBitrate, 1, 200_000_000)
      : settings?.mode === 'advanced'
        && ['h264', 'h265'].includes(settings.codec)
        && validMetadata
        && validateAdvancedSettings(metadata, settings).length === 0;
    if (typeof candidate.id !== 'string' || !validMetadata || !validSettings) {
      throw new Error('任务参数无效');
    }
  }
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function assertPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32_768) throw new Error('文件路径无效');
}

function registerIpc(): void {
  ipcMain.handle('system:status', () => ({ ready: !startupError, error: startupError }));
  ipcMain.handle('videos:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择要压缩的视频',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('videos:probe', async (_event, paths: unknown) => {
    if (!isStringArray(paths)) throw new Error('文件列表无效');
    if (startupError) throw new Error(startupError);
    return Promise.all(paths.map(probeVideo));
  });
  ipcMain.handle('queue:start', (_event, items: unknown) => {
    assertQueueItems(items);
    if (startupError) throw new Error(startupError);
    queue.start(items);
  });
  ipcMain.handle('queue:cancel', async (_event, jobId: unknown) => {
    assertPath(jobId);
    await queue.cancel(jobId);
  });
  ipcMain.handle('queue:retry', (_event, jobId: unknown) => {
    assertPath(jobId);
    queue.retry(jobId);
  });
  ipcMain.handle('queue:remove', (_event, jobId: unknown) => {
    assertPath(jobId);
    queue.remove(jobId);
  });
  ipcMain.handle('file:open', async (_event, path: unknown) => {
    assertPath(path);
    await stat(path);
    return shell.openPath(path);
  });
  ipcMain.handle('file:show', async (_event, path: unknown) => {
    assertPath(path);
    await stat(path);
    shell.showItemInFolder(path);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  try {
    await verifyBinaries();
  } catch (error) {
    startupError = `FFmpeg 初始化失败：${error instanceof Error ? error.message : String(error)}`;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
