import { DatePipe, DecimalPipe } from '@angular/common';
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
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import type { HeadcountImportResult } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { CsvInput } from './csv-input';
import { LoadState } from './load-state';

const TEMPLATE = 'location_code,team_code,employment_type,headcount,prorated_headcount';

const EXAMPLE =
  'location_code,team_code,employment_type,headcount,prorated_headcount\nBLR,BLR-ENG-PLAT,employee,46,45.5';

/** Screen 22c: HR headcount import and refresh by location and team. */
@Component({
  selector: 'bf-headcount-page',
  imports: [
    CsvInput,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './headcount.page.html',
  styleUrl: './page.scss',
  styles: `
    .bf-steps {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      margin: 0;
      padding: 4px 20px 12px;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .bf-steps__n {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      margin-inline-end: 6px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }
    .bf-steps--current {
      color: var(--mat-sys-primary);
    }
    .bf-steps--current .bf-steps__n {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .bf-steps--done .bf-steps__n {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .bf-file {
      margin: 0 0 12px;
      font: var(--mat-sys-title-small);
    }
    .bf-kpi--error .bf-kpi__value {
      color: var(--mat-sys-error);
    }
    .bf-review {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
      gap: 16px;
      padding: 0 20px 12px;
    }
    @media (max-width: 960px) {
      .bf-review {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-review__title {
      margin: 8px 0;
      font: var(--mat-sys-title-small);
    }
    .bf-review__errors {
      padding: 0 12px 12px;
      border: 1px solid var(--mat-sys-error);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .bf-errors {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
      font: var(--mat-sys-body-small);
    }
    .bf-errors span {
      display: block;
    }
    .bf-footer-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 20px 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-footer-bar .bf-card__hint {
      margin: 0 0 12px;
    }
    .bf-history {
      margin: 0;
      padding: 0 20px 16px 40px;
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeadcountPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly example = EXAMPLE;
  protected readonly columns = ['unit', 'employees', 'contractors', 'interns', 'total', 'change'];
  protected readonly issueColumns = ['line', 'field', 'message'];
  protected readonly asOf = signal(todayIso());
  protected readonly importing = signal(false);
  protected readonly csv = signal('');
  protected readonly importDate = signal(todayIso());
  protected readonly preview = signal<HeadcountImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly summary = resource({
    params: () => ({ asOf: this.asOf() }),
    loader: ({ params }) => data(this.api.getHeadcount({ query: params })),
  });

  protected readonly canImport = computed(() => this.session.can('headcount.import'));
  protected readonly fileName = signal<string | null>(null);
  protected readonly showHistory = signal(false);
  protected readonly step = computed(() => (this.preview() ? 2 : 1));
  protected readonly locationColumns = ['location', 'entity', 'previous', 'new', 'change'];

  protected readonly history = resource({
    params: () => (this.showHistory() ? {} : undefined),
    loader: () => data(this.api.listHeadcountSnapshots({})),
  });
  protected readonly entities = resource({
    params: () => (this.importing() ? {} : undefined),
    loader: () => data(this.api.listLegalEntities({})),
  });
  protected readonly entityCode = computed(
    () => new Map((valueOf(this.entities)?.items ?? []).map((e) => [e.id, e.code])),
  );
  protected readonly locationTotals = computed(() => {
    const rows = this.preview()?.locations ?? [];
    return {
      previous: rows.reduce((s, r) => s + (r.previousHeadcount ?? 0), 0),
      next: rows.reduce((s, r) => s + r.headcount, 0),
      hasPrevious: rows.some((r) => r.previousHeadcount !== null),
    };
  });

  protected downloadTemplate(): void {
    const blob = new Blob([`${TEMPLATE}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'headcount-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  protected readonly totals = computed(() => {
    const s = valueOf(this.summary);
    const t = { employee: 0, contractor: 0, intern: 0, previous: 0, hasPrevious: false };
    for (const l of s?.locations ?? []) {
      t.employee += l.byType.employee;
      t.contractor += l.byType.contractor;
      t.intern += l.byType.intern;
      if (l.previousHeadcount !== null) {
        t.previous += l.previousHeadcount;
        t.hasPrevious = true;
      }
    }
    return t;
  });

  /** Location rows followed by their team rows, for one table. */
  protected readonly rows = computed(() =>
    (valueOf(this.summary)?.locations ?? []).flatMap((l) => [
      { ...l, level: 0 },
      ...l.teams.map((t) => ({ ...t, level: 1 })),
    ]),
  );

  protected delta(current: number, previous: number | null): string {
    if (previous === null) return '—';
    const d = current - previous;
    return d === 0 ? 'No change' : `${d > 0 ? '+' : ''}${d}`;
  }

  protected startImport(): void {
    this.importing.set(true);
    this.preview.set(null);
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async validate(): Promise<void> {
    await this.call(true);
  }

  protected async apply(): Promise<void> {
    await this.call(false);
  }

  private async call(dryRun: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.importHeadcount({
          body: {
            csv: this.csv(),
            asOfDate: this.importDate(),
            dryRun,
            ...(this.fileName() ? { fileName: this.fileName()! } : {}),
          },
        }),
      );
      if (dryRun) {
        this.preview.set(r);
      } else {
        this.notice.set(
          `Imported ${r.totalHeadcount} people on ${r.lineCount} lines as of ${r.asOfDate}.`,
        );
        this.importing.set(false);
        this.preview.set(null);
        this.csv.set('');
        if (r.asOfDate > this.asOf()) this.asOf.set(r.asOfDate);
        this.summary.reload();
      }
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
