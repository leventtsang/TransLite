import { describe, expect, it } from 'vitest';
import { chooseRecommendedPreset, createPresets, estimateSize, evenFloor, fitWithin, parseRate } from './compression';
import type { VideoMetadata } from './types';

const metadata: VideoMetadata = {
  path: '/视频/示例 4K.mov', name: '示例 4K.mov', sizeBytes: 1_000_000_000,
  durationSeconds: 600, width: 3840, height: 2160, fps: 60,
  nominalFps: 60, hdrType: 'sdr',
  videoCodec: 'hevc', videoBitrate: 12_000_000, audioCodec: 'aac',
  audioBitrate: 192_000, hasAudio: true, subtitleTracks: 0, rotation: 0,
};

describe('compression recommendations', () => {
  it('rounds dimensions down to an even number', () => {
    expect(evenFloor(1919)).toBe(1918);
    expect(fitWithin(3840, 2160, 1920, 1080)).toEqual([1920, 1080]);
  });

  it('creates the three specified tiers without enlarging video', () => {
    const [quality, balanced, small] = createPresets(metadata);
    expect(quality.width).toBe(3840);
    expect(balanced.width).toBe(1920);
    expect(balanced.height).toBe(1080);
    expect(small.width).toBe(1280);
    expect(small.height).toBe(720);
    expect(small.fps).toBe(30);
    expect(chooseRecommendedPreset([quality, balanced, small])).toBe('balanced');
  });

  it('does not add audio size for silent video', () => {
    const silent = createPresets({ ...metadata, hasAudio: false });
    expect(silent.every((preset) => preset.audioBitrate === 0)).toBe(true);
  });

  it('estimates mux overhead and parses fractional frame rates', () => {
    expect(estimateSize(10, 1_000_000, 0)).toBe(1_287_500);
    expect(parseRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRate('0/0')).toBe(0);
  });
});
