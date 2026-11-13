import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoadState, Money, type StatusView } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { approverLabel, spendTypeLabel } from './labels';
import { RulesTabs } from './rules-tabs';

const MARKER_LOOKS: Record<string, StatusView> = {
  unchanged: { label: 'No change', tone: 'neutral', icon: 'circle_minus' },
  added: { label: 'New', tone: 'success', icon: 'circle_check' },
  changed: { label: 'Changed', tone: 'warning', icon: 'note_edit' },
  removed: { label: 'Removed', tone: 'important', icon: 'circle_x' },
};

const VERSION_LOOKS: Record<string, StatusView> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'note_edit' },
  awaiting_approval: { label: 'Waiting for approval', tone: 'warning', icon: 'clock' },
  active: { label: 'In force', tone: 'success', icon: 'circle_check' },
  scheduled: { label: 'Starts later', tone: 'info', icon: 'calendar' },
  superseded: { label: 'Replaced', tone: 'neutral', icon: 'restore' },
};

/** Screen 070a: approval limits by role and spend type, with the version waiting for approval. */
@Component({
  selector: 'bf-doa-admin-page',
  imports: [
    DatePipe,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
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
      shape="table"
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

      <div class="bf-kpis">
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Version shown</p>
            <mat-icon class="bf-kpi__icon" svgIcon="note_edit" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">v{{ v.selectedVersion.version }}</p>
          <p class="bf-kpi__delta">{{ versionLook(v.selectedVersion.status).label }}</p>
        </div>
        <div class="bf-kpi bf-kpi--success">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">In force today</p>
            <mat-icon class="bf-kpi__icon" svgIcon="circle_check" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            {{ v.activeVersion ? 'v' + v.activeVersion.version : 'None' }}
          </p>
        </div>
        <div class="bf-kpi bf-kpi--warning">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Approvals in flight</p>
            <mat-icon class="bf-kpi__icon" svgIcon="clock" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">{{ v.impact.openTasksAffected | number }}</p>
          <p class="bf-kpi__delta">Re-checked against the new limits</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Delegations in place</p>
            <mat-icon class="bf-kpi__icon" svgIcon="users" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">{{ v.impact.delegationsAffected | number }}</p>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="limits-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="limits-title">
            Limits in version {{ v.selectedVersion.version }}
          </h2>
          <p class="bf-card__hint">
            Starts {{ v.selectedVersion.validFrom | date: 'd MMM y' }}. The most specific row wins:
            a named person beats a role, an exact spend type beats any spend type.
          </p>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table bf-table--stack" aria-label="Approval limits">
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
                  <td data-label="Spend type">{{ spendType(row.spendType) }}</td>
                  <td data-label="Legal entity">
                    @if (row.legalEntityCode) {
                      <span class="bf-cell__code">{{ row.legalEntityCode }}</span>
                    } @else {
                      Any entity
                    }
                  </td>
                  <td class="bf-num" data-label="Limit">
                    @if (row.changeMarker === 'removed') {
                      No authority
                    } @else {
                      <bf-money
                        [amountMinor]="row.limit.amountMinor"
                        [currency]="row.limit.currency"
                      />
                    }
                  </td>
                  <td class="bf-num" data-label="Was">
                    @if (row.previousLimitMinor !== null && row.previousLimitMinor !== undefined) {
                      <bf-money
                        [amountMinor]="row.previousLimitMinor"
                        [currency]="row.limit.currency"
                      />
                    } @else {
                      —
                    }
                  </td>
                  <td class="bf-nowrap" data-label="Change">
                    @let mark = markerLook(row);
                    <sat-status-tag [status]="mark.tone"
                      ><mat-icon [svgIcon]="mark.icon" aria-hidden="true" />{{
                        mark.label
                      }}</sat-status-tag
                    >
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
          <table class="bf-split-table bf-table--stack" aria-label="Approval limit versions">
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
                  <td>
                    <button
                      mat-button
                      type="button"
                      [disabled]="ver.id === (shown() ?? v.selectedVersion.id)"
                      [attr.aria-label]="'Show version ' + ver.version"
                      (click)="show(ver.id)"
                    >
                      v{{ ver.version }}
                    </button>
                  </td>
                  <td class="bf-nowrap" data-label="Status">
                    @let look = versionLook(ver.status);
                    <sat-status-tag [status]="look.tone"
                      ><mat-icon [svgIcon]="look.icon" aria-hidden="true" />{{
                        look.label
                      }}</sat-status-tag
                    >
                  </td>
                  <td class="bf-nowrap" data-label="In force">
                    {{ ver.validFrom | date: 'd MMM y' }}
                    @if (ver.validTo) {
                      to {{ ver.validTo | date: 'd MMM y' }}
                    } @else {
                      onwards
                    }
                  </td>
                  <td data-label="Approved by">{{ ver.approvedByName ?? 'Not approved yet' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    .bf-nowrap {
      white-space: nowrap;
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
  protected readonly shown = signal<string | undefined>(undefined);
  protected readonly view = resource({
    params: () => ({ versionId: this.shown() }),
    loader: ({ params }) =>
      data(
        this.api.getDoaMatrixAdmin({
          query: params.versionId ? { versionId: params.versionId } : {},
        }),
      ),
  });

  protected show(versionId: string): void {
    this.shown.set(versionId);
  }
  private readonly current = computed(() => valueOf(this.view));

  protected can(action: string): boolean {
    return (this.current()?.allowedActions ?? []).includes(action);
  }

  protected readonly spendType = spendTypeLabel;

  /** Waiting for approval is pending (warning, clock); in force is approved (success). */
  protected versionLook(status: string): StatusView {
    return VERSION_LOOKS[status] ?? { label: status, tone: 'neutral', icon: 'circle_minus' };
  }

  protected who(row: { personName?: string | null; role: string | null }): string {
    return row.personName ?? (row.role ? approverLabel(row.role) : 'Anyone');
  }

  /** A changed limit says which way it moved; a lower limit is the one that can block approvals. */
  protected markerLook(row: {
    changeMarker?: string;
    limit: { amountMinor: number };
    previousLimitMinor?: number | null;
  }): StatusView {
    const marker = row.changeMarker ?? 'unchanged';
    if (
      marker === 'changed' &&
      row.previousLimitMinor !== null &&
      row.previousLimitMinor !== undefined
    ) {
      return row.limit.amountMinor < row.previousLimitMinor
        ? { label: 'Lowered', tone: 'warning', icon: 'trending_down' }
        : { label: 'Raised', tone: 'info', icon: 'trending_up' };
    }
    return MARKER_LOOKS[marker] ?? MARKER_LOOKS['unchanged'];
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
