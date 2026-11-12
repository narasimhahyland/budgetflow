import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ImportBatch } from '@bf/contracts';
import {
  ACTUAL_IMPORT_FIELDS,
  REQUIRED_ACTUAL_FIELDS,
  resolveColumnMapping,
  type ActualImportField,
} from '@bf/domain';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { FileInput } from './file-input';

type Source = ImportBatch['source'];
type Step = 'upload' | 'map' | 'review' | 'posted';

const SOURCES: { value: Source; label: string }[] = [
  { value: 'erp', label: 'ERP export' },
  { value: 'card', label: 'Corporate card' },
  { value: 'expense', label: 'Expense reports' },
  { value: 'travel', label: 'Travel' },
  { value: 'ap', label: 'Accounts payable' },
];

const FIELD_LABEL: Record<ActualImportField, string> = {
  source_ref: 'Source reference',
  transaction_date: 'Transaction date',
  accounting_date: 'Accounting date',
  amount: 'Amount',
  currency: 'Currency',
  legal_entity: 'Legal entity code',
  cost_center: 'Cost center code',
  gl_account: 'GL account',
  event_code: 'Event code',
  vendor: 'Vendor',
  merchant: 'Merchant',
  memo: 'Description',
  reference: 'Commitment reference (PO)',
  original_ref: 'Original line (refunds, reversals)',
  kind: 'Line type',
  card_program: 'Card program',
  tax_amount: 'GST/VAT included in the amount',
  tax_category: 'Spend category (tax rules)',
  employees_present: 'Employees present',
  others_present: 'Clients or guests present',
};

const RULE_LABEL: Record<string, { title: string; hint: string; tag: string | null }> = {
  reference: {
    title: 'Commitment reference match',
    hint: 'PO or commitment number on the line',
    tag: 'High confidence',
  },
  event_cost_center: {
    title: 'Event code and cost center',
    hint: 'Open commitment of the event at that cost center',
    tag: 'Rule match',
  },
  vendor_amount: {
    title: 'Vendor and amount within 1%',
    hint: 'Same vendor, amount within tolerance',
    tag: 'Secondary rule',
  },
  mapping_rule: {
    title: 'Mapping rule',
    hint: 'Actual-to-budget mapping rules',
    tag: 'Rule match',
  },
  original_reference: {
    title: 'Refunds, credit notes and reversals',
    hint: 'Linked to the line they correct',
    tag: null,
  },
};

const TEMPLATE = [
  'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind',
  'ERP-0001,2026-11-03,124500.00,INR,HYL-IN,CC-IN-BLR-200,6100,BLR-ANNUAL-26,Spice Route Caterers,Annual Day catering,,,charge',
].join('\n');

/** Screen 80a: actuals import (upload, map columns, review auto-match results by currency, post). */
@Component({
  selector: 'bf-import-page',
  imports: [
    ActualsTabs,
    DateTimePipe,
    DecimalPipe,
    FileInput,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './import.page.html',
  styleUrls: ['./page.scss', './accounting.scss', './import.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly valueOf = valueOf;
  protected readonly sources = SOURCES;
  protected readonly fields = ACTUAL_IMPORT_FIELDS;
  protected readonly fieldLabel = FIELD_LABEL;
  protected readonly required = new Set<string>(REQUIRED_ACTUAL_FIELDS);
  protected readonly currencyColumns = ['currency', 'lines', 'transaction', 'rate', 'reporting'];
  protected readonly issueColumns = ['line', 'field', 'message'];
  protected readonly steps = [
    { n: 1, label: 'Upload', hint: 'CSV from ERP, card or expense' },
    { n: 2, label: 'Map columns', hint: 'Auto-mapped from headers' },
    { n: 3, label: 'Review', hint: 'Validation and matching' },
    { n: 4, label: 'Post', hint: 'Actuals ledger' },
  ];
  protected readonly timezone = computed(() => this.session.timezone());

  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly step = signal<Step>('upload');
  /** The upload form is open (otherwise the latest import's review is shown). */
  protected readonly composing = signal(false);
  protected readonly source = signal<Source>('erp');
  protected readonly fileName = signal<string | null>(null);
  protected readonly content = signal('');
  protected readonly mapping = signal<Record<string, string | null>>({});
  protected readonly batch = signal<ImportBatch | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly imports = resource({ loader: () => data(this.api.listActualsImports({})) });
  protected readonly queue = resource({
    loader: () => data(this.api.listActuals({ query: { status: 'queue', limit: 1 } })),
  });
  protected readonly queueCount = computed(() => valueOf(this.queue)?.counts.queue ?? null);

  /** The import shown when nothing is being uploaded: ?file= picks a file name, otherwise the most recent. */
  private readonly latest = computed(() => {
    const items = valueOf(this.imports)?.items ?? [];
    const file = this.route.snapshot.queryParamMap.get('file');
    return (file ? items.find((b) => b.fileName === file) : items[0]) ?? null;
  });
  protected readonly shown = computed(
    () => this.batch() ?? (this.step() === 'upload' && !this.composing() ? this.latest() : null),
  );

  protected readonly headers = computed(() => {
    const first =
      this.content()
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/, 1)[0] ?? '';
    return first
      .split(',')
      .map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter(Boolean);
  });
  protected readonly lineCount = computed(() =>
    Math.max(
      this.content()
        .split(/\r?\n/)
        .filter((l) => l.trim()).length - 1,
      0,
    ),
  );
  protected readonly missing = computed(() =>
    REQUIRED_ACTUAL_FIELDS.filter((f) => !this.mapping()[f]),
  );

  constructor() {
    effect(() => {
      const headers = this.headers();
      this.mapping.set(headers.length ? resolveColumnMapping(headers).mapping : {});
    });
  }

  protected readonly summary = computed(() => this.shown()?.summary ?? null);
  protected readonly matchedCount = computed(() => {
    const s = this.summary();
    return s ? s.autoMatched + s.partiallyMatched : 0;
  });
  protected readonly share = (n: number) => {
    const s = this.summary();
    return s && s.imported ? (n * 100) / s.imported : 0;
  };
  protected readonly periodLabel = computed(
    () => this.shown()?.summary.posted?.period?.label ?? null,
  );
  /** Current step for the stepper: the interactive step, or where the shown import is. */
  protected readonly stepIndex = computed(() => {
    const step = this.step();
    if (step === 'map') return 2;
    const b = this.shown();
    if (!b) return 1;
    return b.status === 'posted' ? 4 : 3;
  });

  protected fieldText(field: string): string {
    return FIELD_LABEL[field as ActualImportField] ?? field;
  }

  protected ruleLabel(rule: string) {
    return RULE_LABEL[rule] ?? { title: rule, hint: '', tag: null };
  }

  protected sourceLabel(source: string): string {
    return SOURCES.find((s) => s.value === source)?.label ?? source;
  }

  /** Plan rate as units per one reporting unit, four decimals ("83.2500"). */
  protected rate(value: string | null): string {
    if (!value) return '—';
    const [int, frac = ''] = value.split('.');
    return `${int}.${frac.padEnd(4, '0').slice(0, 4)}`;
  }

  protected setField(field: string, header: string | null): void {
    this.mapping.update((m) => ({ ...m, [field]: header }));
  }

  protected toMap(): void {
    this.failure.set(null);
    this.notice.set(null);
    this.step.set('map');
  }

  protected startOver(): void {
    this.composing.set(true);
    this.step.set('upload');
    this.batch.set(null);
    this.content.set('');
    this.fileName.set(null);
    this.failure.set(null);
  }

  protected async upload(): Promise<void> {
    await this.run(async () => {
      const columnMapping = Object.fromEntries(
        Object.entries(this.mapping()).filter((e): e is [string, string] => Boolean(e[1])),
      );
      const b = await data(
        this.api.uploadActualsImport({
          body: {
            source: this.source(),
            fileName: this.fileName() ?? 'pasted-actuals.csv',
            content: this.content(),
            columnMapping,
          },
        }),
      );
      this.batch.set(b);
      this.step.set('review');
    });
  }

  protected async post(): Promise<void> {
    const b = this.batch() ?? this.shown();
    if (!b) return;
    await this.run(async () => {
      const posted = await data(this.api.postActualsImport({ params: { batchId: b.id } }));
      this.batch.set(posted);
      this.step.set('posted');
      const p = posted.summary.posted;
      this.notice.set(
        `${p?.matched ?? 0} lines posted to ${p?.period?.label ?? 'the open period'}; ${p?.toQueue ?? 0} sent to the unmatched queue.`,
      );
      this.imports.reload();
      this.queue.reload();
    });
  }

  protected downloadTemplate(): void {
    const url = URL.createObjectURL(new Blob([TEMPLATE + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'actuals-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
