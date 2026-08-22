import { estimateSize, fitWithin } from './compression';
import type {
  AdvancedRecommendation,
  AdvancedTranscodeSettings,
  ColorMode,
  FrameRateMode,
  ResolutionMode,
  VideoCodecChoice,
  VideoMetadata,
} from './types';

export interface ValidationIssue {
  field: keyof AdvancedTranscodeSettings | 'combination';
  message: string;
}

const RESOLUTION_LIMITS: Record<Exclude<ResolutionMode, 'source' | 'custom'>, [number, number]> = {
  '2160p': [3840, 2160],
  '1440p': [2560, 1440],
  '1080p': [1920, 1080],
  '720p': [1280, 720],
};

export function isHdr(metadata: VideoMetadata): boolean {
  return metadata.hdrType !== 'sdr';
}

export function dimensionsForMode(metadata: VideoMetadata, mode: ResolutionMode, customWidth?: number, customHeight?: number): [number, number] {
  if (mode === 'source') return fitWithin(metadata.width, metadata.height, metadata.width, metadata.height);
  if (mode === 'custom') return [Math.floor(customWidth ?? metadata.width), Math.floor(customHeight ?? metadata.height)];
  const [landscapeWidth, landscapeHeight] = RESOLUTION_LIMITS[mode];
  const portrait = metadata.height > metadata.width;
  return fitWithin(metadata.width, metadata.height, portrait ? landscapeHeight : landscapeWidth, portrait ? landscapeWidth : landscapeHeight);
}

export function fpsForMode(metadata: VideoMetadata, mode: FrameRateMode, customFps?: number): number {
  if (mode === 'source') return metadata.fps;
  if (mode === 'custom') return customFps ?? metadata.fps;
  return Math.min(metadata.fps, Number(mode));
}

export function safeMinimumBitrate(codec: VideoCodecChoice, hdr: boolean, width: number, height: number, fps: number): number {
  const pixelsPerSecond = width * height * fps;
  if (codec === 'h264') return Math.round(Math.max(300_000, pixelsPerSecond * 0.040));
  if (hdr) return Math.round(Math.max(400_000, pixelsPerSecond * 0.035));
  return Math.round(Math.max(250_000, pixelsPerSecond * 0.025));
}

export function candidateBitrate(metadata: VideoMetadata, codec: VideoCodecChoice, hdr: boolean, width: number, height: number, fps: number): number {
  const pixelsPerSecond = width * height * fps;
  if (codec === 'h264') return Math.round(Math.min(metadata.videoBitrate * 0.60, pixelsPerSecond * 0.075));
  if (hdr) return Math.round(Math.min(metadata.videoBitrate * 0.65, pixelsPerSecond * 0.065));
  return Math.round(Math.min(metadata.videoBitrate * 0.50, pixelsPerSecond * 0.0525));
}

function recommendedCodec(metadata: VideoMetadata): VideoCodecChoice {
  const sourceCodec = metadata.videoCodec.toLowerCase();
  return isHdr(metadata) || metadata.width > 1920 || metadata.height > 1080 || /hevc|h265|av1/.test(sourceCodec)
    ? 'h265'
    : 'h264';
}

function recommendedColorMode(metadata: VideoMetadata): ColorMode {
  if (!isHdr(metadata)) return 'sdr';
  if (metadata.hdrType === 'dolby-vision' && !['smpte2084', 'arib-std-b67'].includes(metadata.colorTransfer ?? '')) {
    return 'tone-map-sdr';
  }
  return 'preserve-hdr';
}

function recommendedAudioBitrate(metadata: VideoMetadata, channels: number): number {
  if (!metadata.hasAudio) return 0;
  const baseline = channels <= 1 ? 96_000 : channels === 2 ? 128_000 : Math.min(384_000, channels * 64_000);
  const sourceCap = metadata.audioBitrate ? Math.max(32_000, Math.round(metadata.audioBitrate)) : baseline;
  return Math.min(baseline, sourceCap);
}

function recommendedSampleRate(sourceRate: number): number {
  if (sourceRate <= 48_000) return sourceRate;
  return 48_000;
}

export function createAdvancedRecommendation(metadata: VideoMetadata): AdvancedRecommendation {
  const initialResolutionMode: ResolutionMode = metadata.width > 1920 || metadata.height > 1080 ? '1080p' : 'source';
  const [suggestedWidth, suggestedHeight] = dimensionsForMode(metadata, initialResolutionMode);
  const suggestedFps = Math.min(metadata.fps, 60);
  const initialFpsMode: FrameRateMode = metadata.fps > 60 ? '60' : 'source';
  const codec = recommendedCodec(metadata);
  const colorMode = recommendedColorMode(metadata);
  const outputHdr = colorMode === 'preserve-hdr';
  const safeMinimum = safeMinimumBitrate(codec, outputHdr, suggestedWidth, suggestedHeight, suggestedFps);
  const candidate = candidateBitrate(metadata, codec, outputHdr, suggestedWidth, suggestedHeight, suggestedFps);
  const clamped = Math.max(candidate, safeMinimum);
  const compressionNotRecommended = clamped >= metadata.videoBitrate * 0.90;
  const [width, height] = compressionNotRecommended
    ? dimensionsForMode(metadata, 'source')
    : [suggestedWidth, suggestedHeight];
  const fps = compressionNotRecommended ? metadata.fps : suggestedFps;
  const resolutionMode = compressionNotRecommended ? 'source' : initialResolutionMode;
  const frameRateMode = compressionNotRecommended ? 'source' : initialFpsMode;
  const actualSafeMinimum = safeMinimumBitrate(codec, outputHdr, width, height, fps);
  const channels = metadata.hasAudio ? metadata.audioChannels ?? 2 : 0;
  const sourceSampleRate = metadata.audioSampleRate ?? 48_000;
  const sampleRate = metadata.hasAudio ? recommendedSampleRate(sourceSampleRate) : 0;

  return {
    compressionNotRecommended,
    reason: compressionNotRecommended
      ? '这个视频的码率已经很低，重新编码可能降低清晰度，但不会明显减小文件。建议保留原文件。'
      : undefined,
    settings: {
      mode: 'advanced',
      codec,
      speed: 'medium',
      resolutionMode,
      width,
      height,
      frameRateMode,
      fps,
      videoBitrate: compressionNotRecommended ? Math.round(metadata.videoBitrate) : clamped,
      safeMinimumVideoBitrate: actualSafeMinimum,
      colorMode,
      audioBitrate: recommendedAudioBitrate(metadata, channels),
      audioSampleRate: sampleRate,
      audioChannelMode: 'source',
      audioChannels: channels,
    },
  };
}

export function normalizeAdvancedSettings(metadata: VideoMetadata, settings: AdvancedTranscodeSettings): AdvancedTranscodeSettings {
  const normalized = { ...settings };
  if (!isHdr(metadata)) normalized.colorMode = 'sdr';
  if (normalized.colorMode === 'preserve-hdr') normalized.codec = 'h265';
  [normalized.width, normalized.height] = dimensionsForMode(metadata, normalized.resolutionMode, normalized.width, normalized.height);
  normalized.fps = fpsForMode(metadata, normalized.frameRateMode, normalized.fps);
  normalized.safeMinimumVideoBitrate = safeMinimumBitrate(
    normalized.codec,
    normalized.colorMode === 'preserve-hdr',
    normalized.width,
    normalized.height,
    normalized.fps,
  );
  if (!metadata.hasAudio) {
    normalized.audioBitrate = 0;
    normalized.audioSampleRate = 0;
    normalized.audioChannels = 0;
  } else {
    normalized.audioChannels = normalized.audioChannelMode === 'mono'
      ? 1
      : normalized.audioChannelMode === 'stereo' ? 2 : metadata.audioChannels ?? 2;
  }
  return normalized;
}

export function validateAdvancedSettings(metadata: VideoMetadata, input: AdvancedTranscodeSettings): ValidationIssue[] {
  const settings = normalizeAdvancedSettings(metadata, input);
  const issues: ValidationIssue[] = [];
  if (settings.width < 64 || settings.width > 8192 || settings.width % 2 !== 0) {
    issues.push({ field: 'width', message: '宽度必须是 64–8192 之间的偶数。' });
  }
  if (settings.height < 64 || settings.height > 8192 || settings.height % 2 !== 0) {
    issues.push({ field: 'height', message: '高度必须是 64–8192 之间的偶数。' });
  }
  if (!Number.isFinite(settings.fps) || settings.fps < 1 || settings.fps > 120 || settings.fps > metadata.fps + 0.01) {
    issues.push({ field: 'fps', message: '帧率必须在 1–120 fps 之间，并且不能高于源视频。' });
  }
  const absoluteMinimum = settings.codec === 'h264' ? 300_000 : 250_000;
  const acceptedMinimum = Math.min(absoluteMinimum, Math.round(metadata.videoBitrate));
  if (!Number.isFinite(settings.videoBitrate) || settings.videoBitrate < acceptedMinimum || settings.videoBitrate > 200_000_000) {
    issues.push({ field: 'videoBitrate', message: `视频码率必须在 ${acceptedMinimum / 1000} kbps–200 Mbps 之间。` });
  }
  if (settings.colorMode === 'preserve-hdr' && settings.codec !== 'h265') {
    issues.push({ field: 'combination', message: '保留 HDR 必须使用 H.265 编码。' });
  }
  if (settings.colorMode !== 'sdr' && !isHdr(metadata)) {
    issues.push({ field: 'colorMode', message: 'SDR 视频不能转换为伪 HDR。' });
  }
  if (metadata.hasAudio) {
    if (settings.audioBitrate < 32_000 || settings.audioBitrate > 512_000) {
      issues.push({ field: 'audioBitrate', message: '音频码率必须在 32–512 kbps 之间。' });
    }
    const sourceSampleRate = metadata.audioSampleRate;
    if (![32_000, 44_100, 48_000, sourceSampleRate].includes(settings.audioSampleRate)) {
      issues.push({ field: 'audioSampleRate', message: '音频采样率必须保持源值，或选择 32、44.1、48 kHz。' });
    }
  }
  return issues;
}

export function estimateAdvancedSize(metadata: VideoMetadata, settings: AdvancedTranscodeSettings): number {
  return estimateSize(metadata.durationSeconds, settings.videoBitrate, metadata.hasAudio ? settings.audioBitrate : 0);
}

export function copyAdvancedSettings(source: AdvancedTranscodeSettings, targetMetadata: VideoMetadata): AdvancedTranscodeSettings {
  const targetRecommendation = createAdvancedRecommendation(targetMetadata).settings;
  const copied: AdvancedTranscodeSettings = {
    ...source,
    width: source.resolutionMode === 'source' ? targetRecommendation.width : source.width,
    height: source.resolutionMode === 'source' ? targetRecommendation.height : source.height,
    fps: source.frameRateMode === 'source' ? targetMetadata.fps : source.fps,
    audioSampleRate: source.audioSampleRate || targetRecommendation.audioSampleRate,
    audioChannels: source.audioChannelMode === 'source' ? targetRecommendation.audioChannels : source.audioChannels,
  };
  return normalizeAdvancedSettings(targetMetadata, copied);
}
