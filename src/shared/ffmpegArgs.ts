import { normalizeAdvancedSettings, validateAdvancedSettings } from './advanced';
import type { AdvancedTranscodeSettings, QueueItem, VideoMetadata } from './types';

export function buildFfmpegArgs(item: QueueItem, temporaryPath: string): string[] {
  return item.settings.mode === 'simple'
    ? buildSimpleArgs(item, temporaryPath)
    : buildAdvancedArgs(item.metadata, item.settings, item.metadata.path, temporaryPath);
}

function commonStart(inputPath: string): string[] {
  return ['-y', '-i', inputPath, '-map', '0:v:0', '-map_metadata', '0', '-map_chapters', '0', '-sn'];
}

function commonEnd(outputPath: string): string[] {
  return ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath];
}

function buildSimpleArgs(item: QueueItem, temporaryPath: string): string[] {
  if (item.settings.mode !== 'simple') throw new Error('设置模式无效');
  const preset = item.settings.preset;
  const filters = [`scale=${preset.width}:${preset.height}:flags=lanczos`];
  if (preset.fps + 0.01 < item.metadata.fps) filters.push(`fps=${preset.fps.toFixed(3)}`);
  const args = [
    ...commonStart(item.metadata.path),
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', String(Math.round(preset.videoBitrate)),
    '-maxrate', String(Math.round(preset.videoBitrate * 1.5)),
    '-bufsize', String(Math.round(preset.videoBitrate * 2)),
    '-pix_fmt', 'yuv420p', '-vf', filters.join(','),
  ];
  appendAudio(args, item.metadata, preset.audioBitrate, 0, 'source');
  return [...args, ...commonEnd(temporaryPath)];
}

function buildAdvancedArgs(metadata: VideoMetadata, input: AdvancedTranscodeSettings, inputPath: string, outputPath: string): string[] {
  const settings = normalizeAdvancedSettings(metadata, input);
  const issues = validateAdvancedSettings(metadata, settings);
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join(' '));

  const args = commonStart(inputPath);
  const isPreservingHdr = settings.colorMode === 'preserve-hdr';
  const filters = buildFilters(metadata, settings);
  args.push(
    '-c:v', settings.codec === 'h265' ? 'libx265' : 'libx264',
    '-preset', settings.speed,
    '-b:v', String(Math.round(settings.videoBitrate)),
    '-maxrate', String(Math.round(settings.videoBitrate * 1.5)),
    '-bufsize', String(Math.round(settings.videoBitrate * 2)),
  );

  if (settings.codec === 'h265') {
    args.push('-tag:v', 'hvc1', '-profile:v', isPreservingHdr ? 'main10' : 'main');
  } else {
    args.push('-profile:v', 'high');
  }
  args.push('-pix_fmt', isPreservingHdr ? 'yuv420p10le' : 'yuv420p');
  if (filters.length > 0) args.push('-vf', filters.join(','));
  appendColorMetadata(args, metadata, settings);
  appendAudio(args, metadata, settings.audioBitrate, settings.audioSampleRate, settings.audioChannelMode);
  return [...args, ...commonEnd(outputPath)];
}

function buildFilters(metadata: VideoMetadata, settings: AdvancedTranscodeSettings): string[] {
  const fpsFilter = settings.fps + 0.01 < metadata.fps ? `fps=${settings.fps.toFixed(3)}` : undefined;
  if (settings.colorMode === 'tone-map-sdr') {
    const inputPrimaries = validOr(metadata.colorPrimaries, ['bt2020', 'bt709', 'smpte432'], 'bt2020');
    const inputTransfer = validOr(metadata.colorTransfer, ['smpte2084', 'arib-std-b67'], metadata.hdrType === 'hlg' ? 'arib-std-b67' : 'smpte2084');
    const inputMatrix = validOr(metadata.colorSpace, ['bt2020nc', 'bt2020c', 'ictcp'], 'bt2020nc');
    const inputRange = ['pc', 'full'].includes(metadata.colorRange ?? '') ? 'full' : 'limited';
    const chain = [
      `setparams=color_primaries=${inputPrimaries}:color_trc=${inputTransfer}:colorspace=${inputMatrix}:range=${inputRange}`,
      `zscale=pin=${inputPrimaries}:tin=${inputTransfer}:min=${inputMatrix}:rin=${inputRange}:t=linear:m=gbr:npl=100`,
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=mobius:desat=0',
      `zscale=w=${settings.width}:h=${settings.height}:t=bt709:m=bt709:r=tv:filter=lanczos`,
      'format=yuv420p',
    ];
    if (fpsFilter) chain.push(fpsFilter);
    return chain;
  }
  const filters: string[] = [];
  if (settings.colorMode === 'preserve-hdr') {
    const inputPrimaries = validOr(metadata.colorPrimaries, ['bt2020', 'bt709', 'smpte432'], 'bt2020');
    const inputTransfer = validOr(metadata.colorTransfer, ['smpte2084', 'arib-std-b67'], metadata.hdrType === 'hlg' ? 'arib-std-b67' : 'smpte2084');
    const inputMatrix = validOr(metadata.colorSpace, ['bt2020nc', 'bt2020c', 'ictcp'], 'bt2020nc');
    const inputRange = ['pc', 'full'].includes(metadata.colorRange ?? '') ? 'full' : 'limited';
    filters.push(`setparams=color_primaries=${inputPrimaries}:color_trc=${inputTransfer}:colorspace=${inputMatrix}:range=${inputRange}`);
  }
  if (settings.width !== metadata.width || settings.height !== metadata.height) {
    filters.push(settings.colorMode === 'preserve-hdr'
      ? `zscale=w=${settings.width}:h=${settings.height}:filter=lanczos`
      : `scale=${settings.width}:${settings.height}:flags=lanczos`);
  }
  if (fpsFilter) filters.push(fpsFilter);
  return filters;
}

function validOr(value: string | undefined, allowed: string[], fallback: string): string {
  return value && allowed.includes(value) ? value : fallback;
}

function appendColorMetadata(args: string[], metadata: VideoMetadata, settings: AdvancedTranscodeSettings): void {
  if (settings.colorMode === 'tone-map-sdr') {
    args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
    return;
  }
  if (settings.colorMode === 'preserve-hdr') {
    args.push(
      '-color_primaries', metadata.colorPrimaries ?? 'bt2020',
      '-color_trc', metadata.colorTransfer ?? (metadata.hdrType === 'hlg' ? 'arib-std-b67' : 'smpte2084'),
      '-colorspace', metadata.colorSpace ?? 'bt2020nc',
      '-color_range', metadata.colorRange ?? 'tv',
    );
    const x265Params = [
      'hdr-opt=1',
      'repeat-headers=1',
      `colorprim=${x265Primaries(metadata.colorPrimaries)}`,
      `transfer=${metadata.hdrType === 'hlg' ? 18 : 16}`,
      `colormatrix=${x265Matrix(metadata.colorSpace)}`,
    ];
    const masterDisplay = x265MasterDisplay(metadata);
    if (masterDisplay) x265Params.push(`master-display=${masterDisplay}`);
    if (metadata.maxCll !== undefined || metadata.maxFall !== undefined) {
      x265Params.push(`max-cll=${metadata.maxCll ?? 0},${metadata.maxFall ?? 0}`);
    }
    args.push('-x265-params', x265Params.join(':'));
    return;
  }
  args.push(
    '-color_primaries', metadata.colorPrimaries ?? 'bt709',
    '-color_trc', metadata.colorTransfer ?? 'bt709',
    '-colorspace', metadata.colorSpace ?? 'bt709',
    '-color_range', metadata.colorRange ?? 'tv',
  );
}

function x265Primaries(value?: string): number {
  if (value === 'bt709') return 1;
  if (value === 'smpte432') return 12;
  return 9;
}

function x265Matrix(value?: string): number {
  if (value === 'bt2020c') return 10;
  if (value === 'ictcp') return 14;
  return 9;
}

function appendAudio(
  args: string[],
  metadata: VideoMetadata,
  audioBitrate: number,
  sampleRate: number,
  channelMode: AdvancedTranscodeSettings['audioChannelMode'] | 'source',
): void {
  if (!metadata.hasAudio) {
    args.push('-an');
    return;
  }
  args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', String(Math.round(audioBitrate)));
  if (sampleRate > 0) args.push('-ar', String(Math.round(sampleRate)));
  if (channelMode === 'mono') args.push('-ac', '1');
  if (channelMode === 'stereo') args.push('-ac', '2');
}

function rationalToScaledInteger(value: string | undefined, scale: number): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator = '1'] = value.split('/');
  const numeric = Number(numerator) / Number(denominator);
  return Number.isFinite(numeric) ? Math.round(numeric * scale) : undefined;
}

function coordinatePair(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const [x, y] = value.split(',');
  const scaledX = rationalToScaledInteger(x, 50_000);
  const scaledY = rationalToScaledInteger(y, 50_000);
  return scaledX !== undefined && scaledY !== undefined ? [scaledX, scaledY] : undefined;
}

function x265MasterDisplay(metadata: VideoMetadata): string | undefined {
  const mastering = metadata.masteringDisplay;
  if (!mastering) return undefined;
  const green = coordinatePair(mastering.green);
  const blue = coordinatePair(mastering.blue);
  const red = coordinatePair(mastering.red);
  const white = coordinatePair(mastering.whitePoint);
  const maxLuminance = rationalToScaledInteger(mastering.maxLuminance, 10_000);
  const minLuminance = rationalToScaledInteger(mastering.minLuminance, 10_000);
  if (!green || !blue || !red || !white || maxLuminance === undefined || minLuminance === undefined) return undefined;
  return `G(${green.join(',')})B(${blue.join(',')})R(${red.join(',')})WP(${white.join(',')})L(${maxLuminance},${minLuminance})`;
}
