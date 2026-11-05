import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { approverLabel } from './labels';
import { LoadState } from './load-state';
import { RulesTabs } from './rules-tabs';

const MARKER_TONES: Record<string, 'neutral-quiet' | 'success' | 'warning' | 'important'> = {
  unchanged: 'neutral-quiet',
  added: 'success',
  changed: 'warning',
  removed: 'important',
};

const MARKER_LABELS: Record<string, string> = {
  unchanged: 'No change',
  added: 'New',
  changed: 'Changed',
  removed: 'Removed',
};

/** Screen 070a: approval limits by role and spend type, with the version waiting for approval. */
@Component({
  selector: 'bf-doa-admin-page',
  imports: [
    DecimalPipe,
    LoadState,
    MatButtonModule,
    Money,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval limits</h1>
        <p class="bf-page__subtitle">
          How much each role or person can approve, by spend type and legal entity. Approval
          authority is separate from owning a budget. A new version needs two people: Finance
          submits it and the CEO approves it.
        </p>
      </div>
      <div class="bf-page__actions">
        @if (can('approve')) {
          <button mat-flat-button type="button" [disabled]="busy()" (click)="approve()">
            Approve this version
          </button>
        }
      </div>
    </header>
    <bf-rules-tabs current="doa" />
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="approval limits"
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      @if (v.selectedVersion.status === 'awaiting_approval' && !can('approve')) {
        <sat-banner variant="info">
          <sat-banner-message>
            Version {{ v.selectedVersion.version }} is waiting for approval. The person who
            submitted it cannot approve it, so someone else has to.
          </sat-banner-message>
        </sat-banner>
      }
      @for (w of v.warnings; track $index) {
        <sat-banner variant="warning"
          ><sat-banner-message>{{ w }}</sat-banner-message></sat-banner
        >
      }

      <dl class="bf-kpis">
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Version shown</dt>
          <dd class="bf-kpi__value">v{{ v.selectedVersion.version }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">In force today</dt>
          <dd class="bf-kpi__value">
            {{ v.activeVersion ? 'v' + v.activeVersion.version : 'None' }}
          </dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Approvals in flight</dt>
          <dd class="bf-kpi__value">{{ v.impact.openTasksAffected | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Delegations in place</dt>
          <dd class="bf-kpi__value">{{ v.impact.delegationsAffected | number }}</dd>
        </div>
      </dl>

      <section class="bf-card" aria-labelledby="limits-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="limits-title">
            Limits in version {{ v.selectedVersion.version }}
          </h2>
          <p class="bf-card__hint">
            Starts {{ v.selectedVersion.validFrom }}. The most specific row wins: a named person
            beats a role, an exact spend type beats any spend type.
          </p>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Approval limits">
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col">Spend type</th>
                <th scope="col">Legal entity</th>
                <th scope="col" class="bf-num">Limit</th>
                <th scope="col" class="bf-num">Was</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              @for (row of v.rows; track $index) {
                <tr>
                  <td>{{ who(row) }}</td>
                  <td>{{ row.spendType }}</td>
                  <td>{{ row.legalEntityCode ?? 'Any entity' }}</td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.limit.amountMinor"
                      [currency]="row.limit.currency"
                    />
                  </td>
                  <td class="bf-num">
                    @if (row.previousLimitMinor !== null && row.previousLimitMinor !== undefined) {
                      <bf-money
                        [amountMinor]="row.previousLimitMinor"
                        [currency]="row.limit.currency"
                      />
                    } @else {
                      —
                    }
                  </td>
                  <td>
                    <sat-status-tag [status]="tone(row.changeMarker)">{{
                      markerLabel(row.changeMarker)
                    }}</sat-status-tag>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="versions-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="versions-title">Versions</h2>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Approval limit versions">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">In force</th>
                <th scope="col">Approved by</th>
              </tr>
            </thead>
            <tbody>
              @for (ver of v.versions; track ver.id) {
                <tr>
                  <td class="bf-cell__primary">v{{ ver.version }}</td>
                  <td>{{ ver.status.replace('_', ' ') }}</td>
                  <td>{{ ver.validFrom }}{{ ver.validTo ? ' to ' + ver.validTo : ' onwards' }}</td>
                  <td>{{ ver.approvedByName ?? 'Not approved yet' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoaAdminPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly notice = signal('');
  protected readonly view = resource({ loader: () => data(this.api.getDoaMatrixAdmin({})) });
  private readonly current = computed(() => valueOf(this.view));

  protected can(action: string): boolean {
    return (this.current()?.allowedActions ?? []).includes(action);
  }

  protected who(row: { personName?: string | null; role: string | null }): string {
    return row.personName ?? (row.role ? approverLabel(row.role) : 'Anyone');
  }

  protected tone(marker?: string): 'neutral-quiet' | 'success' | 'warning' | 'important' {
    return MARKER_TONES[marker ?? 'unchanged'] ?? 'neutral-quiet';
  }

  protected markerLabel(marker?: string): string {
    return MARKER_LABELS[marker ?? 'unchanged'] ?? 'No change';
  }

  protected async approve(): Promise<void> {
    const versionId = this.current()?.selectedVersion.id;
    if (!versionId) return;
    this.busy.set(true);
    this.failure.set('');
    this.notice.set('');
    try {
      await data(this.api.approveDoaMatrixVersion({ body: { versionId } }));
      this.notice.set('Approved. The new limits apply from their start date.');
      this.snack.open('Approval limits approved', undefined, { duration: 4000 });
      this.view.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
