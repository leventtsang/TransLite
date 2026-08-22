export interface ParsedMplsClip {
  id: string;
  codecId: string;
  inTicks: number;
  outTicks: number;
}

export interface ParsedMpls {
  clips: ParsedMplsClip[];
  chaptersSeconds: number[];
  durationSeconds: number;
  angleCount: number;
}

export function parseMpls(buffer: Uint8Array): ParsedMpls {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (ascii(buffer, 0, 4) !== 'MPLS' || buffer.byteLength < 32) throw new Error('不是有效的 MPLS 播放列表');
  const playlistStart = view.getUint32(8);
  const marksStart = view.getUint32(16);
  if (playlistStart + 10 > buffer.byteLength) throw new Error('MPLS 播放列表数据不完整');
  const itemCount = view.getUint16(playlistStart + 6);
  let position = playlistStart + 10;
  const clips: ParsedMplsClip[] = [];
  let angleCount = 1;
  for (let index = 0; index < itemCount; index += 1) {
    if (position + 2 > buffer.byteLength) break;
    const length = view.getUint16(position);
    const body = position + 2;
    if (body + length > buffer.byteLength || length < 20) break;
    const id = ascii(buffer, body, 5);
    const codecId = ascii(buffer, body + 5, 4);
    const flags = buffer[body + 9] ?? 0;
    const inTicks = view.getUint32(body + 12);
    const outTicks = view.getUint32(body + 16);
    if (/^\d{5}$/.test(id) && outTicks > inTicks) clips.push({ id, codecId, inTicks, outTicks });
    if ((flags & 0x10) !== 0 && body + 35 < buffer.byteLength) angleCount = Math.max(angleCount, buffer[body + 34] ?? 1);
    position = body + length;
  }
  const offsets: number[] = [];
  let accumulated = 0;
  for (const clip of clips) {
    offsets.push(accumulated);
    accumulated += (clip.outTicks - clip.inTicks) / 45_000;
  }
  const chaptersSeconds: number[] = [];
  if (marksStart > 0 && marksStart + 6 <= buffer.byteLength) {
    const markCount = view.getUint16(marksStart + 4);
    let markPosition = marksStart + 6;
    for (let index = 0; index < markCount && markPosition + 14 <= buffer.byteLength; index += 1, markPosition += 14) {
      const markType = buffer[markPosition + 1];
      const itemIndex = view.getUint16(markPosition + 2);
      const timestamp = view.getUint32(markPosition + 4);
      const clip = clips[itemIndex];
      if (markType === 1 && clip && timestamp >= clip.inTicks) {
        chaptersSeconds.push((offsets[itemIndex] ?? 0) + (timestamp - clip.inTicks) / 45_000);
      }
    }
  }
  return { clips, chaptersSeconds: [...new Set(chaptersSeconds.map((value) => Math.max(0, value)))], durationSeconds: accumulated, angleCount };
}

function ascii(buffer: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...buffer.slice(start, start + length));
}
