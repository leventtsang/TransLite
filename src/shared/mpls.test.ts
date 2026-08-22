import { describe, expect, it } from 'vitest';
import { parseMpls } from './mpls';

describe('MPLS 解析', () => {
  it('读取播放片段、时长与章节标记', () => {
    const data=Buffer.alloc(160); data.write('MPLS0200',0,'ascii'); data.writeUInt32BE(32,8); data.writeUInt32BE(100,16);
    data.writeUInt16BE(1,38); data.writeUInt16BE(0,40); data.writeUInt16BE(24,42);
    data.write('00001',44,'ascii'); data.write('M2TS',49,'ascii'); data[53]=0; data.writeUInt32BE(45_000,56); data.writeUInt32BE(135_000,60);
    data.writeUInt16BE(1,104); data[107]=1; data.writeUInt16BE(0,108); data.writeUInt32BE(90_000,110);
    const result=parseMpls(data); expect(result.clips[0].id).toBe('00001'); expect(result.durationSeconds).toBe(2); expect(result.chaptersSeconds).toEqual([1]);
  });
});
