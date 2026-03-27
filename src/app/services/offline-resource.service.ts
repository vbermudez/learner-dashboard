import { inject, Injectable, computed, signal } from '@angular/core';
import JSZip from 'jszip';
import { RESOURCE_CATALOG } from '../data/resource-catalog';
import { ExtractPackageResponse } from '../models/package-extractor-contract.model';
import {
  DownloadState,
  LearningResourceVm,
  PlayerSession,
  ResourceKind,
} from '../models/learning-resource.model';
import { PackageExtractorApiService } from './package-extractor-api.service';

interface PersistedResourceState {
  id: string;
  state: DownloadState;
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  cachedAt?: string;
  packageUrl: string;
  launchUrl?: string;
}

interface RetryQueueEntry {
  id: string;
  attempt: number;
  nextRetryAt: number;
  lastError: string;
}

interface RuntimeDetectionResult {
  status: 'detected' | 'unsupported' | 'error';
  message: string;
  launchPath?: string;
  launchUrl?: string;
}

@Injectable({
  providedIn: 'root',
})
export class OfflineResourceService {
  private readonly cacheName = 'learner-resource-cache-v1';
  private readonly runtimeCacheName = 'learner-runtime-cache-v1';
  private readonly stateStorageKey = 'learner-resource-state-v1';
  private readonly retryStorageKey = 'learner-resource-retry-v1';
  private readonly activeExtractedResourceKey = 'learner-active-runtime-v1';
  private readonly maxRetryAttempts = 4;
  private readonly baseRetryDelayMs = 8_000;
  private readonly maxRetryDelayMs = 120_000;

  private activeBlobUrl: string | undefined;
  private readonly extractorApiService = inject(PackageExtractorApiService);
  private readonly retryQueueSignal = signal<Record<string, RetryQueueEntry>>({});
  private readonly resourcesSignal = signal<LearningResourceVm[]>(
    RESOURCE_CATALOG.map((item) => ({
      ...item,
      state: 'idle',
      progress: 0,
      downloadedBytes: 0,
      runtimeStatus: 'idle',
    })),
  );

  readonly resources = computed(() => this.resourcesSignal());
  readonly totalResources = computed(() => this.resourcesSignal().length);
  readonly downloadedResources = computed(
    () => this.resourcesSignal().filter((item) => item.state === 'downloaded').length,
  );
  readonly online = signal(navigator.onLine);
  readonly activePlayer = signal<PlayerSession | null>(null);

  constructor() {
    window.addEventListener('online', () => {
      this.online.set(true);
      void this.processRetryQueue();
    });
    window.addEventListener('offline', () => this.online.set(false));

    this.restoreFromStorage();
    this.restoreRetryQueue();

    setInterval(() => {
      void this.processRetryQueue();
    }, 15_000);

    void this.processRetryQueue();
  }

  updateResourceUrl(resourceId: string, field: 'packageUrl' | 'launchUrl', value: string): void {
    this.resourcesSignal.update((items) =>
      items.map((item) => {
        if (item.id !== resourceId) {
          return item;
        }

        const nextItem: LearningResourceVm = { ...item, [field]: value.trim() };
        if (field === 'packageUrl') {
          nextItem.runtimeStatus = 'idle';
          nextItem.runtimeMessage = undefined;
          nextItem.detectedLaunchPath = undefined;
          void this.clearExtractedRuntime(resourceId);
        }

        return nextItem;
      }),
    );
    this.persistState();
  }

  async detectRuntimeAdapter(resourceId: string): Promise<void> {
    const resource = this.resourcesSignal().find((item) => item.id === resourceId);
    if (!resource) {
      return;
    }

    if (resource.kind === 'media' || resource.kind === 'web') {
      this.updateResource(resourceId, {
        runtimeStatus: 'unsupported',
        runtimeMessage: 'Runtime adapter is only needed for H5P, SCORM, and TinCan packages.',
        detectedLaunchPath: undefined,
      });
      return;
    }

    if (!resource.packageUrl) {
      this.updateResource(resourceId, {
        runtimeStatus: 'error',
        runtimeMessage: 'Set a package URL before running runtime detection.',
        detectedLaunchPath: undefined,
      });
      return;
    }

    this.updateResource(resourceId, {
      runtimeStatus: 'analyzing',
      runtimeMessage: 'Inspecting package manifest and launch files...',
      detectedLaunchPath: undefined,
    });

    const result = await this.detectRuntimeFromSource(resource);
    this.updateResource(resourceId, {
      runtimeStatus: result.status,
      runtimeMessage: result.message,
      detectedLaunchPath: result.launchPath,
      launchUrl: result.launchUrl ?? resource.launchUrl,
    });
  }

  async processPackageExtractor(resourceId: string): Promise<void> {
    const resource = this.resourcesSignal().find((item) => item.id === resourceId);
    if (!resource) {
      return;
    }

    if (!this.requiresRuntimeAdapter(resource.kind)) {
      this.updateResource(resourceId, {
        runtimeStatus: 'unsupported',
        runtimeMessage: 'Extractor flow is only for H5P, SCORM, and TinCan resources.',
      });
      return;
    }

    if (!resource.packageUrl) {
      this.updateResource(resourceId, {
        runtimeStatus: 'error',
        runtimeMessage: 'Set a package URL before preparing runtime.',
      });
      return;
    }

    this.updateResource(resourceId, {
      runtimeStatus: 'analyzing',
      runtimeMessage: 'Uploading package to extractor backend...',
      detectedLaunchPath: undefined,
    });

    try {
      const packageBlob = await this.getPackageBlob(resource);
      const extraction = await this.extractorApiService.extractPackage({
        resourceId: resource.id,
        resourceKind: resource.kind,
        originalUrl: resource.packageUrl,
        packageBlob,
        fileName: this.filenameFromUrl(resource.packageUrl),
      });

      const resolvedLaunchUrl = this.resolveLaunchFromExtractor(extraction);

      this.updateResource(resourceId, {
        runtimeStatus: resolvedLaunchUrl ? 'detected' : 'unsupported',
        runtimeMessage: resolvedLaunchUrl
          ? 'Extractor runtime is ready. Launch URL auto-filled from backend response.'
          : 'Extractor processed package but did not return a launch URL.',
        detectedLaunchPath: extraction.recommendedLaunchPath,
        launchUrl: resolvedLaunchUrl ?? resource.launchUrl,
      });
    } catch (error: unknown) {
      this.updateResource(resourceId, {
        runtimeStatus: 'error',
        runtimeMessage: error instanceof Error ? error.message : 'Extractor request failed.',
      });
    }
  }

  applyDetectedLaunch(resourceId: string): void {
    const resource = this.resourcesSignal().find((item) => item.id === resourceId);
    if (!resource?.detectedLaunchPath || !resource.packageUrl) {
      return;
    }

    const resolvedLaunchUrl = this.resolveLaunchUrl(resource.packageUrl, resource.detectedLaunchPath, false);
    if (!resolvedLaunchUrl) {
      this.updateResource(resourceId, {
        runtimeStatus: 'unsupported',
        runtimeMessage:
          'Launch path detected, but URL cannot be auto-applied for zipped packages. Host extracted files and set Launch URL manually.',
      });
      return;
    }

    this.updateResource(resourceId, {
      launchUrl: resolvedLaunchUrl,
      runtimeStatus: 'detected',
      runtimeMessage: `Launch URL auto-filled from detected path: ${resource.detectedLaunchPath}`,
    });
  }

  async downloadResource(resourceId: string, trigger: 'manual' | 'retry' = 'manual'): Promise<void> {
    const resource = this.resourcesSignal().find((item) => item.id === resourceId);
    if (!resource || !resource.packageUrl) {
      this.updateResource(resourceId, {
        state: 'error',
        lastError: 'Add a package URL before downloading.',
      });
      return;
    }

    if (trigger === 'manual') {
      this.clearRetry(resourceId);
    }

    this.updateResource(resourceId, {
      state: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: undefined,
      lastError: undefined,
    });

    try {
      const response = await fetch(resource.packageUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const totalBytes = Number(response.headers.get('content-length') ?? 0) || undefined;
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const downloadedBlob = await this.streamToBlob(resourceId, response, totalBytes, contentType);

      const cache = await caches.open(this.cacheName);
      const cacheKey = this.cacheKey(resourceId);
      await cache.put(
        cacheKey,
        new Response(downloadedBlob, {
          headers: new Headers({
            'content-type': contentType,
            'x-resource-id': resourceId,
          }),
        }),
      );
      await this.clearExtractedRuntime(resourceId);

      this.updateResource(resourceId, {
        state: 'downloaded',
        progress: 100,
        downloadedBytes: downloadedBlob.size,
        totalBytes: totalBytes ?? downloadedBlob.size,
        cachedAt: new Date().toISOString(),
        lastError: undefined,
      });
      this.clearRetry(resourceId);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown download error.';
      const retryAt = this.maybeQueueRetry(resourceId, error, errorMessage);

      this.updateResource(resourceId, {
        state: 'error',
        lastError: retryAt
          ? `${errorMessage}. Auto retry scheduled at ${new Date(retryAt).toLocaleTimeString()}.`
          : errorMessage,
      });
    }
  }

  async removeDownload(resourceId: string): Promise<void> {
    const cache = await caches.open(this.cacheName);
    await cache.delete(this.cacheKey(resourceId));
    await this.clearExtractedRuntime(resourceId);

    this.updateResource(resourceId, {
      state: 'idle',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: undefined,
      cachedAt: undefined,
      lastError: undefined,
    });

    this.clearRetry(resourceId);

    if (this.activePlayer()?.resourceId === resourceId) {
      this.closePlayer();
    }
  }

  async openResource(resourceId: string): Promise<void> {
    const resource = this.resourcesSignal().find((item) => item.id === resourceId);
    if (!resource) {
      return;
    }

    const cachedResponse = resource.state === 'downloaded' ? await this.getCachedResource(resourceId) : undefined;
    const playerSession = await this.buildPlayerSession(resource, cachedResponse);
    if (!playerSession) {
      this.updateResource(resourceId, {
        state: 'error',
        lastError: 'No playable source found. Add Package URL or Launch URL.',
      });
      return;
    }

    this.setActivePlayer(playerSession);
  }

  openActivePlayerInNewTab(): void {
    const player = this.activePlayer();
    if (!player?.sourceUrl) {
      return;
    }

    window.open(player.sourceUrl, '_blank', 'noopener,noreferrer');
  }

  closePlayer(): void {
    this.activePlayer.set(null);
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = undefined;
    }
  }

  retryTimeLabel(nextRetryAt?: string): string {
    if (!nextRetryAt) {
      return '';
    }

    const retryDate = new Date(nextRetryAt);
    return Number.isNaN(retryDate.getTime()) ? '' : retryDate.toLocaleTimeString();
  }

  formatBytes(bytes: number): string {
    if (bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private async detectRuntimeFromSource(resource: LearningResourceVm): Promise<RuntimeDetectionResult> {
    try {
      const cachedResponse = resource.state === 'downloaded' ? await this.getCachedResource(resource.id) : undefined;
      const response =
        cachedResponse ??
        (await fetch(resource.packageUrl, {
          cache: 'no-store',
        }));

      if (!response.ok) {
        return {
          status: 'error',
          message: `Runtime detection failed: ${response.status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const blob = await response.blob();
      const isZipPayload = this.isZipBlob(resource.packageUrl, contentType, blob);

      if (!isZipPayload) {
        const directLaunch = resource.launchUrl || resource.packageUrl;
        return {
          status: 'detected',
          message: 'Package appears to be a direct web resource. Launch URL set from package URL.',
          launchPath: this.filenameFromUrl(directLaunch),
          launchUrl: directLaunch,
        };
      }

      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const detection = await this.detectLaunchPathFromZip(resource.kind, zip);
      if (!detection.launchPath) {
        return {
          status: 'unsupported',
          message: detection.message,
        };
      }

      const resolvedLaunchUrl = this.resolveLaunchUrl(resource.packageUrl, detection.launchPath, true);
      if (resolvedLaunchUrl) {
        return {
          status: 'detected',
          message: `${detection.message} Launch URL auto-resolved.`,
          launchPath: detection.launchPath,
          launchUrl: resolvedLaunchUrl,
        };
      }

      return {
        status: 'detected',
        message:
          `${detection.message} Launch path detected but package is a zip archive. ` +
          'Host extracted files and then apply this launch path in Launch URL.',
        launchPath: detection.launchPath,
      };
    } catch (error: unknown) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown runtime detection error.',
      };
    }
  }

  private resolveLaunchFromExtractor(extraction: ExtractPackageResponse): string | undefined {
    if (extraction.recommendedLaunchUrl) {
      return extraction.recommendedLaunchUrl;
    }

    if (extraction.recommendedLaunchPath) {
      return this.joinUrl(extraction.contentBaseUrl, extraction.recommendedLaunchPath);
    }

    const firstCandidate = extraction.launchCandidates?.[0];
    if (firstCandidate?.url) {
      return firstCandidate.url;
    }

    if (firstCandidate?.path) {
      return this.joinUrl(extraction.contentBaseUrl, firstCandidate.path);
    }

    return undefined;
  }

  private async getPackageBlob(resource: LearningResourceVm): Promise<Blob> {
    const cachedResponse = resource.state === 'downloaded' ? await this.getCachedResource(resource.id) : undefined;
    if (cachedResponse) {
      return cachedResponse.blob();
    }

    const remoteResponse = await fetch(resource.packageUrl, { cache: 'no-store' });
    if (!remoteResponse.ok) {
      throw new Error(`Unable to load package for extractor: ${remoteResponse.status} ${remoteResponse.statusText}`);
    }

    return remoteResponse.blob();
  }

  private joinUrl(baseUrl: string, path: string): string {
    return new URL(path.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
  }

  private requiresRuntimeAdapter(kind: ResourceKind): boolean {
    return kind === 'h5p' || kind === 'scorm' || kind === 'tincan';
  }

  private async detectLaunchPathFromZip(
    kind: ResourceKind,
    zip: JSZip,
  ): Promise<{ launchPath?: string; message: string }> {
    const fileNames = Object.keys(zip.files).filter((fileName) => !zip.files[fileName].dir);

    if (kind === 'h5p') {
      const preferred = this.findFile(fileNames, ['index.html', 'index.htm']);
      const fallback = this.findAnyHtml(fileNames);
      const launchPath = preferred ?? fallback;
      if (launchPath) {
        return { launchPath, message: 'H5P runtime launch file detected.' };
      }

      return {
        message: 'No HTML launch file found for H5P package.',
      };
    }

    if (kind === 'scorm') {
      const manifestFile = this.findFile(fileNames, ['imsmanifest.xml']);
      if (!manifestFile) {
        return { message: 'SCORM manifest imsmanifest.xml not found in zip package.' };
      }

      const manifestText = await zip.file(manifestFile)?.async('text');
      if (!manifestText) {
        return { message: 'SCORM manifest exists but could not be read.' };
      }

      const launchPath = this.parseScormLaunchPath(manifestText);
      if (launchPath) {
        return { launchPath, message: 'SCORM launch target detected from imsmanifest.xml.' };
      }

      const fallback = this.findAnyHtml(fileNames);
      if (fallback) {
        return {
          launchPath: fallback,
          message: 'SCORM manifest parsed without launch href. Falling back to first HTML file.',
        };
      }

      return {
        message: 'SCORM manifest parsed, but no launchable entry was found.',
      };
    }

    if (kind === 'tincan') {
      const tincanFile = this.findFile(fileNames, ['tincan.xml']);
      if (tincanFile) {
        const tincanText = await zip.file(tincanFile)?.async('text');
        if (tincanText) {
          const launchPath = this.parseTinCanLaunchPath(tincanText);
          if (launchPath) {
            return { launchPath, message: 'TinCan launch target detected from tincan.xml.' };
          }
        }
      }

      const fallback = this.findAnyHtml(fileNames);
      if (fallback) {
        return {
          launchPath: fallback,
          message: 'TinCan launch file not explicit in manifest. Falling back to first HTML file.',
        };
      }

      return { message: 'TinCan package does not expose a launch file in manifests.' };
    }

    return {
      launchPath: this.findAnyHtml(fileNames),
      message: 'Generic package analysis applied.',
    };
  }

  private parseScormLaunchPath(manifestXml: string): string | undefined {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(manifestXml, 'application/xml');

      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        return undefined;
      }

      const firstItem = xmlDoc.querySelector('organization > item');
      const identifierRef = firstItem?.getAttribute('identifierref');
      if (identifierRef) {
        const matchingResource = xmlDoc.querySelector(`resource[identifier="${identifierRef}"]`);
        const href = matchingResource?.getAttribute('href');
        if (href) {
          return href;
        }
      }

      const firstResourceHref = xmlDoc.querySelector('resource[href]')?.getAttribute('href');
      return firstResourceHref ?? undefined;
    } catch {
      return undefined;
    }
  }

  private parseTinCanLaunchPath(tincanXml: string): string | undefined {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(tincanXml, 'application/xml');
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        return undefined;
      }

      const launchAttr = xmlDoc.querySelector('activity[launch]')?.getAttribute('launch');
      if (launchAttr) {
        return launchAttr;
      }

      const launchNode = xmlDoc.querySelector('launch');
      const launchText = launchNode?.textContent?.trim();
      return launchText || undefined;
    } catch {
      return undefined;
    }
  }

  private async streamToBlob(
    resourceId: string,
    response: Response,
    totalBytes: number | undefined,
    contentType: string,
  ): Promise<Blob> {
    if (!response.body) {
      const fallbackBlob = await response.blob();
      this.updateResource(resourceId, {
        progress: 100,
        downloadedBytes: fallbackBlob.size,
        totalBytes: fallbackBlob.size,
      });
      return fallbackBlob;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let bytesRead = 0;

    while (true) {
      const nextChunk = await reader.read();
      if (nextChunk.done) {
        break;
      }

      const chunk = new Uint8Array(nextChunk.value);
      chunks.push(chunk);
      bytesRead += chunk.byteLength;

      const progress = totalBytes ? Math.min(100, Math.round((bytesRead / totalBytes) * 100)) : 0;
      this.updateResource(resourceId, {
        downloadedBytes: bytesRead,
        totalBytes,
        progress,
      });
    }

    this.updateResource(resourceId, {
      downloadedBytes: bytesRead,
      totalBytes,
      progress: totalBytes ? 100 : 0,
    });

    return new Blob(chunks, { type: contentType });
  }

  private async buildPlayerSession(
    resource: LearningResourceVm,
    cachedResponse?: Response,
  ): Promise<PlayerSession | null> {
    const remoteTarget = resource.launchUrl || resource.packageUrl;
    const cachedBlob = cachedResponse ? await cachedResponse.blob() : undefined;
    const cachedUrl = cachedBlob ? URL.createObjectURL(cachedBlob) : undefined;

    if (resource.kind === 'media') {
      if (cachedUrl) {
        return this.createSession(resource, 'media', cachedUrl, 'cached');
      }

      if (remoteTarget) {
        return this.createSession(resource, 'media', remoteTarget, 'remote');
      }

      return null;
    }

    if (resource.kind === 'web') {
      if (cachedUrl) {
        return this.createSession(resource, 'frame', cachedUrl, 'cached');
      }

      if (remoteTarget) {
        return this.createSession(resource, 'frame', remoteTarget, 'remote');
      }

      return null;
    }

    return this.buildPackagePlayerSession(resource, remoteTarget, cachedBlob, cachedUrl);
  }

  private async buildPackagePlayerSession(
    resource: LearningResourceVm,
    remoteTarget: string,
    cachedBlob?: Blob,
    cachedUrl?: string,
  ): Promise<PlayerSession | null> {
    const packageHint = this.packageHint(resource.kind);

    if (cachedBlob) {
      const extractedSession = await this.buildExtractedPackageSession(resource, cachedBlob, packageHint);
      if (extractedSession) {
        return extractedSession;
      }
    }

    if (resource.launchUrl) {
      return {
        ...this.createSession(resource, 'frame', resource.launchUrl, 'remote'),
        hint: `${packageHint} Launch URL configured. Opening in embedded player.`,
      };
    }

    if (cachedUrl) {
      return {
        ...this.createSession(resource, 'package', cachedUrl, 'cached'),
        hint: `${packageHint} package downloaded. Add Launch URL for full in-app runtime playback.`,
      };
    }

    if (remoteTarget) {
      return {
        ...this.createSession(resource, 'package', remoteTarget, 'remote'),
        hint: `${packageHint} package available. Configure Launch URL to use embedded playback.`,
      };
    }

    return null;
  }

  private async buildExtractedPackageSession(
    resource: LearningResourceVm,
    cachedBlob: Blob,
    packageHint: string,
  ): Promise<PlayerSession | null> {
    const contentType = cachedBlob.type;
    if (!this.isZipBlob(resource.packageUrl, contentType, cachedBlob)) {
      return null;
    }

    try {
      const launchPath = await this.ensureLocalRuntimeExtracted(resource, cachedBlob);
      if (!launchPath) {
        return null;
      }

      return {
        ...this.createSession(resource, 'frame', this.runtimeAssetUrl(resource.id, launchPath), 'cached'),
        hint: `${packageHint} package extracted locally before launch. Previous extracted runtime content is replaced automatically.`,
      };
    } catch (error: unknown) {
      this.updateResource(resource.id, {
        lastError: error instanceof Error ? error.message : 'Package extraction failed.',
      });
      return null;
    }
  }

  private createSession(
    resource: LearningResourceVm,
    mode: PlayerSession['mode'],
    sourceUrl: string,
    sourceOrigin: PlayerSession['sourceOrigin'],
  ): PlayerSession {
    return {
      resourceId: resource.id,
      title: resource.title,
      kind: resource.kind,
      mode,
      sourceUrl,
      sourceOrigin,
    };
  }

  private packageHint(kind: ResourceKind): string {
    if (kind === 'h5p') {
      return 'H5P';
    }

    if (kind === 'scorm') {
      return 'SCORM/xAPI';
    }

    return 'TinCan/xAPI';
  }

  private setActivePlayer(session: PlayerSession): void {
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = undefined;
    }

    if (session.sourceUrl.startsWith('blob:')) {
      this.activeBlobUrl = session.sourceUrl;
    }

    this.activePlayer.set(session);
  }

  private maybeQueueRetry(resourceId: string, error: unknown, errorMessage: string): number | undefined {
    if (!this.shouldRetry(errorMessage, error)) {
      this.clearRetry(resourceId);
      return undefined;
    }

    const existing = this.retryQueueSignal()[resourceId];
    const attempt = (existing?.attempt ?? 0) + 1;
    if (attempt > this.maxRetryAttempts) {
      this.clearRetry(resourceId);
      return undefined;
    }

    const delayMs = Math.min(this.baseRetryDelayMs * Math.pow(2, attempt - 1), this.maxRetryDelayMs);
    const nextRetryAt = Date.now() + delayMs;
    const nextQueue = {
      ...this.retryQueueSignal(),
      [resourceId]: {
        id: resourceId,
        attempt,
        nextRetryAt,
        lastError: errorMessage,
      },
    };

    this.retryQueueSignal.set(nextQueue);
    this.persistRetryQueue();
    this.updateResource(resourceId, {
      retryAttempt: attempt,
      nextRetryAt: new Date(nextRetryAt).toISOString(),
    });

    return nextRetryAt;
  }

  private clearRetry(resourceId: string): void {
    const currentQueue = this.retryQueueSignal();
    if (currentQueue[resourceId]) {
      const nextQueue = { ...currentQueue };
      delete nextQueue[resourceId];
      this.retryQueueSignal.set(nextQueue);
      this.persistRetryQueue();
    }

    this.updateResource(resourceId, {
      retryAttempt: undefined,
      nextRetryAt: undefined,
    });
  }

  private shouldRetry(errorMessage: string, error: unknown): boolean {
    const normalized = errorMessage.toLowerCase();

    if (!this.online()) {
      return true;
    }

    if (error instanceof TypeError) {
      return true;
    }

    if (normalized.includes('failed to fetch') || normalized.includes('network')) {
      return true;
    }

    const statusMatch = normalized.match(/download failed: (\d{3})/);
    if (statusMatch) {
      const statusCode = Number(statusMatch[1]);
      return statusCode >= 500;
    }

    return false;
  }

  private async processRetryQueue(): Promise<void> {
    if (!this.online()) {
      return;
    }

    const now = Date.now();
    const dueEntries = Object.values(this.retryQueueSignal()).filter((entry) => entry.nextRetryAt <= now);
    for (const entry of dueEntries) {
      const resource = this.resourcesSignal().find((item) => item.id === entry.id);
      if (!resource || resource.state === 'downloading') {
        continue;
      }

      await this.downloadResource(entry.id, 'retry');
    }
  }

  private cacheKey(resourceId: string): Request {
    return new Request(`/offline-resource/${resourceId}`);
  }

  private runtimeCacheKey(resourceId: string, filePath: string): Request {
    return new Request(this.runtimeAssetUrl(resourceId, filePath));
  }

  private async getCachedResource(resourceId: string): Promise<Response | undefined> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(this.cacheKey(resourceId));
    return response ?? undefined;
  }

  private async ensureLocalRuntimeExtracted(resource: LearningResourceVm, packageBlob: Blob): Promise<string | undefined> {
    const zip = await JSZip.loadAsync(await packageBlob.arrayBuffer());
    const detection = await this.detectLaunchPathFromZip(resource.kind, zip);
    const normalizedLaunchPath = detection.launchPath ? this.normalizeRuntimePath(detection.launchPath) : undefined;
    if (!normalizedLaunchPath) {
      throw new Error(detection.message);
    }

    const launchRequest = this.runtimeCacheKey(resource.id, normalizedLaunchPath);
    const runtimeCache = await caches.open(this.runtimeCacheName);
    const activeExtractedResourceId = localStorage.getItem(this.activeExtractedResourceKey);
    if (activeExtractedResourceId === resource.id) {
      const existingLaunchFile = await runtimeCache.match(launchRequest);
      if (existingLaunchFile) {
        return normalizedLaunchPath;
      }
    }

    await this.clearExtractedRuntime();
    await this.extractZipToRuntimeCache(resource.id, zip);
    localStorage.setItem(this.activeExtractedResourceKey, resource.id);
    return normalizedLaunchPath;
  }

  private async extractZipToRuntimeCache(resourceId: string, zip: JSZip): Promise<void> {
    const runtimeCache = await caches.open(this.runtimeCacheName);
    const files = Object.values(zip.files).filter((entry) => !entry.dir);

    for (const file of files) {
      const normalizedPath = this.normalizeRuntimePath(file.name);
      if (!normalizedPath) {
        continue;
      }

      const fileBytes = await file.async('uint8array');
      const fileBuffer = new ArrayBuffer(fileBytes.byteLength);
      new Uint8Array(fileBuffer).set(fileBytes);
      await runtimeCache.put(
        this.runtimeCacheKey(resourceId, normalizedPath),
        new Response(fileBuffer, {
          headers: new Headers({
            'content-type': this.contentTypeForPath(normalizedPath),
            'x-resource-id': resourceId,
          }),
        }),
      );
    }
  }

  private async clearExtractedRuntime(resourceId?: string): Promise<void> {
    const activeExtractedResourceId = localStorage.getItem(this.activeExtractedResourceKey);
    if (resourceId && activeExtractedResourceId && activeExtractedResourceId !== resourceId) {
      return;
    }

    await caches.delete(this.runtimeCacheName);
    localStorage.removeItem(this.activeExtractedResourceKey);
  }

  private updateResource(resourceId: string, patch: Partial<LearningResourceVm>): void {
    this.resourcesSignal.update((items) =>
      items.map((item) => (item.id === resourceId ? { ...item, ...patch } : item)),
    );
    this.persistState();
  }

  private persistState(): void {
    const snapshot: PersistedResourceState[] = this.resourcesSignal().map((item) => ({
      id: item.id,
      state: item.state,
      progress: item.progress,
      downloadedBytes: item.downloadedBytes,
      totalBytes: item.totalBytes,
      cachedAt: item.cachedAt,
      packageUrl: item.packageUrl,
      launchUrl: item.launchUrl,
    }));

    localStorage.setItem(this.stateStorageKey, JSON.stringify(snapshot));
  }

  private restoreFromStorage(): void {
    const rawState = localStorage.getItem(this.stateStorageKey);
    if (!rawState) {
      return;
    }

    try {
      const parsed = JSON.parse(rawState) as PersistedResourceState[];
      const stateById = new Map(parsed.map((entry) => [entry.id, entry]));

      this.resourcesSignal.update((items) =>
        items.map((item) => {
          const saved = stateById.get(item.id);
          if (!saved) {
            return item;
          }

          return {
            ...item,
            state: saved.state,
            progress: saved.progress,
            downloadedBytes: saved.downloadedBytes,
            totalBytes: saved.totalBytes,
            cachedAt: saved.cachedAt,
            packageUrl: saved.packageUrl,
            launchUrl: saved.launchUrl,
          };
        }),
      );
    } catch {
      localStorage.removeItem(this.stateStorageKey);
    }
  }

  private persistRetryQueue(): void {
    localStorage.setItem(this.retryStorageKey, JSON.stringify(this.retryQueueSignal()));
  }

  private restoreRetryQueue(): void {
    const rawQueue = localStorage.getItem(this.retryStorageKey);
    if (!rawQueue) {
      return;
    }

    try {
      const parsedQueue = JSON.parse(rawQueue) as Record<string, RetryQueueEntry>;
      this.retryQueueSignal.set(parsedQueue);

      for (const entry of Object.values(parsedQueue)) {
        this.updateResource(entry.id, {
          retryAttempt: entry.attempt,
          nextRetryAt: new Date(entry.nextRetryAt).toISOString(),
        });
      }
    } catch {
      this.retryQueueSignal.set({});
      localStorage.removeItem(this.retryStorageKey);
    }
  }

  private isZipBlob(packageUrl: string, contentType: string, blob: Blob): boolean {
    if (contentType.includes('zip')) {
      return true;
    }

    const loweredUrl = packageUrl.toLowerCase();
    if (loweredUrl.endsWith('.zip') || loweredUrl.includes('.zip?')) {
      return true;
    }

    const [firstPart] = contentType.split(';');
    const normalizedType = firstPart.trim();
    return normalizedType === 'application/octet-stream' && blob.size > 0;
  }

  private resolveLaunchUrl(packageUrl: string, launchPath: string, sourceIsZip: boolean): string | undefined {
    const trimmedPath = launchPath.replace(/^\/+/, '');

    if (!sourceIsZip) {
      try {
        return new URL(trimmedPath, packageUrl).href;
      } catch {
        return undefined;
      }
    }

    if (!packageUrl.toLowerCase().endsWith('/')) {
      return undefined;
    }

    try {
      return new URL(trimmedPath, packageUrl).href;
    } catch {
      return undefined;
    }
  }

  private filenameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      return pathParts[pathParts.length - 1] ?? 'resource';
    } catch {
      return 'resource';
    }
  }

  private findFile(fileNames: string[], exactNames: string[]): string | undefined {
    const exactMap = new Set(exactNames.map((name) => name.toLowerCase()));
    return fileNames.find((fileName) => exactMap.has(fileName.split('/').pop()?.toLowerCase() ?? ''));
  }

  private findAnyHtml(fileNames: string[]): string | undefined {
    return fileNames.find((fileName) => fileName.toLowerCase().endsWith('.html'));
  }

  private runtimeAssetUrl(resourceId: string, filePath: string): string {
    const normalizedPath = this.normalizeRuntimePath(filePath);
    const encodedPath = normalizedPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return new URL(`/offline-runtime/${encodeURIComponent(resourceId)}/${encodedPath}`, window.location.origin).href;
  }

  private normalizeRuntimePath(filePath: string): string {
    return filePath
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .join('/');
  }

  private contentTypeForPath(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
    const contentTypes: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      htm: 'text/html; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      mjs: 'text/javascript; charset=utf-8',
      css: 'text/css; charset=utf-8',
      json: 'application/json; charset=utf-8',
      xml: 'application/xml; charset=utf-8',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ico: 'image/x-icon',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      webm: 'video/webm',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      pdf: 'application/pdf',
      wasm: 'application/wasm',
    };

    return contentTypes[extension] ?? 'application/octet-stream';
  }
}
