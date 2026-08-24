import { app, powerSaveBlocker } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBlurayFfmpegArgs } from '../src/shared/blurayArgs';
import { ticksBetween } from '../src/shared/mpls';
import type { BlurayProgress, BlurayTitle, BlurayTranscodeSettings } from '../src/shared/blurayTypes';
import { binaryPath } from './bluray';

export class BlurayQueue {
  private child?: ChildProcessWithoutNullStreams;
  private cancelled = false;
  private blocker?: number;

  constructor(private readonly emit: (progress: BlurayProgress) => void) {}
  get isRunning(): boolean { return Boolean(this.child); }

  async start(title: BlurayTitle, settings: BlurayTranscodeSettings): Promise<void> {
    if (this.child) throw new Error('已有蓝光任务正在转码。');
    if (title.suspiciousLoop || !Number.isFinite(title.durationSeconds) || title.durationSeconds <= 0 || title.durationSeconds > 86_400) {
      throw new Error('该播放列表被识别为循环或异常时长，不能开始转码。请选择正常标题。');
    }
    this.cancelled = false;
    const work = await mkdtemp(join(tmpdir(), 'translite-bd-'));
    const partial = join(dirname(settings.outputPath), `.${Date.now()}-${app.getName()}-partial.mkv`);
    const concatPath = join(work, 'playlist.txt');
    const chaptersPath = title.chaptersSeconds.length ? join(work, 'chapters.txt') : undefined;
    await writeFile(concatPath, title.clips.flatMap((clip) => [
      `file '${escapeConcat(clip.path)}'`,
      `inpoint ${(clip.inTicks / 45_000).toFixed(6)}`,
      `outpoint ${((clip.inTicks + ticksBetween(clip.inTicks, clip.outTicks)) / 45_000).toFixed(6)}`,
    ]).join('\n'), 'utf8');
    if (chaptersPath) await writeFile(chaptersPath, chapters(title), 'utf8');
    const args = buildBlurayFfmpegArgs(title, settings, { concatPath, chaptersPath, temporaryOutputPath: partial });
    this.blocker = powerSaveBlocker.start('prevent-app-suspension');
    this.emit({ status: 'running', progress: 0, stage: '正在进行收藏级转码' });
    try {
      await this.run(title, args);
      if (this.cancelled) throw new CancelledError();
      await rename(partial, settings.outputPath);
      this.emit({ status: 'completed', progress: 1, stage: '转码完成', outputPath: settings.outputPath });
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      if (error instanceof CancelledError || this.cancelled) {
        this.emit({ status: 'cancelled', progress: 0, stage: '已取消' });
      } else {
        const message = friendlyError(error);
        this.emit({ status: 'failed', progress: 0, stage: '转码失败', error: message.user, technicalLog: message.log });
      }
    } finally {
      this.child = undefined;
      if (this.blocker !== undefined && powerSaveBlocker.isStarted(this.blocker)) powerSaveBlocker.stop(this.blocker);
      this.blocker = undefined;
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cancel(): Promise<void> {
    if (!this.child) return;
    this.cancelled = true;
    this.child.stdin.write('q\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.child?.kill('SIGTERM'); resolve(); }, 3000);
      this.child?.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  async shutdown(): Promise<void> { await this.cancel(); }

  private run(title: BlurayTitle, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath('ffmpeg'), args, { shell: false, windowsHide: true });
      this.child = child;
      let progressBuffer = ''; let stderr = ''; let speedAverage: number | undefined; let stableSamples = 0;
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/); progressBuffer = lines.pop() ?? '';
        let seconds: number | undefined; let speed: number | undefined;
        for (const line of lines) {
          const [key, value] = line.split('=', 2);
          if (key === 'out_time_us') seconds = Number(value) / 1_000_000;
          if (key === 'out_time_ms' && seconds === undefined) seconds = Number(value) / 1_000_000;
          if (key === 'speed') speed = Number(value.replace('x', ''));
        }
        if (speed && Number.isFinite(speed) && speed >= 0.001 && speed <= 100) {
          speedAverage = speedAverage === undefined ? speed : speedAverage * 0.75 + speed * 0.25;
          stableSamples += 1;
        }
        if (seconds !== undefined) {
          const progress = Math.min(0.999, Math.max(0, seconds / title.durationSeconds));
          const etaSeconds = speedAverage && stableSamples >= 5 && seconds >= 30
            ? Math.max(0, (title.durationSeconds - seconds) / speedAverage) : undefined;
          this.emit({ status: 'running', progress, speed: speedAverage, etaSeconds, stage: '正在进行收藏级转码' });
        }
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-50_000); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg 退出码 ${code}`)));
    });
  }
}

class CancelledError extends Error {}

function escapeConcat(path: string): string { return path.replace(/'/g, "'\\''"); }

function chapters(title: BlurayTitle): string {
  const starts = [0, ...title.chaptersSeconds.filter((value) => value > 0 && value < title.durationSeconds)]
    .sort((a, b) => a - b).filter((value, index, all) => index === 0 || value - all[index - 1] > 0.1);
  return [';FFMETADATA1', ...starts.flatMap((start, index) => [
    '[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(start * 1000)}`,
    `END=${Math.round((starts[index + 1] ?? title.durationSeconds) * 1000)}`, `title=章节 ${String(index + 1).padStart(2, '0')}`,
  ])].join('\n');
}

function friendlyError(error: unknown): { user: string; log: string } {
  const log = error instanceof Error ? error.message : String(error);
  const lower = log.toLowerCase();
  if (/no space left|disk full/.test(lower)) return { user: '目标磁盘空间不足，请清理空间或更换输出位置。', log };
  if (/permission denied|access is denied/.test(lower)) return { user: '无法写入目标位置，请选择有写入权限的文件夹。', log };
  if (/unknown encoder|libx265/.test(lower)) return { user: '内置 FFmpeg 缺少 libx265 编码器，请更换完整构建。', log };
  return { user: 'FFmpeg 转码失败。可展开技术日志定位损坏片段或不支持的轨道。', log };
}
