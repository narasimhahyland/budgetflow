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
import { data, errorMessage, injectApi, todayIso } from './api';
import { CsvInput } from './csv-input';
import { LoadState } from './load-state';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeadcountPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly example = EXAMPLE;
  protected readonly columns = ['unit', 'employees', 'contractors', 'interns', 'total', 'change'];
  protected readonly previewColumns = [
    'unit',
    'employees',
    'contractors',
    'interns',
    'total',
    'change',
  ];
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

  protected readonly totals = computed(() => {
    const s = this.summary.value();
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
    (this.summary.value()?.locations ?? []).flatMap((l) => [
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
          body: { csv: this.csv(), asOfDate: this.importDate(), dryRun },
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
