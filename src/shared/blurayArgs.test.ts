import { describe, expect, it } from 'vitest';
import { buildBlurayFfmpegArgs } from './blurayArgs';
import type { BlurayTitle, BlurayTranscodeSettings } from './blurayTypes';

const title = { id:'1',playlistName:'00001.mpls',durationSeconds:1,sizeBytes:1,clips:[],chaptersSeconds:[],angleCount:1,
  video:{streamIndex:0,codec:'hevc',width:3840,height:2160,fps:24,hdrType:'hdr10' as const,colorPrimaries:'bt2020',colorTransfer:'smpte2084'},
  audioTracks:[],subtitleTracks:[],warnings:[] };
const settings: BlurayTranscodeSettings = { quality:'archival',videoCodec:'hevc',crf:16,preset:'slow',hdrMode:'preserve',audioStreamIndexes:[1],subtitleStreamIndexes:[2],externalSubtitles:[{path:'C:/字幕/中文.srt',name:'中文.srt',language:'zho',title:'中文',default:true,forced:false}],outputPath:'D:/电影.mkv' };

describe('蓝光 FFmpeg 参数', () => {
  it('不用 shell 且保留 HDR 标签、音轨和外部字幕', () => {
    const args=buildBlurayFfmpegArgs(title,settings,{concatPath:'C:/a list.txt',chaptersPath:'C:/chapters.txt',temporaryOutputPath:'D:/part.mkv'});
    expect(args).toContain('libx265'); expect(args).toContain('bt2020'); expect(args).toContain('C:/字幕/中文.srt');
    expect(args).toContain('-map_chapters'); expect(args.at(-1)).toBe('D:/part.mkv');
  });
  it('remux 不重新编码视频',()=>{const args=buildBlurayFfmpegArgs(title,{...settings,videoCodec:'copy',externalSubtitles:[]},{concatPath:'a',temporaryOutputPath:'b'});expect(args.slice(args.indexOf('-c:v'),args.indexOf('-c:v')+2)).toEqual(['-c:v','copy']);});
});
