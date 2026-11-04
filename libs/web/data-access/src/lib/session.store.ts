import { computed, inject, Injectable, signal } from '@angular/core';
import type { MeResponse, ProblemDetails } from '@bf/contracts';
import { ApiService } from './api.service';

export type SessionState = 'idle' | 'loading' | 'ready' | 'not-member' | 'error';

/** The signed-in user in their tenant (GET /api/me): identity, permissions, timezone, fiscal years. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiService);
  private pending: Promise<void> | null = null;

  readonly me = signal<MeResponse | null>(null);
  readonly state = signal<SessionState>('idle');
  readonly problem = signal<ProblemDetails | null>(null);
  readonly permissions = computed(() => new Set(this.me()?.permissions ?? []));
  readonly firstName = computed(() => this.me()?.displayName.split(' ')[0] ?? '');
  readonly timezone = computed(() => this.me()?.timezone ?? 'UTC');

  /** Whether the API grants the action somewhere in the tenant (display only; the API enforces). */
  can(action: string): boolean {
    return this.permissions().has(action);
  }

  ensureLoaded(): Promise<void> {
    if (this.state() === 'ready') return Promise.resolve();
    this.pending ??= this.load().finally(() => (this.pending = null));
    return this.pending;
  }

  reload(): Promise<void> {
    this.state.set('idle');
    return this.ensureLoaded();
  }

  private async load(): Promise<void> {
    this.state.set('loading');
    this.problem.set(null);
    try {
      const res = await this.api.client.me({});
      if (res.ok) {
        this.me.set(res.data);
        this.state.set('ready');
        return;
      }
      this.problem.set(res.problem);
      this.state.set(res.problem?.code === 'TENANT_NOT_MEMBER' ? 'not-member' : 'error');
    } catch {
      this.state.set('error');
    }
  }
}
