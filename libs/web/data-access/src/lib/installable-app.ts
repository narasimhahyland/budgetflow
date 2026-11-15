import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Installable app (B8, screen 059a): connection state, the browser's install prompt and Web Push
 * subscriptions. Browser APIs only; the API calls stay in the feature that uses them.
 */

/** Whether the browser has a connection, kept current by the online and offline events. */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  private readonly window = inject(DOCUMENT).defaultView;
  readonly online = signal(this.window?.navigator.onLine ?? true);
  /** When the connection was lost; null while online. */
  readonly offlineSince = signal<Date | null>(this.online() ? null : new Date());

  constructor() {
    const w = this.window;
    if (!w) return;
    const up = () => {
      this.online.set(true);
      this.offlineSince.set(null);
    };
    const down = () => {
      this.online.set(false);
      this.offlineSince.set(new Date());
    };
    w.addEventListener('online', up);
    w.addEventListener('offline', down);
    inject(DestroyRef).onDestroy(() => {
      w.removeEventListener('online', up);
      w.removeEventListener('offline', down);
    });
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const VISITS_KEY = 'bf.install.visits';
const DISMISSED_KEY = 'bf.install.dismissedUntil';
const DISMISS_DAYS = 30;

/**
 * The install prompt of 059a: offered from the second visit on a browser that supports installing,
 * never when already installed, and hidden for 30 days by "Not now". On iOS (no install event) the
 * prompt explains the Share menu steps instead. Only counters live in localStorage, never data.
 */
@Injectable({ providedIn: 'root' })
export class InstallPrompt {
  private readonly window = inject(DOCUMENT).defaultView;
  private deferred: BeforeInstallPromptEvent | null = null;
  /** 'native': an Install button works; 'ios': show the Share menu steps; null: nothing to offer. */
  readonly offer = signal<'native' | 'ios' | null>(null);

  constructor() {
    const w = this.window;
    if (!w || this.installed()) return;
    const visits = Number(this.read(VISITS_KEY) ?? 0) + 1;
    this.write(VISITS_KEY, String(visits));
    const eligible = () => visits >= 2 && !this.dismissed();
    w.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      if (eligible()) this.offer.set('native');
    });
    w.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.offer.set(null);
    });
    const ua = w.navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && eligible()) this.offer.set('ios');
  }

  /** Shows the browser's own install dialog; true when the person installed. */
  async install(): Promise<boolean> {
    const e = this.deferred;
    this.offer.set(null);
    if (!e) return false;
    this.deferred = null;
    await e.prompt();
    return (await e.userChoice).outcome === 'accepted';
  }

  dismiss(): void {
    this.offer.set(null);
    this.write(DISMISSED_KEY, String(Date.now() + DISMISS_DAYS * 24 * 3600 * 1000));
  }

  private installed(): boolean {
    const w = this.window!;
    return (
      w.matchMedia?.('(display-mode: standalone)').matches ||
      (w.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  private dismissed(): boolean {
    return Number(this.read(DISMISSED_KEY) ?? 0) > Date.now();
  }

  private read(key: string): string | null {
    try {
      return this.window?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.window?.localStorage.setItem(key, value);
    } catch {
      // Private mode: the prompt simply shows again next time.
    }
  }
}

export type PushSupport = 'supported' | 'needs-install' | 'unsupported' | 'blocked';

export interface BrowserPushSubscription {
  endpoint: string;
  p256dh: string;
  authKey: string;
  deviceLabel: string;
  userAgentFamily: string;
}

/** Subscribes this browser to Web Push through the service worker (059c). */
@Injectable({ providedIn: 'root' })
export class PushSubscriber {
  private readonly window = inject(DOCUMENT).defaultView;

  support(): PushSupport {
    const w = this.window;
    if (!w || !('serviceWorker' in w.navigator)) return 'unsupported';
    const ua = w.navigator.userAgent;
    if (!('PushManager' in w) || !('Notification' in w)) {
      // iOS offers push only to an app added to the home screen.
      return /iPhone|iPad|iPod/.test(ua) ? 'needs-install' : 'unsupported';
    }
    return w.Notification.permission === 'denied' ? 'blocked' : 'supported';
  }

  /**
   * Asks for permission and subscribes with the API's VAPID key. Returns null when the person
   * declined (the caller shows the blocked state).
   */
  async subscribe(vapidPublicKey: string): Promise<BrowserPushSubscription | null> {
    const w = this.window!;
    const permission = await w.Notification.requestPermission();
    if (permission !== 'granted') return null;
    const registration = await Promise.race([
      w.navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('The service worker is not running')), 10_000),
      ),
    ]);
    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidPublicKey),
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth'])
      throw new Error('The browser returned an incomplete subscription');
    const family = deviceFamily(w.navigator.userAgent);
    return {
      endpoint: json.endpoint,
      p256dh: json.keys['p256dh'],
      authKey: json.keys['auth'],
      deviceLabel: `${family.browser} on ${family.os}`,
      userAgentFamily: `${family.os}, ${family.browser}`,
    };
  }

  /** Unsubscribes this browser when the removed device is this one. */
  async unsubscribeIf(endpoint: string): Promise<void> {
    const w = this.window;
    if (!w || !('serviceWorker' in w.navigator)) return;
    const registration = await w.navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (sub && sub.endpoint === endpoint) await sub.unsubscribe();
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceFamily(ua: string): { os: string; browser: string } {
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Desktop';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return { os, browser };
}
