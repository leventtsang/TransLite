import type { CompressionPreset, PresetId, VideoMetadata } from './types';

const MIN_VIDEO_BITRATE = 300_000;

export function evenFloor(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): [number, number] {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [evenFloor(width * scale), evenFloor(height * scale)];
}

export function estimateSize(durationSeconds: number, videoBitrate: number, audioBitrate: number): number {
  return Math.round((durationSeconds * (videoBitrate + audioBitrate) / 8) * 1.03);
}

function makePreset(
  metadata: VideoMetadata,
  id: PresetId,
  label: string,
  description: string,
  maxWidth: number,
  maxHeight: number,
  maxFps: number,
  sourceRatio: number,
  bitsPerPixel: number,
  audioBitrate: number,
): CompressionPreset {
  const portrait = metadata.height > metadata.width;
  const limits: [number, number] = portrait ? [maxHeight, maxWidth] : [maxWidth, maxHeight];
  const [width, height] = fitWithin(metadata.width, metadata.height, limits[0], limits[1]);
  const fps = Math.min(metadata.fps || 30, maxFps);
  const sourceBound = metadata.videoBitrate * sourceRatio;
  const complexityBound = width * height * fps * bitsPerPixel;
  const videoBitrate = Math.max(MIN_VIDEO_BITRATE, Math.round(Math.min(sourceBound, complexityBound)));
  const actualAudioBitrate = metadata.hasAudio ? audioBitrate : 0;
  const estimatedSizeBytes = estimateSize(metadata.durationSeconds, videoBitrate, actualAudioBitrate);
  const savingPercent = metadata.sizeBytes > 0
    ? Math.max(0, Math.round((1 - estimatedSizeBytes / metadata.sizeBytes) * 100))
    : 0;

  return {
    id,
    label,
    description,
    width,
    height,
    fps,
    videoBitrate,
    audioBitrate: actualAudioBitrate,
    estimatedSizeBytes,
    savingPercent,
    limitedBenefit: savingPercent < 10,
  };
}

export function createPresets(metadata: VideoMetadata): CompressionPreset[] {
  return [
    makePreset(metadata, 'quality', '高画质', '尽量保留原始细节', metadata.width, metadata.height, metadata.fps || 60, 0.85, 0.10, 128_000),
    makePreset(metadata, 'balanced', '均衡压缩', '画质与体积更均衡', 1920, 1080, metadata.fps || 60, 0.60, 0.075, 128_000),
    makePreset(metadata, 'small', '极致压缩', '适合分享和节省空间', 1280, 720, 30, 0.40, 0.055, 96_000),
  ];
}

export function chooseRecommendedPreset(presets: CompressionPreset[]): PresetId {
  const balanced = presets.find((preset) => preset.id === 'balanced');
  if (balanced && !balanced.limitedBenefit) return 'balanced';
  return presets.find((preset) => !preset.limitedBenefit)?.id ?? 'balanced';
}

export function parseRate(value?: string): number {
  if (!value || value === '0/0') return 0;
  const [numerator, denominator = 1] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}
