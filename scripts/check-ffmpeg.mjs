import { access, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.SKIP_FFMPEG_CHECK === '1') {
  console.log('已跳过 FFmpeg 二进制检查（仅适合界面或 CI 构建）。');
  process.exit(0);
}

const files = [
  ['resources/ffmpeg/win32-x64/ffmpeg.exe', false],
  ['resources/ffmpeg/win32-x64/ffprobe.exe', false],
  ['resources/ffmpeg/darwin-arm64/ffmpeg', true],
  ['resources/ffmpeg/darwin-arm64/ffprobe', true],
];

const missing = [];
for (const [relative, executable] of files) {
  const path = resolve(relative);
  try {
    await access(path, constants.F_OK);
    if (executable) {
      await chmod(path, 0o755);
      await access(path, constants.X_OK);
    }
  } catch {
    missing.push(relative);
  }
}

if (missing.length > 0) {
  console.error(`缺少 FFmpeg 文件：\n- ${missing.join('\n- ')}\n请按 resources/ffmpeg/README.md 放置二进制。`);
  process.exit(1);
}

console.log('FFmpeg/FFprobe 二进制检查通过。');
