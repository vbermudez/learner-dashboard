export type ResourceKind = 'h5p' | 'tincan' | 'scorm' | 'web' | 'media';

export type DownloadState = 'idle' | 'downloading' | 'downloaded' | 'error';

export type PlayerMode = 'media' | 'frame' | 'package';

export interface LearningResource {
  id: string;
  title: string;
  kind: ResourceKind;
  description: string;
  estimatedSize: string;
  packageUrl: string;
  launchUrl?: string;
  tags: string[];
}

export interface LearningResourceVm extends LearningResource {
  state: DownloadState;
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  cachedAt?: string;
  lastError?: string;
  retryAttempt?: number;
  nextRetryAt?: string;
  runtimeStatus?: 'idle' | 'analyzing' | 'detected' | 'unsupported' | 'error';
  runtimeMessage?: string;
  detectedLaunchPath?: string;
}

export interface PlayerSession {
  resourceId: string;
  title: string;
  kind: ResourceKind;
  mode: PlayerMode;
  sourceUrl: string;
  sourceOrigin: 'cached' | 'remote';
  hint?: string;
}
