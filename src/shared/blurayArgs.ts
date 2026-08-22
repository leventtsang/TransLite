import type { BlurayTitle, BlurayTranscodeSettings } from './blurayTypes';

export interface BlurayInputFiles { concatPath: string; chaptersPath?: string; temporaryOutputPath: string; }

export function buildBlurayFfmpegArgs(title: BlurayTitle, settings: BlurayTranscodeSettings, files: BlurayInputFiles): string[] {
  const args = ['-y', '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', files.concatPath];
  settings.externalSubtitles.forEach((subtitle) => args.push('-i', subtitle.path));
  const chapterInput = files.chaptersPath ? 1 + settings.externalSubtitles.length : -1;
  if (files.chaptersPath) args.push('-f', 'ffmetadata', '-i', files.chaptersPath);
  args.push('-map', '0:v:0');
  settings.audioStreamIndexes.forEach((index) => args.push('-map', `0:${index}?`));
  settings.subtitleStreamIndexes.forEach((index) => args.push('-map', `0:${index}?`));
  settings.externalSubtitles.forEach((_subtitle, index) => args.push('-map', `${index + 1}:0`));
  if (settings.videoCodec === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', 'libx265', '-preset', settings.preset, '-crf', String(settings.crf), '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1');
    if (title.video.hdrType !== 'sdr') appendHdr(args, title);
  }
  args.push('-c:a', 'copy', '-c:s', 'copy', '-max_muxing_queue_size', '4096');
  if (chapterInput >= 0) args.push('-map_chapters', String(chapterInput));
  const externalOffset = settings.subtitleStreamIndexes.length;
  settings.externalSubtitles.forEach((subtitle, index) => {
    const outputIndex = externalOffset + index;
    args.push(`-metadata:s:s:${outputIndex}`, `language=${subtitle.language || 'und'}`);
    if (subtitle.title) args.push(`-metadata:s:s:${outputIndex}`, `title=${subtitle.title}`);
    if (subtitle.default) args.push(`-disposition:s:${outputIndex}`, 'default');
    if (subtitle.forced) args.push(`-disposition:s:${outputIndex}`, 'forced');
  });
  args.push('-metadata', `title=${title.playlistName}`, '-progress', 'pipe:1', '-nostats', files.temporaryOutputPath);
  return args;
}

function appendHdr(args: string[], title: BlurayTitle): void {
  const transfer = title.video.hdrType === 'hlg' ? 'arib-std-b67' : 'smpte2084';
  args.push(
    '-color_primaries', title.video.colorPrimaries ?? 'bt2020',
    '-color_trc', title.video.colorTransfer ?? transfer,
    '-colorspace', title.video.colorSpace ?? 'bt2020nc',
    '-color_range', title.video.colorRange ?? 'tv',
    '-x265-params', `hdr-opt=1:repeat-headers=1:colorprim=9:transfer=${title.video.hdrType === 'hlg' ? 18 : 16}:colormatrix=9${title.video.masteringDisplay ? `:master-display=${title.video.masteringDisplay}` : ''}${title.video.maxCll || title.video.maxFall ? `:max-cll=${title.video.maxCll ?? 0},${title.video.maxFall ?? 0}` : ''}`,
  );
}
