# TransLite Blu-ray

Windows x64 蓝光原盘收藏级转码工具。读取完整 BDMV 目录和 MPLS 播放列表，识别主影片、分支片段、章节、HDR/杜比视界、无损音轨与 PGS 字幕，输出单个 MKV。

## 处理策略

- 默认使用 `libx265` 10-bit、CRF 16、slow，保持原分辨率与帧率。
- HDR10/HLG 保留 BT.2020、传递函数、Mastering Display、MaxCLL/MaxFALL 等静态 HDR 信息。
- Dolby Vision Profile 7 重编码默认保留 HDR10 基础层；不声称保留动态元数据或增强层。需要完整保留 Dolby Vision 时请选择“无损封装”。
- TrueHD/Atmos、DTS-HD MA、LPCM 等音轨直接复制。
- 原盘 PGS 字幕直接复制；还可添加 SRT、ASS、SSA、SUP 外部字幕并写入语言、默认及强制标记。
- 使用 MPLS 入点/出点连接 M2TS 片段并生成章节；不会修改原盘文件。

## 开发与验证

需要 Node.js 20+，并在 `resources/ffmpeg/win32-x64/` 放置静态版 `ffmpeg.exe` 和 `ffprobe.exe`。该构建必须包含 `libx265`。

```bash
npm install
npm run dev
npm test
npm run typecheck
```

开发机非 Windows 时只能完成编译与打包检查，实际原盘读取和转码请在 Windows x64 测试。

## 打包

```bash
npm run pack:win
```

便携版输出为 `release/TransLite-BluRay-0.2.0-Windows-x64.exe`。FFmpeg 的许可证及构建来源应随发布包提供；如使用 GPL 构建及 libx265，请遵守相应再分发条款。
