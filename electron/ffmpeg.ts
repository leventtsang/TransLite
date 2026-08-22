import { app } from 'electron';
import { access, constants, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chooseRecommendedPreset, createPresets } from '../src/shared/compression';
import { createAdvancedRecommendation } from '../src/shared/advanced';
import { metadataFromProbe, type ProbeOutput } from '../src/shared/probe';
import type { ProbedVideo, UserFacingError } from '../src/shared/types';

function platformFolder(): string {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  throw new Error(`当前平台尚未支持：${process.platform}-${process.arch}`);
}

export function binaryPath(binary: 'ffmpeg' | 'ffprobe'): string {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const root = app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg')
    : join(app.getAppPath(), 'resources', 'ffmpeg');
  return join(root, platformFolder(), `${binary}${extension}`);
}

export async function verifyBinaries(): Promise<void> {
  for (const binary of ['ffmpeg', 'ffprobe'] as const) {
    const path = binaryPath(binary);
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    await runProcess(path, ['-version'], 10_000);
  }
}

function runProcess(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('命令执行超时'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `进程退出码：${code}`));
    });
  });
}

export async function probeVideo(path: string): Promise<ProbedVideo> {
  const file = await stat(path);
  if (!file.isFile()) throw new Error('选择的路径不是文件');
  const stdout = await runProcess(binaryPath('ffprobe'), [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path,
  ]);
  const probe = JSON.parse(stdout) as ProbeOutput;
  const metadata = metadataFromProbe(probe, path, file.size);
  const presets = createPresets(metadata);
  return {
    id: randomUUID(),
    metadata,
    presets,
    recommendedPresetId: chooseRecommendedPreset(presets),
    advancedRecommendation: createAdvancedRecommendation(metadata),
  };
}

export function mapFfmpegError(error: unknown): UserFacingError {
  const raw = error instanceof Error ? error.message : String(error);
  if (/ENOENT|no such file/i.test(raw)) {
    return { code: 'FILE_NOT_FOUND', title: '找不到文件', message: '源视频或 FFmpeg 文件不存在，请检查后重试。' };
  }
  if (/Permission denied|EACCES|EPERM/i.test(raw)) {
    return { code: 'NO_PERMISSION', title: '没有访问权限', message: '请确认文件和输出目录可读写。' };
  }
  if (/No space left|ENOSPC/i.test(raw)) {
    return { code: 'NO_SPACE', title: '磁盘空间不足', message: '请清理输出磁盘后重试。' };
  }
  if (/Unknown encoder ['"]?libx26[45]|Encoder .*libx26[45].*not found|Error selecting an encoder.*libx26[45]/i.test(raw)) {
    return { code: 'ENCODER_MISSING', title: '缺少编码器', message: '内嵌 FFmpeg 不包含所选的 H.264/H.265 软件编码器。' };
  }
  if (/Invalid data|moov atom not found|could not find codec/i.test(raw)) {
    return { code: 'INVALID_VIDEO', title: '视频无法读取', message: '文件可能损坏，或格式不受当前 FFmpeg 支持。' };
  }
  return { code: 'TRANSCODE_FAILED', title: '压缩失败', message: 'FFmpeg 未能完成压缩，可展开技术日志查看详情。' };
}

export function sourceBaseName(path: string): string {
  return basename(path, extname(path));
}

export function outputDirectory(path: string): string {
  return dirname(path);
}
