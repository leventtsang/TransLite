import { powerSaveBlocker } from 'electron';
import { statfs, access, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { JobProgress, QueueEvent, QueueItem } from '../src/shared/types';
import { calculateProgress, smoothSpeed } from '../src/shared/progress';
import { estimateAdvancedSize } from '../src/shared/advanced';
import { buildFfmpegArgs } from '../src/shared/ffmpegArgs';
import { binaryPath, mapFfmpegError, outputDirectory, sourceBaseName } from './ffmpeg';

type Emit = (event: QueueEvent) => void;

export class TranscodeQueue {
  private pending: QueueItem[] = [];
  private itemHistory = new Map<string, QueueItem>();
  private cancelled = new Set<string>();
  private current?: { item: QueueItem; child: ChildProcessWithoutNullStreams; temporaryPath: string };
  private running = false;
  private blockerId?: number;
  private completedDuration = 0;
  private totalDuration = 0;

  constructor(private readonly emit: Emit) {}

  get isRunning(): boolean { return this.running; }

  start(items: QueueItem[]): void {
    if (this.running) throw new Error('已有压缩队列正在运行');
    if (items.length === 0) return;
    this.pending = items.map((item) => structuredClone(item));
    items.forEach((item) => this.itemHistory.set(item.id, structuredClone(item)));
    this.cancelled.clear();
    this.completedDuration = 0;
    this.totalDuration = items.reduce((sum, item) => sum + item.metadata.durationSeconds, 0);
    this.running = true;
    this.blockerId = powerSaveBlocker.start('prevent-app-suspension');
    this.emit({ type: 'queue-started', totalJobs: items.length });
    void this.process();
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.add(jobId);
    this.pending = this.pending.filter((item) => item.id !== jobId);
    if (this.current?.item.id === jobId) {
      this.current.child.stdin.write('q\n');
      setTimeout(() => {
        if (this.current?.item.id === jobId && !this.current.child.killed) this.current.child.kill('SIGTERM');
      }, 3_000).unref();
    }
  }

  async shutdown(): Promise<void> {
    for (const item of this.pending) this.cancelled.add(item.id);
    this.pending = [];
    if (this.current) await this.cancel(this.current.item.id);
    if (!this.running) return;
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!this.running || Date.now() - started > 4_000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  remove(jobId: string): void {
    if (this.current?.item.id === jobId) throw new Error('压缩中的任务请先取消');
    this.pending = this.pending.filter((item) => item.id !== jobId);
    this.itemHistory.delete(jobId);
  }

  retry(jobId: string): void {
    if (this.running) throw new Error('请等待当前队列结束后再重试');
    const item = this.itemHistory.get(jobId);
    if (!item) throw new Error('找不到可重试的任务');
    this.start([item]);
  }

  private async process(): Promise<void> {
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        if (this.cancelled.has(item.id)) continue;
        await this.runOne(item);
        this.completedDuration += item.metadata.durationSeconds;
      }
    } finally {
      this.current = undefined;
      this.running = false;
      if (this.blockerId !== undefined && powerSaveBlocker.isStarted(this.blockerId)) {
        powerSaveBlocker.stop(this.blockerId);
      }
      this.blockerId = undefined;
      this.emit({ type: 'queue-finished' });
    }
  }

  private emitProgress(item: QueueItem, patch: Partial<JobProgress>): void {
    const progress = Math.min(1, Math.max(0, patch.progress ?? 0));
    const weighted = this.totalDuration > 0
      ? (this.completedDuration + progress * item.metadata.durationSeconds) / this.totalDuration
      : progress;
    this.emit({
      type: 'job-progress',
      progress: { jobId: item.id, status: 'running', progress, queueProgress: weighted, ...patch },
    });
  }

  private async runOne(item: QueueItem): Promise<void> {
    let temporaryPath = '';
    try {
      await access(item.metadata.path, constants.R_OK);
      const directory = outputDirectory(item.metadata.path);
      await access(directory, constants.W_OK);
      const disk = await statfs(directory);
      const available = disk.bavail * disk.bsize;
      const estimatedSize = item.settings.mode === 'simple'
        ? item.settings.preset.estimatedSizeBytes
        : estimateAdvancedSize(item.metadata, item.settings);
      if (available < estimatedSize * 1.1) throw new Error('ENOSPC: 可用空间不足');

      const outputPath = await uniqueOutputPath(item.metadata.path);
      temporaryPath = join(directory, `.${sourceBaseName(item.metadata.path)}.translite-${item.id}.tmp.mp4`);
      this.emitProgress(item, { status: 'running', progress: 0 });
      await this.spawnFfmpeg(item, temporaryPath);
      if (this.cancelled.has(item.id)) {
        await safeUnlink(temporaryPath);
        this.emit({ type: 'job-finished', result: { jobId: item.id, status: 'cancelled' } });
        return;
      }
      await rename(temporaryPath, outputPath);
      this.emitProgress(item, { status: 'completed', progress: 1, outputPath });
      this.emit({ type: 'job-finished', result: { jobId: item.id, status: 'completed', outputPath } });
    } catch (error) {
      await safeUnlink(temporaryPath);
      if (this.cancelled.has(item.id)) {
        this.emit({ type: 'job-finished', result: { jobId: item.id, status: 'cancelled' } });
      } else {
        const technicalLog = error instanceof Error ? error.message.slice(-12_000) : String(error);
        const mapped = mapFfmpegError(error);
        this.emitProgress(item, { status: 'failed', progress: 0, error: mapped, technicalLog });
        this.emit({ type: 'job-finished', result: { jobId: item.id, status: 'failed', error: mapped } });
      }
    } finally {
      this.current = undefined;
    }
  }

  private spawnFfmpeg(item: QueueItem, temporaryPath: string): Promise<void> {
    const args = buildFfmpegArgs(item, temporaryPath);

    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath('ffmpeg'), args, { shell: false, windowsHide: true });
      this.current = { item, child, temporaryPath };
      let stdoutBuffer = '';
      let stderr = '';
      let speedAverage: number | undefined;
      let currentOutTime = 0;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const [key, value] = line.split('=', 2);
          if (key === 'out_time_us') currentOutTime = Number(value) / 1_000_000;
          if (key === 'out_time_ms' && currentOutTime === 0) currentOutTime = Number(value) / 1_000_000;
          if (key === 'speed') {
            const speed = Number(value.replace('x', ''));
            speedAverage = smoothSpeed(speedAverage, speed);
          }
          if (key === 'progress') {
            const { progress, etaSeconds } = calculateProgress(currentOutTime, item.metadata.durationSeconds, speedAverage);
            this.emitProgress(item, { progress, speed: speedAverage, etaSeconds });
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr = (stderr + chunk.toString()).slice(-12_000);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `FFmpeg 退出码：${code}`));
      });
    });
  }
}

async function uniqueOutputPath(sourcePath: string): Promise<string> {
  const directory = outputDirectory(sourcePath);
  const base = `${sourceBaseName(sourcePath)}_压缩`;
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? '' : ` (${index})`;
    const candidate = join(directory, `${base}${suffix}.mp4`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('无法生成不重名的输出文件');
}

async function safeUnlink(path: string): Promise<void> {
  if (!path) return;
  try { await unlink(path); } catch { /* 文件可能尚未生成 */ }
}
