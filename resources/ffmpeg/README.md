# FFmpeg 二进制放置说明

请在打包前放置以下四个文件：

```text
resources/ffmpeg/
├── win32-x64/
│   ├── ffmpeg.exe
│   └── ffprobe.exe
└── darwin-arm64/
    ├── ffmpeg
    └── ffprobe
```

要求：

- FFmpeg 必须包含 `libx264` 和 `aac` 编码器。
- macOS 文件必须支持 Apple Silicon；构建脚本会自动补充可执行权限。
- Windows 文件必须支持 x64。
- 请将所用构建版本和许可证补充到项目根目录的 `THIRD_PARTY_NOTICES.md`。
- 不要把来源不明或不允许再分发的二进制放入发布包。
