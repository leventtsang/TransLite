# TransLite

TransLite 是面向普通用户的离线批量视频压缩工具。它使用 Electron 提供 Windows x64 与 Apple Silicon macOS 桌面界面，通过内嵌 FFmpeg 输出 MP4。

- 简单模式提供高画质、均衡压缩和极致压缩三档推荐，输出 H.264/AAC。
- 高级模式可查看完整的视频、HDR 色彩和音频参数，并调整 H.264/H.265、码率、分辨率、帧率、编码速度、HDR 保留/转 SDR、AAC 码率、采样率和声道。
- 高级推荐使用随分辨率、帧率、编码器和 HDR 状态变化的安全码率，低码率源视频不会再被默认建议继续降码率。

## 开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

开发运行前需按 [resources/ffmpeg/README.md](resources/ffmpeg/README.md) 放置当前平台的 FFmpeg 与 FFprobe。只检查界面构建时，可以运行：

```bash
SKIP_FFMPEG_CHECK=1 npm run build
```

## 验证

```bash
npm run typecheck
npm test
```

## 打包

准备全部平台二进制后执行：

```bash
npm run pack:win
npm run pack:mac
```

产物写入 `release/`。Windows 为便携 EXE；macOS 为未签名 APP 的 ZIP。未签名 macOS 应用首次打开时，需要在 Finder 中右键选择“打开”，或在“系统设置 → 隐私与安全性”中允许。

## 输出与隐私

- 所有分析和压缩均在本机完成，不上传视频。
- 输出保存在源视频目录，名称为 `原文件名_压缩.mp4`；重名时自动添加序号。
- 当前版本保留首个音轨，不保留字幕轨，且不会覆盖源文件。
