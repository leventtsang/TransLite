import { describe, expect, it } from 'vitest';
import { metadataFromProbe, type ProbeOutput } from '../src/shared/probe';

describe('ffprobe parsing', () => {
  it('uses display dimensions for rotated portrait video and detects tracks', () => {
    const probe: ProbeOutput = {
      format: { duration: '10', bit_rate: '2200000' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', bit_rate: '2000000', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac', bit_rate: '128000' },
        { codec_type: 'subtitle', codec_name: 'subrip' },
      ],
    };
    const result = metadataFromProbe(probe, '/tmp/竖屏 video.mp4', 2_750_000);
    expect([result.width, result.height]).toEqual([1080, 1920]);
    expect(result.rotation).toBe(-90);
    expect(result.subtitleTracks).toBe(1);
    expect(result.hasAudio).toBe(true);
  });

  it('rejects input without a valid video stream', () => {
    expect(() => metadataFromProbe({ format: { duration: '1' }, streams: [] }, '/tmp/audio.mp3', 100)).toThrow('视频轨道');
  });

  it('parses HDR10 mastering, light level, bit depth, and audio sample details', () => {
    const probe: ProbeOutput = {
      format: { duration: '60', size: '100000000' },
      streams: [
        {
          codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', level: 153,
          width: 3840, height: 2160, avg_frame_rate: '25/1', r_frame_rate: '25/1', bit_rate: '12000000',
          pix_fmt: 'yuv420p10le', color_primaries: 'bt2020', color_transfer: 'smpte2084', color_space: 'bt2020nc',
          side_data_list: [
            { side_data_type: 'Mastering display metadata', red_x: '17/25', red_y: '8/25', max_luminance: '1000/1' },
            { side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 },
          ],
        },
        { codec_type: 'audio', codec_name: 'aac', profile: 'LC', bit_rate: '192000', sample_rate: '48000', sample_fmt: 'fltp', channels: 6, channel_layout: '5.1' },
      ],
    };
    const result = metadataFromProbe(probe, '/tmp/hdr.mp4', 100_000_000);
    expect(result.hdrType).toBe('hdr10');
    expect(result.videoBitDepth).toBe(10);
    expect(result.maxCll).toBe(1000);
    expect(result.maxFall).toBe(400);
    expect(result.masteringDisplay?.red).toBe('17/25,8/25');
    expect(result.audioSampleRate).toBe(48_000);
    expect(result.audioChannels).toBe(6);
  });

  it('detects HLG and Dolby Vision side data', () => {
    const base: ProbeOutput = { format: { duration: '1' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1', color_transfer: 'arib-std-b67' }] };
    expect(metadataFromProbe(base, '/tmp/hlg.mp4', 1_000_000).hdrType).toBe('hlg');
    base.streams![0].side_data_list = [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }];
    expect(metadataFromProbe(base, '/tmp/dv.mp4', 1_000_000).hdrType).toBe('dolby-vision');
  });
});
