import { Injectable, computed, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class PwaInstallService {
  private deferredPromptEvent: BeforeInstallPromptEvent | null = null;

  readonly isInstalled = signal(this.detectInstalled());
  readonly canInstall = signal(false);
  readonly installStateLabel = computed(() => {
    if (this.isInstalled()) {
      return 'Launch App';
    }

    if (this.canInstall()) {
      return 'Install App';
    }

    return 'Open App';
  });

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPromptEvent = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPromptEvent = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
    });

    window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
      this.isInstalled.set(this.detectInstalled());
    });
  }

  async installOrLaunch(): Promise<void> {
    if (this.canInstall() && this.deferredPromptEvent) {
      await this.deferredPromptEvent.prompt();
      const choice = await this.deferredPromptEvent.userChoice;

      if (choice.outcome === 'accepted') {
        this.canInstall.set(false);
        this.deferredPromptEvent = null;
      }

      return;
    }

    // On platforms with link capturing this can hand off to the installed app.
    window.open(`${window.location.origin}/`, '_blank', 'noopener,noreferrer');
  }

  private detectInstalled(): boolean {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return isStandalone || isIosStandalone;
  }
}
