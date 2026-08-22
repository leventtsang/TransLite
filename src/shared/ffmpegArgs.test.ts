import { describe, expect, it } from 'vitest';
import { createAdvancedRecommendation } from './advanced';
import { buildFfmpegArgs } from './ffmpegArgs';
import type { QueueItem, VideoMetadata } from './types';

const hdr: VideoMetadata = {
  path: '/tmp/中文 HDR source.mov', name: '中文 HDR source.mov', sizeBytes: 500_000_000, durationSeconds: 120,
  width: 3840, height: 2160, fps: 30, nominalFps: 30, videoCodec: 'hevc', videoProfile: 'Main 10',
  videoBitrate: 30_000_000, pixelFormat: 'yuv420p10le', videoBitDepth: 10, colorRange: 'tv',
  colorSpace: 'bt2020nc', colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', hdrType: 'hdr10',
  maxCll: 1000, maxFall: 400, hasAudio: true, audioCodec: 'aac', audioBitrate: 192_000,
  audioSampleRate: 96_000, audioChannels: 6, audioChannelLayout: '5.1', subtitleTracks: 1, rotation: 0,
};

function item(settings = createAdvancedRecommendation(hdr).settings): QueueItem {
  return { id: 'job-1', metadata: hdr, settings };
}

describe('advanced FFmpeg arguments', () => {
  it('preserves HDR with H.265 Main10, color tags and first audio track', () => {
    const args = buildFfmpegArgs(item(), '/tmp/output file.mp4');
    expect(args).toContain('libx265');
    expect(args).toContain('main10');
    expect(args).toContain('yuv420p10le');
    expect(args).toContain('hvc1');
    expect(args).toContain('bt2020');
    expect(args.find((value) => value.includes('max-cll=1000,400') && value.includes('colorprim=9') && value.includes('transfer=16'))).toBeTruthy();
    expect(args.find((value) => value.includes('setparams=color_primaries=bt2020:color_trc=smpte2084'))).toBeTruthy();
    expect(args).toContain('0:a:0?');
    expect(args).toContain('-sn');
    expect(args).toContain('/tmp/中文 HDR source.mov');
  });

  it('tone maps HDR to limited-range BT.709 and permits H.264', () => {
    const recommended = createAdvancedRecommendation(hdr).settings;
    const args = buildFfmpegArgs(item({ ...recommended, colorMode: 'tone-map-sdr', codec: 'h264' }), '/tmp/sdr.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('bt709');
    expect(args).toContain('tv');
    expect(args.find((value) => value.includes('tonemap=tonemap=mobius'))).toBeTruthy();
    expect(args.find((value) => value.includes('setparams=color_primaries=bt2020:color_trc=smpte2084'))).toBeTruthy();
    expect(args.find((value) => value.includes('pin=bt2020:tin=smpte2084:min=bt2020nc:rin=limited:t=linear:m=gbr'))).toBeTruthy();
  });

  it('does not add an audio track for silent video', () => {
    const silent = { ...hdr, hasAudio: false, audioCodec: undefined, audioBitrate: undefined };
    const settings = createAdvancedRecommendation(silent).settings;
    const args = buildFfmpegArgs({ id: 'silent', metadata: silent, settings }, '/tmp/silent.mp4');
    expect(args).toContain('-an');
    expect(args).not.toContain('0:a:0?');
  });
});
