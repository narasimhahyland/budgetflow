import { JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import type { AuditEvent } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const TYPES = ['', 'event', 'request', 'contribution', 'budget', 'recharge', 'org_unit', 'person'];

/** Screen 88: the append-only, hash-chained audit trail with chain verification, filters, entry detail and export. */
@Component({
  selector: 'bf-audit-log-page',
  imports: [
    DateTimePipe,
    FormsModule,
    JsonPipe,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Audit log</h1>
          <sat-status-tag status="success">Tamper-evident</sat-status-tag>
        </div>
        <p class="bf-page__subtitle">
          Append-only, hash-chained record of every change: who, what, previous and new values, and
          why
        </p>
      </div>
      <div class="bf-page__actions">
        <button mat-stroked-button type="button" (click)="verification.reload()">
          <mat-icon svgIcon="shield" />Verify chain
        </button>
        <button mat-flat-button type="button" (click)="exportCsv()">
          <mat-icon svgIcon="download" />Export CSV
        </button>
      </div>
    </header>
    @if (valueOf(verification); as v) {
      <sat-banner [variant]="v.valid ? 'success' : 'important'" data-testid="chain-status">
        <sat-banner-message>
          @if (v.valid) {
            Chain verified: {{ v.checked }} immutable entries · last verified
            <span data-testid="relative-time">{{
              v.verifiedAt | bfDateTime: session.timezone()
            }}</span>
          } @else {
            Chain broken at entry {{ v.firstBrokenSeq }}: {{ v.reason }}. Later entries are
            unverified; security and the tenant admin are notified.
          }
        </sat-banner-message>
      </sat-banner>
    }
    <section class="bf-card" aria-labelledby="audit-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="audit-title">Entries, newest first</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Object type</mat-label>
          <mat-select [ngModel]="resourceType()" (ngModelChange)="setFilter('type', $event)">
            @for (t of types; track t) {
              <mat-option [value]="t">{{ t ? t.replace('_', ' ') : 'All' }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Action</mat-label>
          <input
            matInput
            [ngModel]="action()"
            (ngModelChange)="setFilter('action', $event)"
            placeholder="for example request.approved"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Object id</mat-label>
          <input
            matInput
            [ngModel]="resourceId()"
            (ngModelChange)="setFilter('resource', $event)"
          />
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="entries.isLoading() && !entries.hasValue()"
        [error]="entries.error()"
        what="the audit log"
        (retry)="entries.reload()"
      />
      @if (entries.hasValue()) {
        @if (rows().length === 0) {
          <p class="bf-empty">
            No entries for these filters.
            <button mat-button type="button" (click)="clear()">Clear filters</button>
          </p>
        } @else {
          <div class="bf-audit" [class.bf-split]="!!selected()">
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Audit entries">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Object</th>
                    <th>Reason</th>
                    <th>Entry hash</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of rows(); track e.id) {
                    <tr
                      class="bf-audit__row"
                      [class.bf-audit__row--active]="selected()?.id === e.id"
                      [class.bf-audit__row--broken]="broken(e)"
                      (click)="selected.set(e)"
                      (keydown.enter)="selected.set(e)"
                      tabindex="0"
                    >
                      <td>
                        <span data-testid="relative-time">{{
                          e.occurredAt | bfDateTime: session.timezone() : 'd MMM y, HH:mm'
                        }}</span>
                      </td>
                      <td>
                        {{
                          e.actorName ??
                            (e.actorSubject === 'system:worker' ? 'BudgetFlow' : e.actorSubject)
                        }}
                        @if (e.onBehalfOfName) {
                          <span class="bf-cell__secondary">for {{ e.onBehalfOfName }}</span>
                        }
                      </td>
                      <td>
                        <span class="bf-chip">{{ e.action }}</span>
                      </td>
                      <td>
                        {{ e.resourceType
                        }}<span class="bf-cell__secondary">{{ e.resourceId.slice(0, 8) }}</span>
                      </td>
                      <td>{{ e.reason ?? '' }}</td>
                      <td>
                        <code class="bf-audit__hash">{{ e.hash.slice(0, 10) }}…</code>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (valueOf(entries)?.nextCursor) {
                <div class="bf-form__actions">
                  <button mat-stroked-button type="button" (click)="limit.set(limit() + 50)">
                    Show more
                  </button>
                </div>
              }
            </div>
            @if (selected(); as s) {
              <aside class="bf-card" aria-labelledby="entry-title">
                <div class="bf-card__header">
                  <h3 class="bf-card__title" id="entry-title">Entry {{ s.seq }}</h3>
                  <button mat-button type="button" (click)="selected.set(null)">Close</button>
                </div>
                <dl class="bf-facts">
                  <div>
                    <dt>When</dt>
                    <dd>{{ s.occurredAt | bfDateTime: session.timezone() }}</dd>
                  </div>
                  <div>
                    <dt>Actor</dt>
                    <dd>{{ s.actorName ?? s.actorSubject }}</dd>
                  </div>
                  <div>
                    <dt>Delegation used</dt>
                    <dd>{{ s.onBehalfOfName ? 'On behalf of ' + s.onBehalfOfName : 'None' }}</dd>
                  </div>
                  <div>
                    <dt>Request id</dt>
                    <dd>{{ s.requestId ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt>Object</dt>
                    <dd>{{ s.resourceType }} {{ s.resourceId }}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{{ s.reason ?? '—' }}</dd>
                  </div>
                </dl>
                <div class="bf-section">
                  <h4 class="bf-section__title">Before and after</h4>
                  <pre class="bf-audit__diff">{{ s.changes | json }}</pre>
                  <h4 class="bf-section__title">Chain</h4>
                  <p class="bf-cell__secondary">
                    Previous hash <code>{{ s.prevHash }}</code>
                  </p>
                  <p class="bf-cell__secondary">
                    Entry hash <code>{{ s.hash }}</code>
                  </p>
                  <sat-status-tag [status]="broken(s) ? 'important' : 'success'">{{
                    broken(s) ? 'Hash mismatch' : 'Verified'
                  }}</sat-status-tag>
                </div>
              </aside>
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    .bf-audit__row {
      cursor: pointer;
    }
    .bf-audit__hash {
      display: inline-block;
      width: 11ch;
      overflow: hidden;
      white-space: nowrap;
    }
    .bf-audit__row--active td {
      background: var(--mat-sys-secondary-container);
    }
    .bf-audit__row--broken td {
      background: var(--sat-sys-important-container);
    }
    .bf-audit__diff {
      max-height: 320px;
      overflow: auto;
      margin: 0 0 12px;
      padding: 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-small);
      white-space: pre-wrap;
      word-break: break-word;
    }
    code {
      font: var(--mat-sys-body-small);
      word-break: break-all;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly types = TYPES;
  private readonly query = this.route.snapshot.queryParamMap;
  protected readonly resourceType = signal(this.query.get('type') ?? '');
  protected readonly action = signal(this.query.get('action') ?? '');
  protected readonly resourceId = signal(this.query.get('resource') ?? '');
  protected readonly limit = signal(50);
  protected readonly selected = signal<AuditEvent | null>(null);

  protected readonly verification = resource({ loader: () => data(this.api.verifyAuditChain({})) });
  protected readonly entries = resource({
    params: () => ({
      order: 'desc' as const,
      limit: Math.min(this.limit(), 200),
      ...(this.resourceType() ? { resourceType: this.resourceType() } : {}),
      ...(this.action().trim() ? { action: this.action().trim() } : {}),
      ...(this.resourceId().trim() ? { resourceId: this.resourceId().trim() } : {}),
    }),
    loader: ({ params }) => data(this.api.listAuditEvents({ query: params })),
  });
  protected readonly rows = computed(() => valueOf(this.entries)?.items ?? []);

  protected broken(e: AuditEvent): boolean {
    const v = valueOf(this.verification);
    return Boolean(v && !v.valid && v.firstBrokenSeq !== null && e.seq >= v.firstBrokenSeq);
  }

  protected setFilter(key: 'type' | 'action' | 'resource', value: string): void {
    ({ type: this.resourceType, action: this.action, resource: this.resourceId })[key].set(
      value ?? '',
    );
    this.selected.set(null);
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected clear(): void {
    this.resourceType.set('');
    this.action.set('');
    this.resourceId.set('');
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  protected exportCsv(): void {
    const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const rows = [
      [
        'Seq',
        'Time (UTC)',
        'Actor',
        'On behalf of',
        'Action',
        'Object type',
        'Object id',
        'Reason',
        'Hash',
      ],
    ];
    for (const e of this.rows())
      rows.push([
        String(e.seq),
        e.occurredAt,
        e.actorName ?? e.actorSubject ?? '',
        e.onBehalfOfName ?? '',
        e.action,
        e.resourceType,
        e.resourceId,
        e.reason ?? '',
        e.hash,
      ]);
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
