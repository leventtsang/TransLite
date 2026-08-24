import { describe, expect, it } from 'vitest';
import { parseMpls, ticksBetween } from './mpls';

interface TestClip { id?: string; inTicks: number; outTicks: number }

function mpls(clips: TestClip[], chapter?: { item: number; ticks: number }): Buffer {
  const playlistStart = 32;
  const marksStart = playlistStart + 10 + clips.length * 26;
  const data = Buffer.alloc(marksStart + (chapter ? 20 : 0));
  data.write('MPLS0200', 0, 'ascii');
  data.writeUInt32BE(playlistStart, 8);
  data.writeUInt32BE(chapter ? marksStart : 0, 16);
  data.writeUInt32BE(6 + clips.length * 26, playlistStart);
  data.writeUInt16BE(clips.length, playlistStart + 6);
  clips.forEach((clip, index) => {
    const position = playlistStart + 10 + index * 26;
    data.writeUInt16BE(24, position);
    data.write(clip.id ?? String(index + 1).padStart(5, '0'), position + 2, 'ascii');
    data.write('M2TS', position + 7, 'ascii');
    data.writeUInt32BE(clip.inTicks >>> 0, position + 14);
    data.writeUInt32BE(clip.outTicks >>> 0, position + 18);
  });
  if (chapter) {
    data.writeUInt32BE(16, marksStart);
    data.writeUInt16BE(1, marksStart + 4);
    data[marksStart + 7] = 1;
    data.writeUInt16BE(chapter.item, marksStart + 8);
    data.writeUInt32BE(chapter.ticks >>> 0, marksStart + 10);
  }
  return data;
}

describe('MPLS 解析', () => {
  it('读取播放片段、时长与章节标记', () => {
    const result = parseMpls(mpls([{ inTicks: 45_000, outTicks: 135_000 }], { item: 0, ticks: 90_000 }));
    expect(result.clips[0].id).toBe('00001');
    expect(result.durationSeconds).toBe(2);
    expect(result.chaptersSeconds).toEqual([1]);
    expect(result.suspiciousLoop).toBe(false);
  });

  it('按 uint32 回卷计算跨界时间，避免正常影片显示为 0', () => {
    const start = 0xffff0000;
    const end = (start + 2 * 60 * 60 * 45_000) >>> 0;
    expect(ticksBetween(start, end)).toBe(2 * 60 * 60 * 45_000);
    expect(parseMpls(mpls([{ inTicks: start, outTicks: end }])).durationSeconds).toBe(7200);
  });

  it('把超长重复播放列表标记为循环异常', () => {
    const repeated = Array.from({ length: 60 }, () => ({ id: '00001', inTicks: 0, outTicks: 30 * 60 * 45_000 }));
    const result = parseMpls(mpls(repeated));
    expect(result.durationSeconds).toBe(30 * 60 * 60);
    expect(result.maxPlayItemRepeats).toBe(60);
    expect(result.suspiciousLoop).toBe(true);
  });
});
