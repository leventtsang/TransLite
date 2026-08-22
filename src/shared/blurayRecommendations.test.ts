import { describe, expect, it } from 'vitest';
import { qualitySettings, recommendBluraySettings } from './blurayRecommendations';
import type { BlurayTitle } from './blurayTypes';

function title(codec = 'h264', hdr: BlurayTitle['video']['hdrType'] = 'hdr10'): BlurayTitle {
  return { id: '00800', playlistName: '00800.mpls', durationSeconds: 7200, sizeBytes: 60e9, clips: [], chaptersSeconds: [], angleCount: 1,
    video: { streamIndex: 0, codec, width: 3840, height: 2160, fps: 23.976, hdrType: hdr },
    audioTracks: [{ streamIndex: 1, codec: 'truehd', language: 'eng', lossless: true, atmos: true }],
    subtitleTracks: [{ streamIndex: 2, codec: 'hdmv_pgs_subtitle', language: 'zho', forced: false }], warnings: [] };
}

describe('蓝光收藏建议', () => {
  it('默认复制全部音轨和字幕并使用收藏级 x265', () => {
    const result = recommendBluraySettings(title());
    expect(result.settings).toMatchObject({ videoCodec: 'hevc', crf: 16, preset: 'slow', audioStreamIndexes: [1], subtitleStreamIndexes: [2] });
  });
  it('杜比视界明确降为 HDR10 基础层', () => {
    const result = recommendBluraySettings(title('hevc', 'dolby-vision'));
    expect(result.settings.hdrMode).toBe('hdr10-base');
    expect(result.warnings.join('')).toContain('Profile 7');
  });
  it('质量档位映射稳定', () => { expect(qualitySettings('remux').codec).toBe('copy'); expect(qualitySettings('high').crf).toBe(18); });
});
