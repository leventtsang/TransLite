import { basename } from 'node:path';
import { parseRate } from './compression';
import type { VideoMetadata } from './types';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  profile?: string;
  level?: number;
  codec_tag_string?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  duration?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  bits_per_sample?: number;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  chroma_location?: string;
  field_order?: string;
  sample_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  tags?: { rotate?: string };
  side_data_list?: ProbeSideData[];
}

interface ProbeSideData {
  side_data_type?: string;
  rotation?: number;
  red_x?: string;
  red_y?: string;
  green_x?: string;
  green_y?: string;
  blue_x?: string;
  blue_y?: string;
  white_point_x?: string;
  white_point_y?: string;
  min_luminance?: string;
  max_luminance?: string;
  max_content?: number;
  max_average?: number;
  dv_profile?: number;
}

export interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string; bit_rate?: string };
}

export function metadataFromProbe(probe: ProbeOutput, path: string, fileSize: number): VideoMetadata {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const subtitleTracks = probe.streams?.filter((stream) => stream.codec_type === 'subtitle').length ?? 0;
  if (!video?.width || !video.height) throw new Error('未检测到可用的视频轨道');

  const durationSeconds = Number(probe.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('无法读取有效的视频时长');
  const rotation = Math.round(video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation
    ?? Number(video.tags?.rotate ?? 0));
  const rotated = Math.abs(rotation) % 180 === 90;
  const width = rotated ? video.height : video.width;
  const height = rotated ? video.width : video.height;
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
  const nominalFps = parseRate(video.r_frame_rate) || fps;
  const audioBitrate = Number(audio?.bit_rate ?? 0);
  const totalBitrate = Number(probe.format?.bit_rate ?? 0);
  const calculatedTotal = fileSize * 8 / durationSeconds;
  const videoBitrate = Number(video.bit_rate)
    || Math.max(1, (totalBitrate || calculatedTotal) - audioBitrate);
  const videoBitDepth = Number(video.bits_per_raw_sample || 0) || bitDepthFromPixelFormat(video.pix_fmt);
  const mastering = video.side_data_list?.find((item) => /mastering display/i.test(item.side_data_type ?? ''));
  const contentLight = video.side_data_list?.find((item) => /content light/i.test(item.side_data_type ?? ''));
  const dovi = video.side_data_list?.find((item) => /dovi|dolby vision/i.test(item.side_data_type ?? ''));
  const hdrType = detectHdrType(video.color_transfer, video.color_primaries, videoBitDepth, Boolean(dovi));
  const masteringDisplay = mastering ? {
    red: pair(mastering.red_x, mastering.red_y),
    green: pair(mastering.green_x, mastering.green_y),
    blue: pair(mastering.blue_x, mastering.blue_y),
    whitePoint: pair(mastering.white_point_x, mastering.white_point_y),
    minLuminance: mastering.min_luminance,
    maxLuminance: mastering.max_luminance,
  } : undefined;
  const audioBitDepth = Number(audio?.bits_per_raw_sample || audio?.bits_per_sample || 0) || undefined;

  return {
    path,
    name: basename(path),
    sizeBytes: fileSize,
    durationSeconds,
    width,
    height,
    fps,
    nominalFps,
    videoCodec: video.codec_name ?? '未知',
    videoProfile: video.profile,
    videoLevel: video.level,
    videoCodecTag: video.codec_tag_string,
    videoBitrate,
    pixelFormat: video.pix_fmt,
    videoBitDepth,
    colorRange: video.color_range,
    colorSpace: video.color_space,
    colorTransfer: video.color_transfer,
    colorPrimaries: video.color_primaries,
    chromaLocation: video.chroma_location,
    fieldOrder: video.field_order,
    hdrType,
    masteringDisplay,
    maxCll: contentLight?.max_content,
    maxFall: contentLight?.max_average,
    dolbyVisionProfile: dovi?.dv_profile,
    audioCodec: audio?.codec_name,
    audioProfile: audio?.profile,
    audioBitrate: audioBitrate || undefined,
    audioSampleRate: Number(audio?.sample_rate || 0) || undefined,
    audioSampleFormat: audio?.sample_fmt,
    audioBitDepth,
    audioChannels: audio?.channels,
    audioChannelLayout: audio?.channel_layout,
    hasAudio: Boolean(audio),
    subtitleTracks,
    rotation,
  };
}

function pair(x?: string, y?: string): string | undefined {
  return x && y ? `${x},${y}` : undefined;
}

function bitDepthFromPixelFormat(pixelFormat?: string): number | undefined {
  if (!pixelFormat) return undefined;
  const match = pixelFormat.match(/(?:p|le|be)(9|10|12|14|16)(?:le|be)?$/i) ?? pixelFormat.match(/(9|10|12|14|16)/);
  return match ? Number(match[1]) : 8;
}

export function detectHdrType(transfer?: string, primaries?: string, bitDepth?: number, dolbyVision = false): VideoMetadata['hdrType'] {
  if (dolbyVision) return 'dolby-vision';
  if (transfer === 'smpte2084') return 'hdr10';
  if (transfer === 'arib-std-b67') return 'hlg';
  if ((bitDepth ?? 8) >= 10 && primaries === 'bt2020') return 'unknown-hdr';
  return 'sdr';
}
