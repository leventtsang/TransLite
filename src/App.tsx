import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { copyAdvancedSettings, dimensionsForMode, estimateAdvancedSize, fpsForMode, normalizeAdvancedSettings, validateAdvancedSettings } from './shared/advanced';
import type {
  AdvancedTranscodeSettings, ColorMode, EncoderSpeed, FrameRateMode, JobProgress, JobStatus,
  PresetId, ProbedVideo, QueueEvent, QueueItem, ResolutionMode, UserFacingError, VideoCodecChoice,
} from './shared/types';

interface UiItem extends ProbedVideo {
  selectedPresetId: PresetId;
  advancedSettings: AdvancedTranscodeSettings;
  status: JobStatus;
  progress: number;
  speed?: number;
  etaSeconds?: number;
  outputPath?: string;
  error?: UserFacingError;
  technicalLog?: string;
}

type UiMode = 'simple' | 'advanced';

const statusText: Record<JobStatus, string> = {
  probing: '读取中', ready: '准备就绪', queued: '等待中', running: '压缩中',
  completed: '已完成', failed: '失败', cancelled: '已取消',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--';
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function updateProgress(item: UiItem, progress: JobProgress): UiItem {
  if (item.id !== progress.jobId) return item;
  return {
    ...item,
    status: progress.status,
    progress: progress.progress,
    speed: progress.speed,
    etaSeconds: progress.etaSeconds,
    outputPath: progress.outputPath ?? item.outputPath,
    error: progress.error,
    technicalLog: progress.technicalLog,
  };
}

function limitedBenefitMessage(preset: UiItem['presets'][number]): string {
  const result = preset.savingPercent > 0
    ? `预计可减少约 ${preset.savingPercent}%`
    : '预计压缩后的体积与原视频接近';
  if (preset.id === 'quality') {
    return `选择“高画质”后，${result}。这一档优先保留清晰度；如果希望文件明显变小，请选择“均衡压缩”或“极致压缩”。`;
  }
  if (preset.id === 'balanced') {
    return `选择“均衡压缩”后，${result}。如果还想缩小文件，可以选择“极致压缩”，但清晰度会进一步降低。`;
  }
  return `选择“极致压缩”后，${result}。这已经是最省空间的推荐档位；继续减小体积会明显影响清晰度。`;
}

export default function App() {
  const [items, setItems] = useState<UiItem[]>([]);
  const [probingCount, setProbingCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [queueProgress, setQueueProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [globalError, setGlobalError] = useState<string>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [mode, setMode] = useState<UiMode>('simple');

  useEffect(() => window.translite.onQueueEvent((event: QueueEvent) => {
    if (event.type === 'queue-started') {
      setRunning(true);
      return;
    }
    if (event.type === 'job-progress') {
      setQueueProgress(event.progress.queueProgress);
      setItems((current) => current.map((item) => updateProgress(item, event.progress)));
      return;
    }
    if (event.type === 'job-finished') {
      setItems((current) => current.map((item) => item.id === event.result.jobId
        ? { ...item, status: event.result.status, outputPath: event.result.outputPath ?? item.outputPath, error: event.result.error ?? item.error }
        : item));
      return;
    }
    setRunning(false);
    setQueueProgress(1);
  }), []);

  useEffect(() => {
    void window.translite.getSystemStatus().then((status) => {
      if (!status.ready && status.error) setGlobalError(`${status.error}\n请按 resources/ffmpeg/README.md 放置对应平台的 FFmpeg 与 FFprobe。`);
    });
  }, []);

  const addPaths = useCallback(async (paths: string[]) => {
    const known = new Set(items.map((item) => item.metadata.path));
    const unique = [...new Set(paths)].filter((path) => !known.has(path));
    if (unique.length === 0) return;
    setGlobalError(undefined);
    setProbingCount((count) => count + unique.length);
    const results = await Promise.allSettled(unique.map(async (path) => {
      const [video] = await window.translite.probeVideos([path]);
      return video;
    }));
    const successes: UiItem[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successes.push({
          ...result.value,
          selectedPresetId: result.value.recommendedPresetId,
          advancedSettings: structuredClone(result.value.advancedRecommendation.settings),
          status: 'ready',
          progress: 0,
        });
      } else {
        failures.push(`${unique[index]}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });
    setItems((current) => [...current, ...successes]);
    setProbingCount((count) => Math.max(0, count - unique.length));
    if (failures.length > 0) setGlobalError(failures.join('\n'));
  }, [items]);

  const selectFiles = async () => addPaths(await window.translite.selectVideos());

  const startQueue = async () => {
    const candidates = items.filter((item) => ['ready', 'failed', 'cancelled'].includes(item.status));
    if (candidates.length === 0) return;
    if (candidates.some((item) => item.metadata.subtitleTracks > 0)) {
      const accepted = window.confirm('部分视频包含字幕轨。首版压缩不会保留字幕，是否继续？');
      if (!accepted) return;
    }
    if (mode === 'advanced') {
      const invalid = candidates.flatMap((item) => validateAdvancedSettings(item.metadata, item.advancedSettings)
        .map((issue) => `${item.metadata.name}：${issue.message}`));
      if (invalid.length > 0) {
        setGlobalError(invalid.join('\n'));
        return;
      }
    }
    const queueItems: QueueItem[] = candidates.map((item) => ({
      id: item.id,
      metadata: item.metadata,
      settings: mode === 'simple'
        ? { mode: 'simple', preset: item.presets.find((preset) => preset.id === item.selectedPresetId)! }
        : structuredClone(item.advancedSettings),
    }));
    setGlobalError(undefined);
    setQueueProgress(0);
    setItems((current) => current.map((item) => candidates.some((candidate) => candidate.id === item.id)
      ? { ...item, status: 'queued', progress: 0, error: undefined, technicalLog: undefined }
      : item));
    try {
      await window.translite.startQueue(queueItems);
    } catch (error) {
      setRunning(false);
      setGlobalError(error instanceof Error ? error.message : String(error));
    }
  };

  const removeItem = async (id: string) => {
    try { await window.translite.removeJob(id); } catch { /* 尚未进入后端队列也可从界面移除 */ }
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const updateAdvanced = (id: string, patch: Partial<AdvancedTranscodeSettings>) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const adjustedPatch = patch.codec === 'h264' && item.advancedSettings.colorMode === 'preserve-hdr'
        ? { ...patch, colorMode: 'tone-map-sdr' as ColorMode }
        : patch;
      return { ...item, advancedSettings: normalizeAdvancedSettings(item.metadata, { ...item.advancedSettings, ...adjustedPatch }) };
    }));
  };

  const applyAdvancedToAll = (sourceId: string) => {
    setItems((current) => {
      const source = current.find((item) => item.id === sourceId);
      if (!source) return current;
      return current.map((item) => item.id === sourceId || item.status === 'completed'
        ? item
        : { ...item, advancedSettings: copyAdvancedSettings(source.advancedSettings, item.metadata) });
    });
  };

  const completed = items.filter((item) => item.status === 'completed').length;
  const hasStartable = items.some((item) => ['ready', 'failed', 'cancelled'].includes(item.status));
  const totalOriginal = useMemo(() => items.reduce((sum, item) => sum + item.metadata.sizeBytes, 0), [items]);
  const totalEstimated = useMemo(() => items.reduce((sum, item) => {
    if (mode === 'advanced') return sum + estimateAdvancedSize(item.metadata, item.advancedSettings);
    const preset = item.presets.find((option) => option.id === item.selectedPresetId);
    return sum + (preset?.estimatedSizeBytes ?? 0);
  }, 0), [items, mode]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div><strong>TransLite</strong><small>视频压缩</small></div>
        </div>
        <button className="ghost-button" onClick={() => setHelpOpen(true)}>使用帮助</button>
      </header>

      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">轻巧 · 离线 · 不上传</span>
            <h1>把大视频，轻松变小</h1>
            <p>自动分析视频并推荐合适参数。无需理解码率和编码器，也能放心压缩。</p>
          </div>
          {items.length > 0 && (
            <div className="summary-card">
              <span>预计总体积</span>
              <strong>{formatBytes(totalOriginal)} <i>→</i> {formatBytes(totalEstimated)}</strong>
              <small>估算值，复杂画面可能有所偏差</small>
            </div>
          )}
        </section>

        <div className="mode-switch" role="group" aria-label="压缩模式">
          <button className={mode === 'simple' ? 'active' : ''} disabled={running} onClick={() => setMode('simple')}>
            <strong>简单模式</strong><span>智能三档推荐</span>
          </button>
          <button className={mode === 'advanced' ? 'active' : ''} disabled={running} onClick={() => setMode('advanced')}>
            <strong>高级模式</strong><span>精细查看与调整参数</span>
          </button>
        </div>

        {globalError && <div className="global-error"><strong>有些内容未能处理</strong><pre>{globalError}</pre></div>}

        {items.length === 0 ? (
          <section
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addPaths(window.translite.pathsFromDroppedFiles([...event.dataTransfer.files]));
            }}
          >
            <div className="drop-icon">↓</div>
            <h2>{probingCount > 0 ? '正在读取视频信息…' : '选择要压缩的视频'}</h2>
            <p>拖放文件到这里，或从电脑中选择</p>
            <button className="primary-button" onClick={() => void selectFiles()} disabled={probingCount > 0}>选择视频文件</button>
            <small>支持 MP4、MOV、MKV、AVI、WebM 等常见格式</small>
          </section>
        ) : (
          <>
            <section
              className={`queue-panel ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault(); setDragging(false);
                void addPaths(window.translite.pathsFromDroppedFiles([...event.dataTransfer.files]));
              }}
            >
              <div className="queue-heading">
                <div><h2>压缩队列</h2><span>{items.length} 个视频{probingCount > 0 ? ` · ${probingCount} 个读取中` : ''}</span></div>
                <button className="add-button" onClick={() => void selectFiles()} disabled={running}>＋ 添加视频</button>
              </div>
              <div className="video-list">
                {items.map((item, index) => (
                  <VideoCard
                    key={item.id}
                    item={item}
                    index={index}
                    count={items.length}
                    queueRunning={running}
                    mode={mode}
                    onPreset={(presetId) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, selectedPresetId: presetId } : entry))}
                    onMove={(direction) => moveItem(index, direction)}
                    onRemove={() => void removeItem(item.id)}
                    onCancel={() => void window.translite.cancelJob(item.id)}
                    onRetry={() => void window.translite.retryJob(item.id)}
                    onAdvanced={(patch) => updateAdvanced(item.id, patch)}
                    onResetAdvanced={() => updateAdvanced(item.id, structuredClone(item.advancedRecommendation.settings))}
                    onApplyAll={() => applyAdvancedToAll(item.id)}
                  />
                ))}
              </div>
            </section>

            <footer className="action-bar">
              <div className="queue-total">
                {running ? <><span>总进度 · 已完成 {completed}/{items.length}</span><Progress value={queueProgress} /></> : <span>{completed > 0 ? `已完成 ${completed} 个视频` : '准备好后即可开始压缩'}</span>}
              </div>
              <button className="primary-button start-button" onClick={() => void startQueue()} disabled={running || probingCount > 0 || !hasStartable}>
                {running ? '正在压缩…' : '开始压缩'}
              </button>
            </footer>
          </>
        )}
      </main>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function VideoCard({ item, index, count, queueRunning, mode, onPreset, onMove, onRemove, onCancel, onRetry, onAdvanced, onResetAdvanced, onApplyAll }: {
  item: UiItem; index: number; count: number; queueRunning: boolean; mode: UiMode;
  onPreset: (id: PresetId) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void; onCancel: () => void; onRetry: () => void;
  onAdvanced: (patch: Partial<AdvancedTranscodeSettings>) => void; onResetAdvanced: () => void; onApplyAll: () => void;
}) {
  const preset = item.presets.find((option) => option.id === item.selectedPresetId)!;
  const [logOpen, setLogOpen] = useState(false);
  const isActive = item.status === 'running';
  const canEdit = !queueRunning && item.status !== 'completed';

  return (
    <article className={`video-card status-${item.status}`}>
      <div className="file-row">
        <div className="file-icon">▶</div>
        <div className="file-info">
          <h3 title={item.metadata.path}>{item.metadata.name}</h3>
          <p>{formatBytes(item.metadata.sizeBytes)} · {item.metadata.width}×{item.metadata.height} · {item.metadata.fps.toFixed(2)} fps · {formatDuration(item.metadata.durationSeconds)}</p>
        </div>
        <span className={`status-pill ${item.status}`}>{statusText[item.status]}</span>
        {canEdit && <div className="order-buttons"><button disabled={index === 0} onClick={() => onMove(-1)}>↑</button><button disabled={index === count - 1} onClick={() => onMove(1)}>↓</button></div>}
        {isActive ? <button className="text-button danger" onClick={onCancel}>取消</button> : canEdit ? <button className="icon-button" onClick={onRemove} aria-label="移除">×</button> : null}
      </div>

      {mode === 'simple' && item.status !== 'completed' && item.status !== 'failed' && (
        <div className="preset-grid">
          {item.presets.map((option) => (
            <button
              key={option.id}
              className={`preset-option ${item.selectedPresetId === option.id ? 'selected' : ''}`}
              disabled={!canEdit}
              onClick={() => onPreset(option.id)}
            >
              <span className="radio-dot" />
              <span><strong>{option.label}</strong><small>{option.width}×{option.height} · 约 {formatBytes(option.estimatedSizeBytes)}</small></span>
              <em>{option.limitedBenefit ? (option.savingPercent > 0 ? `约省 ${option.savingPercent}%` : '体积接近') : `省 ${option.savingPercent}%`}</em>
            </button>
          ))}
        </div>
      )}

      {mode === 'advanced' && item.status !== 'completed' && item.status !== 'failed' && (
        <AdvancedPanel
          item={item}
          disabled={!canEdit}
          onChange={onAdvanced}
          onReset={onResetAdvanced}
          onApplyAll={onApplyAll}
        />
      )}

      {isActive && (
        <div className="progress-detail">
          <Progress value={item.progress} />
          <div><span>{Math.round(item.progress * 100)}%</span><span>{item.speed ? `${item.speed.toFixed(2)}× · 剩余约 ${formatDuration(item.etaSeconds ?? 0)}` : '正在估算剩余时间…'}</span></div>
        </div>
      )}

      {item.status === 'completed' && item.outputPath && (
        <div className="result-row">
          <div><strong>压缩完成</strong><span>已保存到原视频所在文件夹</span></div>
          <button className="soft-button" onClick={() => void window.translite.openOutput(item.outputPath!)}>播放视频</button>
          <button className="soft-button" onClick={() => void window.translite.showInFolder(item.outputPath!)}>打开文件夹</button>
        </div>
      )}

      {item.status === 'failed' && (
        <div className="error-row">
          <div><strong>{item.error?.title ?? '压缩失败'}</strong><span>{item.error?.message}</span></div>
          {item.technicalLog && <button className="text-button" onClick={() => setLogOpen(!logOpen)}>{logOpen ? '收起日志' : '技术日志'}</button>}
          {!queueRunning && <button className="soft-button" onClick={onRetry}>重试</button>}
          {logOpen && <pre>{item.technicalLog}</pre>}
        </div>
      )}

      {item.metadata.subtitleTracks > 0 && canEdit && <div className="notice">检测到 {item.metadata.subtitleTracks} 条字幕轨，压缩后不会保留字幕。</div>}
      {mode === 'simple' && preset.limitedBenefit && canEdit && <div className="notice">{limitedBenefitMessage(preset)}</div>}
    </article>
  );
}

function AdvancedPanel({ item, disabled, onChange, onReset, onApplyAll }: {
  item: UiItem;
  disabled: boolean;
  onChange: (patch: Partial<AdvancedTranscodeSettings>) => void;
  onReset: () => void;
  onApplyAll: () => void;
}) {
  const settings = item.advancedSettings;
  const recommended = item.advancedRecommendation.settings;
  const issues = validateAdvancedSettings(item.metadata, settings);
  const estimatedSize = estimateAdvancedSize(item.metadata, settings);
  const saving = Math.round((1 - estimatedSize / item.metadata.sizeBytes) * 100);
  const belowSafeMinimum = settings.videoBitrate < settings.safeMinimumVideoBitrate;
  const isHdrSource = item.metadata.hdrType !== 'sdr';

  const changeResolution = (resolutionMode: ResolutionMode) => {
    const [width, height] = dimensionsForMode(item.metadata, resolutionMode, settings.width, settings.height);
    onChange({ resolutionMode, width, height });
  };
  const changeFrameRate = (frameRateMode: FrameRateMode) => {
    onChange({ frameRateMode, fps: fpsForMode(item.metadata, frameRateMode, settings.fps) });
  };

  return (
    <div className="advanced-panel">
      <div className="advanced-toolbar">
        <div><strong>高级参数</strong><span>源参数与转换值实时对照</span></div>
        <div><button className="text-button" disabled={disabled} onClick={onReset}>恢复全部建议</button><button className="soft-button" disabled={disabled} onClick={onApplyAll}>应用到全部</button></div>
      </div>

      <div className="advanced-columns">
        <section className="source-details">
          <h4>源视频信息</h4>
          <InfoGroup title="视频">
            <InfoRow label="编码" value={`${item.metadata.videoCodec.toUpperCase()}${item.metadata.videoProfile ? ` · ${item.metadata.videoProfile}` : ''}${item.metadata.videoLevel ? ` · Level ${(item.metadata.videoLevel / 10).toFixed(1)}` : ''}`} />
            <InfoRow label="尺寸" value={`${item.metadata.width}×${item.metadata.height}`} />
            <InfoRow label="帧率" value={`${item.metadata.fps.toFixed(3)} fps${Math.abs(item.metadata.nominalFps - item.metadata.fps) > 0.01 ? `（标称 ${item.metadata.nominalFps.toFixed(3)}）` : ''}`} />
            <InfoRow label="视频码率" value={formatBitrate(item.metadata.videoBitrate)} />
            <InfoRow label="像素格式" value={`${item.metadata.pixelFormat ?? '未知'}${item.metadata.videoBitDepth ? ` · ${item.metadata.videoBitDepth}-bit` : ''}`} />
            <InfoRow label="扫描方式" value={friendlyFieldOrder(item.metadata.fieldOrder)} />
            {item.metadata.rotation !== 0 && <InfoRow label="旋转" value={`${item.metadata.rotation}°（已按显示方向计算）`} />}
          </InfoGroup>
          <InfoGroup title="色彩与 HDR">
            <InfoRow label="动态范围" value={friendlyHdr(item.metadata.hdrType)} />
            <InfoRow label="色域" value={item.metadata.colorPrimaries ?? '未标记'} />
            <InfoRow label="传递函数" value={item.metadata.colorTransfer ?? '未标记'} />
            <InfoRow label="矩阵/范围" value={`${item.metadata.colorSpace ?? '未知'} · ${item.metadata.colorRange ?? '未知'}`} />
            {item.metadata.masteringDisplay && <InfoRow label="Mastering Display" value={`R ${item.metadata.masteringDisplay.red ?? '--'} · G ${item.metadata.masteringDisplay.green ?? '--'} · B ${item.metadata.masteringDisplay.blue ?? '--'} · W ${item.metadata.masteringDisplay.whitePoint ?? '--'}`} />}
            {item.metadata.masteringDisplay && <InfoRow label="母版亮度" value={`${item.metadata.masteringDisplay.minLuminance ?? '--'} – ${item.metadata.masteringDisplay.maxLuminance ?? '--'} cd/m²`} />}
            {(item.metadata.maxCll !== undefined || item.metadata.maxFall !== undefined) && <InfoRow label="亮度元数据" value={`MaxCLL ${item.metadata.maxCll ?? '--'} · MaxFALL ${item.metadata.maxFall ?? '--'}`} />}
            {item.metadata.dolbyVisionProfile !== undefined && <InfoRow label="Dolby Vision" value={`Profile ${item.metadata.dolbyVisionProfile}`} />}
          </InfoGroup>
          {item.metadata.hasAudio && <InfoGroup title="音频">
            <InfoRow label="编码" value={`${item.metadata.audioCodec?.toUpperCase() ?? '未知'}${item.metadata.audioProfile ? ` · ${item.metadata.audioProfile}` : ''}`} />
            <InfoRow label="码率" value={formatBitrate(item.metadata.audioBitrate ?? 0)} />
            <InfoRow label="采样" value={`${formatSampleRate(item.metadata.audioSampleRate)} · ${item.metadata.audioSampleFormat ?? '未知'}${item.metadata.audioBitDepth ? ` · ${item.metadata.audioBitDepth}-bit` : ''}`} />
            <InfoRow label="声道" value={`${item.metadata.audioChannels ?? '--'} · ${item.metadata.audioChannelLayout ?? '未知布局'}`} />
          </InfoGroup>}
        </section>

        <section className="advanced-settings">
          <h4>转换设置</h4>
          <div className="setting-grid">
            <SettingField disabled={disabled} label="视频编码" recommendation={`建议 ${recommended.codec === 'h265' ? 'H.265' : 'H.264'}`} onRecommendation={() => onChange({ codec: recommended.codec, colorMode: recommended.colorMode })}>
              <select disabled={disabled} value={settings.codec} onChange={(event) => onChange({ codec: event.target.value as VideoCodecChoice })}>
                <option value="h264">H.264 · 兼容性优先</option>
                <option value="h265">H.265 · 压缩率优先</option>
              </select>
            </SettingField>
            <SettingField disabled={disabled} label="编码速度" recommendation={`建议 ${friendlySpeed(recommended.speed)}`} onRecommendation={() => onChange({ speed: recommended.speed })}>
              <select disabled={disabled} value={settings.speed} onChange={(event) => onChange({ speed: event.target.value as EncoderSpeed })}>
                <option value="fast">较快</option><option value="medium">均衡</option><option value="slow">更省空间</option>
              </select>
            </SettingField>
            <SettingField disabled={disabled} label="分辨率" recommendation={`建议 ${recommended.width}×${recommended.height}`} onRecommendation={() => onChange({ resolutionMode: recommended.resolutionMode, width: recommended.width, height: recommended.height })}>
              <select disabled={disabled} value={settings.resolutionMode} onChange={(event) => changeResolution(event.target.value as ResolutionMode)}>
                <option value="source">跟随源视频</option><option value="2160p">2160p / 4K</option><option value="1440p">1440p</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="custom">自定义</option>
              </select>
              {settings.resolutionMode === 'custom' && <div className="inline-inputs"><input disabled={disabled} type="number" min="64" max="8192" step="2" value={settings.width} onChange={(event) => onChange({ width: Number(event.target.value) })} /><span>×</span><input disabled={disabled} type="number" min="64" max="8192" step="2" value={settings.height} onChange={(event) => onChange({ height: Number(event.target.value) })} /></div>}
            </SettingField>
            <SettingField disabled={disabled} label="帧率" recommendation={`建议 ${recommended.fps.toFixed(3)} fps`} onRecommendation={() => onChange({ frameRateMode: recommended.frameRateMode, fps: recommended.fps })}>
              <select disabled={disabled} value={settings.frameRateMode} onChange={(event) => changeFrameRate(event.target.value as FrameRateMode)}>
                <option value="source">跟随源视频</option><option value="60">60 fps</option><option value="50">50 fps</option><option value="30">30 fps</option><option value="25">25 fps</option><option value="24">24 fps</option><option value="custom">自定义</option>
              </select>
              {settings.frameRateMode === 'custom' && <div className="suffix-input"><input disabled={disabled} type="number" min="1" max="120" step="0.001" value={settings.fps} onChange={(event) => onChange({ fps: Number(event.target.value) })} /><span>fps</span></div>}
            </SettingField>
            <SettingField disabled={disabled} wide label="视频码率" recommendation={`建议 ${formatBitrate(recommended.videoBitrate)}`} onRecommendation={() => onChange({ videoBitrate: recommended.videoBitrate })}>
              <div className="suffix-input"><input disabled={disabled} type="number" min={settings.codec === 'h264' ? 0.3 : 0.25} max="200" step="0.1" value={Number((settings.videoBitrate / 1_000_000).toFixed(3))} onChange={(event) => onChange({ videoBitrate: Number(event.target.value) * 1_000_000 })} /><span>Mbps</span></div>
              <small className={belowSafeMinimum ? 'unsafe' : ''}>当前规格安全参考值：{formatBitrate(settings.safeMinimumVideoBitrate)}</small>
            </SettingField>
            <SettingField disabled={disabled} wide label="色彩处理" recommendation={`建议 ${friendlyColor(recommended.colorMode)}`} onRecommendation={() => onChange({ colorMode: recommended.colorMode, codec: recommended.codec })}>
              <select disabled={disabled} value={settings.colorMode} onChange={(event) => onChange({ colorMode: event.target.value as ColorMode })}>
                {!isHdrSource && <option value="sdr">保持 SDR 色彩</option>}
                {isHdrSource && <><option value="preserve-hdr">保留原 HDR</option><option value="tone-map-sdr">转换为 SDR BT.709</option></>}
              </select>
            </SettingField>
          </div>

          {item.metadata.hasAudio && <><h4 className="audio-heading">音频设置 <span>位深仅展示，AAC 不单独设置位深</span></h4><div className="setting-grid audio-grid">
            <SettingField disabled={disabled} label="AAC 码率" recommendation={`建议 ${formatBitrate(recommended.audioBitrate)}`} onRecommendation={() => onChange({ audioBitrate: recommended.audioBitrate })}>
              <div className="suffix-input"><input disabled={disabled} type="number" min="32" max="512" step="1" value={Math.round(settings.audioBitrate / 1000)} onChange={(event) => onChange({ audioBitrate: Number(event.target.value) * 1000 })} /><span>kbps</span></div>
            </SettingField>
            <SettingField disabled={disabled} label="采样率" recommendation={`建议 ${formatSampleRate(recommended.audioSampleRate)}`} onRecommendation={() => onChange({ audioSampleRate: recommended.audioSampleRate })}>
              <select disabled={disabled} value={settings.audioSampleRate} onChange={(event) => onChange({ audioSampleRate: Number(event.target.value) })}>
                {item.metadata.audioSampleRate && ![32000, 44100, 48000].includes(item.metadata.audioSampleRate) && <option value={item.metadata.audioSampleRate}>跟随源视频（{formatSampleRate(item.metadata.audioSampleRate)}）</option>}
                <option value="32000">32 kHz</option><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option>
              </select>
            </SettingField>
            <SettingField disabled={disabled} wide label="声道" recommendation={`建议 ${friendlyChannels(recommended.audioChannelMode, recommended.audioChannels)}`} onRecommendation={() => onChange({ audioChannelMode: recommended.audioChannelMode, audioChannels: recommended.audioChannels })}>
              <select disabled={disabled} value={settings.audioChannelMode} onChange={(event) => onChange({ audioChannelMode: event.target.value as AdvancedTranscodeSettings['audioChannelMode'] })}>
                <option value="source">跟随源视频（{item.metadata.audioChannels ?? 2} 声道）</option><option value="mono">单声道</option><option value="stereo">立体声</option>
              </select>
            </SettingField>
          </div></>}

          <div className="advanced-estimate"><span>预计输出</span><strong>{formatBytes(estimatedSize)}</strong><em>{saving > 0 ? `约节省 ${saving}%` : '可能比原文件更大'}</em></div>
        </section>
      </div>

      {item.advancedRecommendation.compressionNotRecommended && <div className="notice advanced-warning">{item.advancedRecommendation.reason}</div>}
      {belowSafeMinimum && <div className="notice danger-notice">当前视频码率低于此分辨率和帧率的安全参考值，继续压缩可能出现明显马赛克或细节损失。</div>}
      {item.metadata.hdrType === 'dolby-vision' && <div className="notice">Dolby Vision 动态元数据不会保留；有兼容基础层时按 HDR10 输出，否则建议转换为 SDR。</div>}
      {issues.length > 0 && <div className="validation-list">{issues.map((issue, index) => <span key={`${issue.field}-${index}`}>{issue.message}</span>)}</div>}
    </div>
  );
}

function InfoGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="info-group"><strong>{title}</strong>{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><b>{value}</b></div>;
}

function SettingField({ label, recommendation, onRecommendation, disabled = false, wide = false, children }: {
  label: string; recommendation: string; onRecommendation: () => void; disabled?: boolean; wide?: boolean; children: ReactNode;
}) {
  return <label className={`setting-field ${wide ? 'wide' : ''}`}><span><b>{label}</b><button type="button" disabled={disabled} onClick={onRecommendation}>{recommendation}</button></span>{children}</label>;
}

function formatBitrate(bitrate: number): string {
  if (!bitrate) return '--';
  return bitrate >= 1_000_000 ? `${(bitrate / 1_000_000).toFixed(2)} Mbps` : `${Math.round(bitrate / 1000)} kbps`;
}

function formatSampleRate(rate?: number): string {
  if (!rate) return '--';
  return `${Number((rate / 1000).toFixed(1))} kHz`;
}

function friendlyHdr(value: UiItem['metadata']['hdrType']): string {
  return ({ sdr: 'SDR', hdr10: 'HDR10 / PQ', hlg: 'HLG', 'dolby-vision': 'Dolby Vision', 'unknown-hdr': 'HDR（类型未知）' })[value];
}

function friendlyColor(value: ColorMode): string {
  return ({ sdr: '保持 SDR', 'preserve-hdr': '保留原 HDR', 'tone-map-sdr': '转换为 SDR BT.709' })[value];
}

function friendlySpeed(value: EncoderSpeed): string {
  return ({ fast: '较快', medium: '均衡', slow: '更省空间' })[value];
}

function friendlyChannels(mode: AdvancedTranscodeSettings['audioChannelMode'], channels: number): string {
  if (mode === 'mono') return '单声道';
  if (mode === 'stereo') return '立体声';
  return `跟随源视频（${channels} 声道）`;
}

function friendlyFieldOrder(value?: string): string {
  if (!value || value === 'unknown') return '未知';
  if (value === 'progressive') return '逐行扫描';
  return `隔行扫描 · ${value}`;
}

function Progress({ value }: { value: number }) {
  return <div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="help-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">使用帮助</span>
        <h2>三步完成视频压缩</h2>
        <ol>
          <li><strong>添加视频</strong><span>选择或拖入一个或多个本地视频，文件不会上传。</span></li>
          <li><strong>选择档位</strong><span>默认的“均衡压缩”适合大多数情况；分享视频可选择“极致压缩”。</span></li>
          <li><strong>开始压缩</strong><span>输出文件保存在原目录，名称带“_压缩”，不会覆盖原文件。</span></li>
        </ol>
        <div className="mac-note"><strong>macOS 首次打开</strong><p>未签名绿色版可能被系统拦截。请在 Finder 中右键应用并选择“打开”，或到“系统设置 → 隐私与安全性”中允许。</p></div>
        <button className="primary-button" onClick={onClose}>知道了</button>
      </section>
    </div>
  );
}
