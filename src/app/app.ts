import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PlayerSession } from './models/learning-resource.model';
import { OfflineResourceService } from './services/offline-resource.service';
import { PwaInstallService } from './services/pwa-install.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = 'Learner Companion';
  private readonly offlineResourceService = inject(OfflineResourceService);
  private readonly pwaInstallService = inject(PwaInstallService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly resources = this.offlineResourceService.resources;
  protected readonly totalResources = this.offlineResourceService.totalResources;
  protected readonly downloadedResources = this.offlineResourceService.downloadedResources;
  protected readonly online = this.offlineResourceService.online;
  protected readonly activePlayer = this.offlineResourceService.activePlayer;
  protected readonly isInstalled = this.pwaInstallService.isInstalled;
  protected readonly canInstall = this.pwaInstallService.canInstall;
  protected readonly installStateLabel = this.pwaInstallService.installStateLabel;
  protected readonly completionRate = computed(() => {
    const total = this.totalResources();
    if (!total) {
      return 0;
    }
    return Math.round((this.downloadedResources() / total) * 100);
  });

  protected updatePackageUrl(resourceId: string, value: string): void {
    this.offlineResourceService.updateResourceUrl(resourceId, 'packageUrl', value);
  }

  protected updateLaunchUrl(resourceId: string, value: string): void {
    this.offlineResourceService.updateResourceUrl(resourceId, 'launchUrl', value);
  }

  protected downloadResource(resourceId: string): void {
    void this.offlineResourceService.downloadResource(resourceId);
  }

  protected detectRuntime(resourceId: string): void {
    void this.offlineResourceService.detectRuntimeAdapter(resourceId);
  }

  protected prepareRuntime(resourceId: string): void {
    void this.offlineResourceService.processPackageExtractor(resourceId);
  }

  protected applyDetectedLaunch(resourceId: string): void {
    this.offlineResourceService.applyDetectedLaunch(resourceId);
  }

  protected removeDownload(resourceId: string): void {
    void this.offlineResourceService.removeDownload(resourceId);
  }

  protected openResource(resourceId: string): void {
    void this.offlineResourceService.openResource(resourceId);
  }

  protected closePlayer(): void {
    this.offlineResourceService.closePlayer();
  }

  protected installOrLaunchApp(): void {
    void this.pwaInstallService.installOrLaunch();
  }

  protected openPlayerInTab(): void {
    this.offlineResourceService.openActivePlayerInNewTab();
  }

  protected retryTimeLabel(nextRetryAt?: string): string {
    return this.offlineResourceService.retryTimeLabel(nextRetryAt);
  }

  protected isFramePlayer(player: PlayerSession | null): boolean {
    return player?.mode === 'frame';
  }

  protected isMediaPlayer(player: PlayerSession | null): boolean {
    return player?.mode === 'media';
  }

  protected canApplyDetectedLaunch(resource: {
    detectedLaunchPath?: string;
    packageUrl: string;
    runtimeStatus?: string;
  }): boolean {
    return (
      resource.runtimeStatus === 'detected' &&
      !!resource.detectedLaunchPath &&
      resource.packageUrl.toLowerCase().endsWith('/')
    );
  }

  protected trustResourceUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  protected formatBytes(bytes: number): string {
    return this.offlineResourceService.formatBytes(bytes);
  }
}
