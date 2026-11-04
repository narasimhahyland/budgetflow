import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import type { RecordAnalyticsRequest } from '@bf/contracts';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';

type ClientEvent = RecordAnalyticsRequest['events'][number];

/**
 * Product analytics from the web app (session started, page viewed), batched and retry-safe by event
 * id. Properties carry route templates and counts only, never names or amounts. Platform operators are
 * not tracked: they are not product users of the tenant.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsTracker {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly document = inject(DOCUMENT);
  private queue: ClientEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  track(name: ClientEvent['name'], properties?: ClientEvent['properties']): void {
    if (this.session.state() !== 'ready' || this.session.me()?.platformOperator) return;
    this.connect();
    this.queue.push({
      id: crypto.randomUUID(),
      name,
      occurredAt: new Date().toISOString(),
      ...(properties ? { properties } : {}),
    });
    if (this.queue.length >= 20) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), 1500);
  }

  async flush(keepalive = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const events = this.queue.splice(0, 50);
    if (!events.length) return;
    const client = keepalive ? this.api.keepaliveClient : this.api.client;
    try {
      await client.recordAnalyticsEvents({ body: { events } });
    } catch {
      // Telemetry is best effort: a lost batch never blocks the user.
    }
  }

  private connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') void this.flush(true);
    });
  }
}
