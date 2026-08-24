export type BlurayHdrType = 'sdr' | 'hdr10' | 'hlg' | 'dolby-vision' | 'unknown-hdr';
export type BlurayQuality = 'archival' | 'high' | 'balanced' | 'remux';
export type BlurayJobStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BlurayClip {
  id: string;
  path: string;
  inTicks: number;
  outTicks: number;
  durationSeconds: number;
  sizeBytes: number;
}

export interface BlurayVideoTrack {
  streamIndex: number;
  codec: string;
  profile?: string;
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  pixelFormat?: string;
  bitDepth?: number;
  hdrType: BlurayHdrType;
  dolbyVisionProfile?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  colorRange?: string;
  maxCll?: number;
  maxFall?: number;
  masteringDisplay?: string;
}

export interface BlurayAudioTrack {
  streamIndex: number;
  codec: string;
  profile?: string;
  language: string;
  title?: string;
  channels?: number;
  channelLayout?: string;
  sampleRate?: number;
  bitrate?: number;
  lossless: boolean;
  atmos: boolean;
}

export interface BluraySubtitleTrack {
  streamIndex: number;
  codec: string;
  language: string;
  title?: string;
  forced: boolean;
}

export interface BlurayTitle {
  id: string;
  playlistName: string;
  durationSeconds: number;
  sizeBytes: number;
  clips: BlurayClip[];
  chaptersSeconds: number[];
  angleCount: number;
  video: BlurayVideoTrack;
  audioTracks: BlurayAudioTrack[];
  subtitleTracks: BluraySubtitleTrack[];
  duplicateOf?: string;
  suspiciousLoop?: boolean;
  warnings: string[];
}

export interface BlurayAnalysis {
  rootPath: string;
  discName: string;
  titles: BlurayTitle[];
  recommendedTitleId: string;
  playlistCount: number;
  warnings: string[];
}

export interface ExternalSubtitle {
  path: string;
  name: string;
  language: string;
  title: string;
  default: boolean;
  forced: boolean;
}

export interface BlurayTranscodeSettings {
  quality: BlurayQuality;
  videoCodec: 'hevc' | 'copy';
  crf: number;
  preset: 'medium' | 'slow' | 'slower';
  hdrMode: 'preserve' | 'hdr10-base';
  audioStreamIndexes: number[];
  subtitleStreamIndexes: number[];
  externalSubtitles: ExternalSubtitle[];
  outputPath: string;
}

export interface BlurayRecommendation {
  settings: Omit<BlurayTranscodeSettings, 'externalSubtitles' | 'outputPath'>;
  label: string;
  summary: string;
  estimatedRatio?: [number, number];
  warnings: string[];
}

export interface BlurayProgress {
  status: BlurayJobStatus;
  progress: number;
  speed?: number;
  etaSeconds?: number;
  stage: string;
  outputPath?: string;
  error?: string;
  technicalLog?: string;
}

export type BlurayQueueEvent = { type: 'progress'; progress: BlurayProgress };

export interface BlurayApi {
  getSystemStatus(): Promise<{ ready: boolean; error?: string }>;
  selectBdmvFolder(): Promise<string | undefined>;
  selectSubtitleFiles(): Promise<string[]>;
  analyzeBdmv(path: string): Promise<BlurayAnalysis>;
  recommend(title: BlurayTitle): Promise<BlurayRecommendation>;
  chooseOutputPath(defaultName: string): Promise<string | undefined>;
  startTranscode(title: BlurayTitle, settings: BlurayTranscodeSettings): Promise<void>;
  cancelTranscode(): Promise<void>;
  openOutput(path: string): Promise<string>;
  showInFolder(path: string): Promise<void>;
  onQueueEvent(callback: (event: BlurayQueueEvent) => void): () => void;
}
