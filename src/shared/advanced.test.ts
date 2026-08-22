import { describe, expect, it } from 'vitest';
import {
  candidateBitrate,
  copyAdvancedSettings,
  createAdvancedRecommendation,
  dimensionsForMode,
  safeMinimumBitrate,
  validateAdvancedSettings,
} from './advanced';
import type { VideoMetadata } from './types';

const source: VideoMetadata = {
  path: '/tmp/source.mp4', name: 'source.mp4', sizeBytes: 100_000_000, durationSeconds: 60,
  width: 1920, height: 1080, fps: 30, nominalFps: 30,
  videoCodec: 'h264', videoBitrate: 20_000_000, pixelFormat: 'yuv420p', videoBitDepth: 8,
  hdrType: 'sdr', audioCodec: 'aac', audioBitrate: 128_000, audioSampleRate: 48_000,
  audioChannels: 2, audioChannelLayout: 'stereo', hasAudio: true, subtitleTracks: 0, rotation: 0,
};

describe('advanced recommendations', () => {
  it('uses dynamic safety floors for 1080p and 4K instead of 300 kbps', () => {
    expect(safeMinimumBitrate('h264', false, 1920, 1080, 30)).toBe(2_488_320);
    expect(safeMinimumBitrate('h265', false, 1920, 1080, 30)).toBe(1_555_200);
    expect(safeMinimumBitrate('h265', true, 3840, 2160, 30)).toBe(8_709_120);
    expect(safeMinimumBitrate('h264', false, 3840, 2160, 30)).toBe(9_953_280);
  });

  it('calculates codec-specific candidate bitrate', () => {
    expect(candidateBitrate(source, 'h264', false, 1920, 1080, 30)).toBe(4_665_600);
    expect(candidateBitrate(source, 'h265', false, 1920, 1080, 30)).toBe(3_265_920);
    expect(candidateBitrate(source, 'h265', true, 1920, 1080, 30)).toBe(4_043_520);
  });

  it('does not recommend re-encoding an already low-bitrate 1080p source', () => {
    const recommendation = createAdvancedRecommendation({ ...source, videoBitrate: 1_000_000 });
    expect(recommendation.compressionNotRecommended).toBe(true);
    expect(recommendation.settings.videoBitrate).toBe(1_000_000);
    expect(recommendation.settings.resolutionMode).toBe('source');
    expect(recommendation.reason).toContain('建议保留原文件');
  });

  it('caps 4K to 1080p, caps high frame rate to 60, and suggests H.265', () => {
    const recommendation = createAdvancedRecommendation({
      ...source, width: 3840, height: 2160, fps: 120, nominalFps: 120,
      videoCodec: 'hevc', videoBitrate: 80_000_000,
    });
    expect([recommendation.settings.width, recommendation.settings.height]).toEqual([1920, 1080]);
    expect(recommendation.settings.fps).toBe(60);
    expect(recommendation.settings.codec).toBe('h265');
  });

  it('does not enlarge small or portrait videos', () => {
    expect(dimensionsForMode({ ...source, width: 640, height: 360 }, '1080p')).toEqual([640, 360]);
    expect(dimensionsForMode({ ...source, width: 2160, height: 3840 }, '1080p')).toEqual([1080, 1920]);
  });

  it('validates unsafe combinations while allowing manual bitrate below the safety reference', () => {
    const recommendation = createAdvancedRecommendation(source).settings;
    const issues = validateAdvancedSettings(source, {
      ...recommendation, resolutionMode: 'custom', width: 1919, videoBitrate: 500_000,
    });
    expect(issues.some((issue) => issue.field === 'width')).toBe(true);
    expect(issues.some((issue) => issue.field === 'videoBitrate')).toBe(false);
  });

  it('keeps an unusually low source bitrate valid when compression is not recommended', () => {
    const veryLow = { ...source, width: 320, height: 180, videoBitrate: 180_000 };
    const settings = createAdvancedRecommendation(veryLow).settings;
    expect(settings.videoBitrate).toBe(180_000);
    expect(validateAdvancedSettings(veryLow, settings)).toEqual([]);
  });

  it('applies source-following settings independently for every queue item', () => {
    const settings = createAdvancedRecommendation(source).settings;
    const target = { ...source, width: 1280, height: 720, fps: 25, nominalFps: 25 };
    const copied = copyAdvancedSettings({ ...settings, resolutionMode: 'source', frameRateMode: 'source' }, target);
    expect([copied.width, copied.height, copied.fps]).toEqual([1280, 720, 25]);
  });
});
