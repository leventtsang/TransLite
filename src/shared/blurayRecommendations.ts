import type { BlurayRecommendation, BlurayTitle } from './blurayTypes';

export function recommendBluraySettings(title: BlurayTitle): BlurayRecommendation {
  const isDolbyVision = title.video.hdrType === 'dolby-vision';
  const alreadyEfficient = /hevc|h265/.test(title.video.codec.toLowerCase());
  const warnings: string[] = [];
  if (isDolbyVision) warnings.push('检测到 Dolby Vision。收藏级重编码将保留 HDR10 基础层，但不保证 Profile 7 动态元数据和增强层。');
  if (alreadyEfficient) warnings.push('原盘已使用 HEVC，继续重编码的节省空间有限，并会产生一次有损转换。');
  return {
    label: '收藏级压缩',
    summary: '保持原分辨率、帧率与 HDR，使用 x265 10-bit 慢速编码；无损音轨和原盘字幕直接复制。',
    estimatedRatio: alreadyEfficient ? [0.72, 0.92] : [0.45, 0.72],
    warnings,
    settings: {
      quality: 'archival',
      videoCodec: 'hevc',
      crf: 16,
      preset: 'slow',
      hdrMode: isDolbyVision ? 'hdr10-base' : 'preserve',
      audioStreamIndexes: title.audioTracks.map((track) => track.streamIndex),
      subtitleStreamIndexes: title.subtitleTracks.map((track) => track.streamIndex),
    },
  };
}

export function qualitySettings(quality: BlurayTranscodeQuality): { codec: 'hevc' | 'copy'; crf: number; preset: 'medium' | 'slow' | 'slower' } {
  if (quality === 'remux') return { codec: 'copy', crf: 0, preset: 'medium' };
  if (quality === 'archival') return { codec: 'hevc', crf: 16, preset: 'slow' };
  if (quality === 'high') return { codec: 'hevc', crf: 18, preset: 'slow' };
  return { codec: 'hevc', crf: 20, preset: 'medium' };
}

type BlurayTranscodeQuality = 'archival' | 'high' | 'balanced' | 'remux';
