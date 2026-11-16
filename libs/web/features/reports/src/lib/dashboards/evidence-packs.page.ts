import { DecimalPipe, DOCUMENT, formatNumber } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { EvidenceContent, EvidencePack } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, startDownload, valueOf } from '../api';

const CONTENTS: { key: EvidenceContent; label: string; on: boolean }[] = [
  {
    key: 'summary',
    label: 'Summary cover (PDF): figures, timeline, funding, FX effect separately',
    on: true,
  },
  {
    key: 'approvals',
    label: 'Approvals and decisions: approver, delegate, DoA limit, rules, channel, reason',
    on: true,
  },
  { key: 'audit_trail', label: 'Audit trail extract with hash-chain verification', on: true },
  {
    key: 'contributions',
    label: 'Inter-Director Budget Contribution Requests and intercompany recharges',
    on: true,
  },
  { key: 'commitments', label: 'Commitments', on: true },
  { key: 'actuals', label: 'Actuals with receipts and invoices (documents)', on: true },
  { key: 'reconciliation', label: 'Reconciliation and close record', on: true },
  { key: 'exceptions', label: 'Exceptions and their resolutions', on: true },
  { key: 'comments', label: 'Comments', on: false },
];

const STATUS: Record<
  EvidencePack['status'],
  { text: string; tone: 'success' | 'info' | 'important' | 'neutral' | 'warning' }
> = {
  queued: { text: 'Queued', tone: 'info' },
  running: { text: 'Generating', tone: 'info' },
  ready: { text: 'Ready', tone: 'success' },
  failed: { text: 'Failed', tone: 'important' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' },
};

/**
 * Screen 088a: the one-click evidence pack. Auditors, the Finance Controller and the Finance Admin
 * generate a ZIP for one event or budget (worker job); anyone with audit access downloads it while
 * it is valid (7 days). The pack moves no money; generation and every download are audited.
 */
@Component({
  selector: 'bf-evidence-packs-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Evidence packs</h1>
        <p class="bf-page__subtitle">
          Everything about one event or budget in a single download, with a verified audit chain.
        </p>
      </div>
      @if (list()) {
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/audit-log"><mat-icon svgIcon="shield" />Audit log</a>
        </div>
      }
    </header>

    <bf-load-state
      [loading]="packs.isLoading() && !packs.hasValue()"
      [error]="packs.error()"
      what="evidence packs"
      shape="table"
      (retry)="packs.reload()"
    />

    @if (list(); as l) {
      @if (l.canGenerate) {
        <section class="bf-card" aria-labelledby="generate-title" data-testid="generate-pack">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="generate-title">Generate an evidence pack</h2>
              <p class="bf-card__hint">
                A ZIP file with a PDF summary, CSV files and the original documents, plus a manifest
                with a SHA-256 fingerprint for every file.
              </p>
            </div>
          </div>
          <div class="bf-card__body bf-gen">
            <div class="bf-filters">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Subject type</mat-label>
                <mat-select [ngModel]="subjectType()" (ngModelChange)="setType($event)">
                  <mat-option value="event">Event</mat-option>
                  <mat-option value="budget">Budget</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="bf-wide">
                <mat-label>{{ subjectType() === 'event' ? 'Event' : 'Budget' }}</mat-label>
                <mat-select [ngModel]="subjectId()" (ngModelChange)="subjectId.set($event)">
                  @for (s of subjects(); track s.id) {
                    <mat-option [value]="s.id">{{ s.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <fieldset class="bf-fieldset">
              <legend>Contents</legend>
              @for (c of contentOptions; track c.key) {
                <mat-checkbox
                  [ngModel]="chosen().has(c.key)"
                  (ngModelChange)="toggle(c.key, $event)"
                  >{{ c.label }}</mat-checkbox
                >
              }
              <mat-checkbox
                [ngModel]="includeAttendees()"
                (ngModelChange)="includeAttendees.set($event)"
                >Include attendee details (names, entities and cost centers; never needs or survey
                answers)</mat-checkbox
              >
            </fieldset>
            @if (problem(); as p) {
              <p class="bf-error-text" role="alert">{{ p }}</p>
            }
            <div class="bf-gen__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="!subjectId() || chosen().size === 0 || submitting()"
                (click)="generate()"
              >
                Generate
              </button>
            </div>
          </div>
        </section>
      }

      @if (active(); as a) {
        <section class="bf-card" aria-live="polite" data-testid="pack-progress">
          <div class="bf-card__header">
            <h2 class="bf-card__title">{{ a.subjectLabel }}</h2>
          </div>
          <div class="bf-card__body">
            @if (a.status === 'queued' || a.status === 'running') {
              <p>
                Collecting {{ a.step ?? 'the data' }}. You can leave this page; the list shows it
                when ready.
              </p>
              <mat-progress-bar mode="indeterminate" />
            } @else if (a.status === 'ready') {
              <p>
                Evidence pack ready, {{ size(a.sizeBytes) }}.
                @if (a.chain; as c) {
                  @if (c.valid) {
                    Audit chain verified: {{ c.checked | number }} entries intact.
                  }
                }
              </p>
            } @else if (a.status === 'failed') {
              <sat-banner variant="important">
                <sat-banner-message>{{
                  a.error ?? 'The pack could not be generated.'
                }}</sat-banner-message>
              </sat-banner>
            }
          </div>
        </section>
      }

      <section class="bf-card" aria-labelledby="packs-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="packs-title">Packs</h2>
        </div>
        @if (l.items.length === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No evidence packs yet</h3>
            <p satEmptyStateDescription>
              Choose an event or a budget above and generate one; it is kept for 7 days.
            </p>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Evidence packs">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Requested by</th>
                  <th>Generated</th>
                  <th class="bf-num">Size</th>
                  <th>Verification</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (p of l.items; track p.id) {
                  <tr [attr.data-testid]="'pack-' + p.id">
                    <td>
                      <span class="bf-cell__primary">{{ p.subjectLabel }}</span>
                      <span class="bf-cell__secondary">{{
                        p.subjectType === 'event' ? 'Event' : 'Budget'
                      }}</span>
                    </td>
                    <td>{{ p.requestedByName ?? '—' }}</td>
                    <td>
                      <sat-status-tag [status]="statusTone(p)">{{ statusText(p) }}</sat-status-tag>
                      @if (p.completedAt) {
                        <span class="bf-cell__secondary" data-testid="relative-time">{{
                          p.completedAt | bfDateTime: session.timezone()
                        }}</span>
                      }
                    </td>
                    <td class="bf-num">{{ p.sizeBytes === null ? '—' : size(p.sizeBytes) }}</td>
                    <td>
                      @if (p.chain; as c) {
                        @if (c.valid) {
                          <sat-status-tag status="success">Verified</sat-status-tag>
                        } @else {
                          <sat-status-tag status="important"
                            >Chain broken at {{ c.brokenAt }}</sat-status-tag
                          >
                        }
                      } @else {
                        —
                      }
                    </td>
                    <td>
                      <span data-testid="relative-time">{{
                        p.expiresAt | bfDateTime: session.timezone()
                      }}</span>
                    </td>
                    <td>
                      @if (p.canDownload) {
                        <button mat-stroked-button type="button" (click)="download(p)">
                          <mat-icon svgIcon="download" />Download
                        </button>
                      }
                      @if (l.canGenerate && (p.status === 'expired' || p.status === 'failed')) {
                        <button mat-button type="button" (click)="regenerate(p)">Regenerate</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .bf-gen {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-gen__actions {
      display: flex;
      justify-content: flex-end;
    }
    .bf-fieldset {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-small);
    }
    .bf-fieldset legend {
      font: var(--mat-sys-title-small);
      padding: 0 4px;
    }
    .bf-wide {
      min-width: 320px;
    }
    .bf-error-text {
      color: var(--mat-sys-error);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvidencePacksPage {
  private readonly api = injectApi();
  private readonly doc = inject(DOCUMENT);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);
  protected readonly contentOptions = CONTENTS;

  private readonly prefill = this.route.snapshot.queryParamMap;
  protected readonly subjectType = signal<'event' | 'budget'>(
    this.prefill.get('subjectType') === 'budget' ? 'budget' : 'event',
  );
  protected readonly subjectId = signal<string>(this.prefill.get('subjectId') ?? '');
  protected readonly chosen = signal(
    new Set<EvidenceContent>(CONTENTS.filter((c) => c.on).map((c) => c.key)),
  );
  protected readonly includeAttendees = signal(false);
  protected readonly submitting = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly active = signal<EvidencePack | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  protected readonly packs = resource({ loader: () => data(this.api.listEvidencePacks({})) });
  protected readonly list = computed(() => valueOf(this.packs));

  private readonly subjectList = resource({
    params: () => ({ type: this.subjectType(), can: this.list()?.canGenerate ?? false }),
    loader: async ({ params }) => {
      if (!params.can) return [];
      if (params.type === 'event') {
        const r = await data(this.api.listEvents({ query: { limit: 100 } }));
        return r.items.map((e) => ({ id: e.id, label: `${e.name} (${e.eventCode})` }));
      }
      const r = await data(this.api.listBudgets({ query: { limit: 200 } }));
      return r.items.map((b) => ({ id: b.id, label: b.name }));
    },
  });
  protected readonly subjects = computed(() => valueOf(this.subjectList) ?? []);

  protected setType(t: 'event' | 'budget'): void {
    this.subjectType.set(t);
    this.subjectId.set('');
  }

  protected toggle(key: EvidenceContent, on: boolean): void {
    const next = new Set(this.chosen());
    if (on) next.add(key);
    else next.delete(key);
    this.chosen.set(next);
  }

  protected statusText(p: EvidencePack): string {
    return STATUS[p.status].text;
  }

  protected statusTone(p: EvidencePack) {
    return STATUS[p.status].tone;
  }

  protected size(bytes: number | null): string {
    if (bytes === null) return '—';
    return bytes >= 1_048_576
      ? `${formatNumber(bytes / 1_048_576, 'en', '1.0-1')} MB`
      : `${formatNumber(bytes / 1024, 'en', '1.0-1')} KB`;
  }

  protected async generate(): Promise<void> {
    this.submitting.set(true);
    this.problem.set(null);
    try {
      const pack = await data(
        this.api.createEvidencePack({
          body: {
            subjectType: this.subjectType(),
            subjectId: this.subjectId(),
            contents: CONTENTS.map((c) => c.key).filter((k) => this.chosen().has(k)),
            includeAttendees: this.includeAttendees(),
          },
        }),
      );
      this.active.set(pack);
      this.packs.reload();
      this.poll(pack.id);
    } catch (e) {
      this.problem.set(errorMessage(e));
    } finally {
      this.submitting.set(false);
    }
  }

  protected regenerate(p: EvidencePack): void {
    this.subjectType.set(p.subjectType);
    this.subjectId.set(p.subjectId);
    this.chosen.set(new Set(p.contents));
    this.includeAttendees.set(p.includeAttendees);
    void this.generate();
  }

  private poll(id: string): void {
    this.timer = setTimeout(async () => {
      try {
        const p = await data(this.api.getEvidencePack({ params: { packId: id } }));
        this.active.set(p);
        if (p.status === 'queued' || p.status === 'running') this.poll(id);
        else {
          this.packs.reload();
          if (p.status === 'ready')
            this.snack.open('Evidence pack ready.', undefined, { duration: 4000 });
        }
      } catch (e) {
        this.problem.set(errorMessage(e));
      }
    }, 1500);
  }

  protected async download(p: EvidencePack): Promise<void> {
    try {
      const link = await data(this.api.downloadEvidencePack({ params: { packId: p.id } }));
      startDownload(this.doc, link.url, link.fileName);
    } catch (e) {
      this.problem.set(errorMessage(e));
    }
  }
}
