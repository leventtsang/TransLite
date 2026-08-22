import { app } from 'electron';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseMpls } from '../src/shared/mpls';
import { recommendBluraySettings } from '../src/shared/blurayRecommendations';
import type {
  BlurayAnalysis, BlurayAudioTrack, BlurayRecommendation, BluraySubtitleTrack, BlurayTitle, BlurayVideoTrack,
} from '../src/shared/blurayTypes';
import { parseRate } from '../src/shared/compression';

interface ProbeStream {
  index: number; codec_type?: string; codec_name?: string; profile?: string; width?: number; height?: number;
  avg_frame_rate?: string; r_frame_rate?: string; bit_rate?: string; pix_fmt?: string; bits_per_raw_sample?: string;
  color_primaries?: string; color_transfer?: string; color_space?: string; color_range?: string;
  channels?: number; channel_layout?: string; sample_rate?: string; tags?: Record<string, string>;
  disposition?: { forced?: number }; side_data_list?: Array<Record<string, unknown>>;
}

interface ProbeOutput { streams?: ProbeStream[]; format?: { bit_rate?: string; duration?: string }; }

export function binaryPath(binary: 'ffmpeg' | 'ffprobe'): string {
  const root = app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'resources', 'ffmpeg');
  return join(root, 'win32-x64', `${binary}.exe`);
}

export async function verifyBlurayBinaries(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('蓝光转码版仅支持 Windows x64。');
  for (const binary of ['ffmpeg', 'ffprobe'] as const) {
    const path = binaryPath(binary);
    await access(path, constants.F_OK);
    await runProcess(path, ['-version'], 10_000);
  }
}

export async function analyzeBdmv(selectedPath: string): Promise<BlurayAnalysis> {
  const root = await normalizeDiscRoot(selectedPath);
  const bdmv = basename(root).toUpperCase() === 'BDMV' ? root : join(root, 'BDMV');
  const streamDirectory = join(bdmv, 'STREAM');
  const playlistDirectory = join(bdmv, 'PLAYLIST');
  const playlistNames = (await readdir(playlistDirectory)).filter((name) => /\.mpls$/i.test(name)).sort();
  if (playlistNames.length === 0) throw new Error('PLAYLIST 文件夹中没有 MPLS 播放列表。');
  const rawTitles: BlurayTitle[] = [];
  for (const playlistName of playlistNames) {
    try {
      const parsed = parseMpls(await readFile(join(playlistDirectory, playlistName)));
      if (parsed.clips.length === 0 || parsed.durationSeconds < 5) continue;
      const clips = await Promise.all(parsed.clips.map(async (clip) => {
        const path = join(streamDirectory, `${clip.id}.m2ts`);
        const file = await stat(path);
        return { ...clip, path, durationSeconds: (clip.outTicks - clip.inTicks) / 45_000, sizeBytes: file.size };
      }));
      // concat demuxer exposes the stream layout of its first segment, so use that
      // same segment when deciding which absolute stream indexes to map.
      const probeClip = clips[0];
      const probe = JSON.parse(await runProcess(binaryPath('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', probeClip.path], 60_000)) as ProbeOutput;
      const video = videoFromProbe(probe);
      const audioTracks = audioFromProbe(probe);
      const subtitleTracks = subtitlesFromProbe(probe);
      const warnings: string[] = [];
      if (video.hdrType === 'dolby-vision') warnings.push('Dolby Vision Profile 7 增强层无法在常规重编码中可靠保留，建议输出 HDR10 基础层。');
      if (parsed.angleCount > 1) warnings.push(`检测到 ${parsed.angleCount} 个角度，当前按主角度处理。`);
      rawTitles.push({
        id: playlistName.replace(/\.mpls$/i, ''), playlistName, durationSeconds: parsed.durationSeconds,
        sizeBytes: clips.reduce((sum, clip) => sum + clip.sizeBytes, 0), clips,
        chaptersSeconds: parsed.chaptersSeconds, angleCount: parsed.angleCount, video, audioTracks, subtitleTracks, warnings,
      });
    } catch { /* 菜单或损坏的播放列表不阻止整盘分析 */ }
  }
  if (rawTitles.length === 0) throw new Error('没有找到可转码的蓝光标题。');
  const seen = new Map<string, string>();
  for (const title of rawTitles) {
    const signature = title.clips.map((clip) => `${clip.id}:${clip.inTicks}:${clip.outTicks}`).join('|');
    const duplicate = seen.get(signature);
    if (duplicate) title.duplicateOf = duplicate;
    else seen.set(signature, title.id);
  }
  const titles = rawTitles.sort((a, b) => b.durationSeconds - a.durationSeconds || b.sizeBytes - a.sizeBytes);
  const recommended = titles.find((title) => !title.duplicateOf) ?? titles[0];
  const discRoot = basename(root).toUpperCase() === 'BDMV' ? dirname(root) : root;
  const warnings = playlistNames.length > 200 ? ['播放列表数量很多，可能包含防复制混淆；已按片段顺序去重并优先推荐最长标题。'] : [];
  return { rootPath: discRoot, discName: basename(discRoot), titles, recommendedTitleId: recommended.id, playlistCount: playlistNames.length, warnings };
}

export function recommendationFor(title: BlurayTitle): BlurayRecommendation { return recommendBluraySettings(title); }

async function normalizeDiscRoot(path: string): Promise<string> {
  const direct = basename(path).toUpperCase() === 'BDMV' ? path : join(path, 'BDMV');
  await access(join(direct, 'STREAM'), constants.R_OK);
  await access(join(direct, 'PLAYLIST'), constants.R_OK);
  return basename(path).toUpperCase() === 'BDMV' ? path : path;
}

function videoFromProbe(probe: ProbeOutput): BlurayVideoTrack {
  const stream = probe.streams?.find((entry) => entry.codec_type === 'video');
  if (!stream?.width || !stream.height) throw new Error('标题中没有可用视频轨');
  const side = stream.side_data_list ?? [];
  const dovi = side.find((entry) => /dovi|dolby vision/i.test(String(entry.side_data_type ?? '')));
  const transfer = stream.color_transfer;
  const bitDepth = Number(stream.bits_per_raw_sample || 0) || (/10/.test(stream.pix_fmt ?? '') ? 10 : 8);
  const hdrType = dovi ? 'dolby-vision' : transfer === 'smpte2084' ? 'hdr10' : transfer === 'arib-std-b67' ? 'hlg' : bitDepth >= 10 && stream.color_primaries === 'bt2020' ? 'unknown-hdr' : 'sdr';
  const light = side.find((entry) => /content light/i.test(String(entry.side_data_type ?? '')));
  const mastering = side.find((entry) => /mastering display/i.test(String(entry.side_data_type ?? '')));
  return {
    streamIndex: stream.index, codec: stream.codec_name ?? 'unknown', profile: stream.profile,
    width: stream.width, height: stream.height, fps: parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate) || 24,
    bitrate: Number(stream.bit_rate || probe.format?.bit_rate || 0) || undefined, pixelFormat: stream.pix_fmt, bitDepth,
    hdrType, dolbyVisionProfile: Number(dovi?.dv_profile ?? 0) || undefined,
    colorPrimaries: stream.color_primaries, colorTransfer: transfer, colorSpace: stream.color_space, colorRange: stream.color_range,
    maxCll: Number(light?.max_content ?? 0) || undefined, maxFall: Number(light?.max_average ?? 0) || undefined,
    masteringDisplay: masteringDisplay(mastering),
  };
}

function masteringDisplay(data?: Record<string, unknown>): string | undefined {
  if (!data) return undefined;
  const chroma = (name: string) => Math.round(rational(data[name]) * 50_000);
  const luminance = (name: string) => Math.round(rational(data[name]) * 10_000);
  const values = ['green_x','green_y','blue_x','blue_y','red_x','red_y','white_point_x','white_point_y','max_luminance','min_luminance'];
  if (values.some((name) => !Number.isFinite(rational(data[name])))) return undefined;
  return `G(${chroma('green_x')},${chroma('green_y')})B(${chroma('blue_x')},${chroma('blue_y')})R(${chroma('red_x')},${chroma('red_y')})WP(${chroma('white_point_x')},${chroma('white_point_y')})L(${luminance('max_luminance')},${luminance('min_luminance')})`;
}

function rational(value: unknown): number {
  const [left, right = '1'] = String(value ?? '').split('/');
  const number = Number(left) / Number(right);
  return Number.isFinite(number) ? number : Number.NaN;
}

function audioFromProbe(probe: ProbeOutput): BlurayAudioTrack[] {
  return (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio').map((stream) => {
    const codec = stream.codec_name ?? 'unknown';
    const profile = stream.profile;
    const text = `${codec} ${profile ?? ''} ${stream.tags?.title ?? ''}`.toLowerCase();
    return {
      streamIndex: stream.index, codec, profile, language: stream.tags?.language ?? 'und', title: stream.tags?.title,
      channels: stream.channels, channelLayout: stream.channel_layout, sampleRate: Number(stream.sample_rate || 0) || undefined,
      bitrate: Number(stream.bit_rate || 0) || undefined,
      lossless: /truehd|dts-hd ma|mlp|pcm|flac/.test(text), atmos: /atmos|truehd.*object/.test(text),
    };
  });
}

function subtitlesFromProbe(probe: ProbeOutput): BluraySubtitleTrack[] {
  return (probe.streams ?? []).filter((stream) => stream.codec_type === 'subtitle').map((stream) => ({
    streamIndex: stream.index, codec: stream.codec_name ?? 'unknown', language: stream.tags?.language ?? 'und',
    title: stream.tags?.title, forced: Boolean(stream.disposition?.forced),
  }));
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('分析命令超时')); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr || `命令退出码 ${code}`)); });
  });
}
