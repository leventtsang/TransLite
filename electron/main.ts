import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { basename, extname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { BlurayTitle, BlurayTranscodeSettings } from '../src/shared/blurayTypes';
import { analyzeBdmv, recommendationFor, verifyBlurayBinaries } from './bluray';
import { BlurayQueue } from './blurayQueue';

let mainWindow: BrowserWindow | null = null;
let allowClose = false;
let startupError: string | undefined;
const queue = new BlurayQueue((progress) => mainWindow?.webContents.send('bd:event', { type: 'progress', progress }));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 980, minHeight: 680,
    backgroundColor: '#0c1118', title: 'TransLite Blu-ray 收藏级转码',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.on('close', (event) => {
    if (!queue.isRunning || allowClose) return;
    event.preventDefault();
    void dialog.showMessageBox(mainWindow!, {
      type: 'warning', title: '转码尚未完成', message: '确定退出并取消当前蓝光转码吗？',
      detail: '未完成的临时 MKV 会被删除。', buttons: ['继续转码', '退出'], defaultId: 0, cancelId: 0,
    }).then(async ({ response }) => { if (response === 1) { await queue.shutdown(); allowClose = true; app.quit(); } });
  });
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) void mainWindow.loadURL(url); else void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
}

function assertPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 32_768) throw new Error('路径无效');
}

function assertJob(title: unknown, settings: unknown): asserts title is BlurayTitle {
  if (!title || typeof title !== 'object' || !settings || typeof settings !== 'object') throw new Error('转码任务无效');
  const t = title as Partial<BlurayTitle>; const s = settings as Partial<BlurayTranscodeSettings>;
  if (!Array.isArray(t.clips) || !t.clips.length || !t.video || !Array.isArray(s.audioStreamIndexes)
    || !Array.isArray(s.subtitleStreamIndexes) || !Array.isArray(s.externalSubtitles)
    || !['hevc', 'copy'].includes(s.videoCodec ?? '') || typeof s.outputPath !== 'string' || extname(s.outputPath).toLowerCase() !== '.mkv') {
    throw new Error('转码参数无效');
  }
}

function registerIpc(): void {
  ipcMain.handle('system:status', () => ({ ready: !startupError, error: startupError }));
  ipcMain.handle('bd:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择蓝光原盘文件夹或 BDMV 文件夹', properties: ['openDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle('bd:select-subtitles', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '添加外部字幕', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字幕文件', extensions: ['srt', 'ass', 'ssa', 'sup'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('bd:analyze', async (_event, path: unknown) => { assertPath(path); if (startupError) throw new Error(startupError); return analyzeBdmv(path); });
  ipcMain.handle('bd:recommend', (_event, title: BlurayTitle) => recommendationFor(title));
  ipcMain.handle('bd:output', async (_event, defaultName: unknown) => {
    const safe = typeof defaultName === 'string' ? basename(defaultName).replace(/[<>:"/\\|?*]/g, '_') : 'Blu-ray_收藏版.mkv';
    const result = await dialog.showSaveDialog(mainWindow!, { title: '保存收藏版 MKV', defaultPath: safe.endsWith('.mkv') ? safe : `${safe}.mkv`, filters: [{ name: 'Matroska 视频', extensions: ['mkv'] }] });
    return result.canceled ? undefined : result.filePath;
  });
  ipcMain.handle('bd:start', async (_event, title: unknown, settings: unknown) => { assertJob(title, settings); await queue.start(title, settings as BlurayTranscodeSettings); });
  ipcMain.handle('bd:cancel', () => queue.cancel());
  ipcMain.handle('file:open', async (_event, path: unknown) => { assertPath(path); await stat(path); return shell.openPath(path); });
  ipcMain.handle('file:show', async (_event, path: unknown) => { assertPath(path); await stat(path); shell.showItemInFolder(path); });
}

app.whenReady().then(async () => {
  registerIpc();
  try { await verifyBlurayBinaries(); } catch (error) { startupError = `初始化失败：${error instanceof Error ? error.message : String(error)}`; }
  createWindow();
});
app.on('window-all-closed', () => app.quit());
