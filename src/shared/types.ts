export type PresetId = 'quality' | 'balanced' | 'small';
export type JobStatus = 'probing' | 'ready' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type HdrType = 'sdr' | 'hdr10' | 'hlg' | 'dolby-vision' | 'unknown-hdr';
export type VideoCodecChoice = 'h264' | 'h265';
export type EncoderSpeed = 'fast' | 'medium' | 'slow';
export type ColorMode = 'sdr' | 'preserve-hdr' | 'tone-map-sdr';
export type ResolutionMode = 'source' | '2160p' | '1440p' | '1080p' | '720p' | 'custom';
export type FrameRateMode = 'source' | '60' | '50' | '30' | '25' | '24' | 'custom';
export type AudioChannelMode = 'source' | 'mono' | 'stereo';

export interface MasteringDisplayMetadata {
  red?: string;
  green?: string;
  blue?: string;
  whitePoint?: string;
  minLuminance?: string;
  maxLuminance?: string;
}

export interface VideoMetadata {
  path: string;
  name: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  nominalFps: number;
  videoCodec: string;
  videoProfile?: string;
  videoLevel?: number;
  videoCodecTag?: string;
  videoBitrate: number;
  pixelFormat?: string;
  videoBitDepth?: number;
  colorRange?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  chromaLocation?: string;
  fieldOrder?: string;
  hdrType: HdrType;
  masteringDisplay?: MasteringDisplayMetadata;
  maxCll?: number;
  maxFall?: number;
  dolbyVisionProfile?: number;
  audioCodec?: string;
  audioProfile?: string;
  audioBitrate?: number;
  audioSampleRate?: number;
  audioSampleFormat?: string;
  audioBitDepth?: number;
  audioChannels?: number;
  audioChannelLayout?: string;
  hasAudio: boolean;
  subtitleTracks: number;
  rotation: number;
}

export interface CompressionPreset {
  id: PresetId;
  label: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  estimatedSizeBytes: number;
  savingPercent: number;
  limitedBenefit: boolean;
}

export interface ProbedVideo {
  id: string;
  metadata: VideoMetadata;
  presets: CompressionPreset[];
  recommendedPresetId: PresetId;
  advancedRecommendation: AdvancedRecommendation;
}

export interface AdvancedTranscodeSettings {
  mode: 'advanced';
  codec: VideoCodecChoice;
  speed: EncoderSpeed;
  resolutionMode: ResolutionMode;
  width: number;
  height: number;
  frameRateMode: FrameRateMode;
  fps: number;
  videoBitrate: number;
  safeMinimumVideoBitrate: number;
  colorMode: ColorMode;
  audioBitrate: number;
  audioSampleRate: number;
  audioChannelMode: AudioChannelMode;
  audioChannels: number;
}

export interface AdvancedRecommendation {
  settings: AdvancedTranscodeSettings;
  compressionNotRecommended: boolean;
  reason?: string;
}

export interface SimpleTranscodeSettings {
  mode: 'simple';
  preset: CompressionPreset;
}

export type TranscodeSettings = SimpleTranscodeSettings | AdvancedTranscodeSettings;

export interface QueueItem {
  id: string;
  metadata: VideoMetadata;
  settings: TranscodeSettings;
}

export interface JobProgress {
  jobId: string;
  status: JobStatus;
  progress: number;
  queueProgress: number;
  speed?: number;
  etaSeconds?: number;
  outputPath?: string;
  error?: UserFacingError;
  technicalLog?: string;
}

export interface JobResult {
  jobId: string;
  status: 'completed' | 'failed' | 'cancelled';
  outputPath?: string;
  error?: UserFacingError;
}

export interface UserFacingError {
  code: string;
  title: string;
  message: string;
}

export type QueueEvent =
  | { type: 'queue-started'; totalJobs: number }
  | { type: 'job-progress'; progress: JobProgress }
  | { type: 'job-finished'; result: JobResult }
  | { type: 'queue-finished' };

export interface TransLiteApi {
  getSystemStatus(): Promise<{ ready: boolean; error?: string }>;
  selectVideos(): Promise<string[]>;
  pathsFromDroppedFiles(files: File[]): string[];
  probeVideos(paths: string[]): Promise<ProbedVideo[]>;
  startQueue(items: QueueItem[]): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
  removeJob(jobId: string): Promise<void>;
  openOutput(path: string): Promise<string>;
  showInFolder(path: string): Promise<void>;
  onQueueEvent(callback: (event: QueueEvent) => void): () => void;
}
