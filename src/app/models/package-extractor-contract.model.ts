export type ExtractorManifestType = 'h5p' | 'scorm' | 'tincan' | 'unknown';

export interface ExtractPackageRequest {
  resourceId: string;
  resourceKind: string;
  originalUrl?: string;
  packageBlob: Blob;
  fileName: string;
}

export interface LaunchCandidate {
  path: string;
  url?: string;
  score?: number;
}

export interface ExtractPackageResponse {
  packageId: string;
  contentBaseUrl: string;
  manifestType: ExtractorManifestType;
  recommendedLaunchPath?: string;
  recommendedLaunchUrl?: string;
  launchCandidates?: LaunchCandidate[];
  expiresAt?: string;
}
