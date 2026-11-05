import { DatePipe } from '@angular/common';
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
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { TieOut } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, toMinor, valueOf } from './api';
import { FileInput } from './file-input';
import { LoadState } from './load-state';

type Line = TieOut['lines'][number];

const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Screen 80c: BudgetFlow-to-GL tie-out by entity, cost center, account and period with monthly sign-off. */
@Component({
  selector: 'bf-tieout-page',
  imports: [
    DatePipe,
    DateTimePipe,
    FileInput,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './tieout.page.html',
  styleUrls: ['./page.scss', './accounting.scss'],
  styles: `
    .bf-check {
      display: flex;
      gap: 10px;
      margin: 0;
      padding: 8px 0;
    }
    .bf-check__icon--ok {
      color: var(--sat-sys-success-icon);
    }
    .bf-check__icon--warn {
      color: var(--sat-sys-warning-icon);
    }
    .bf-check__icon--bad {
      color: var(--sat-sys-important-icon);
    }
    .bf-check__detail--warn {
      color: var(--sat-sys-on-warning-container);
    }
    .bf-check__detail--bad {
      color: var(--sat-sys-on-important-container);
    }
    .bf-signoff {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px 20px;
    }
    .bf-signoff__people {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      margin: 0;
      padding-top: 12px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-signoff__people dd {
      margin: 0;
      text-align: end;
    }
    .bf-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-lowest);
      font: var(--mat-sys-label-large);
      cursor: pointer;
    }
    .bf-chip--warn {
      border-color: var(--sat-sys-warning-icon);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }
    .bf-chip--ok {
      border-color: var(--sat-sys-success-icon);
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
    }
    .bf-chip--selected {
      outline: 2px solid var(--mat-sys-primary);
    }
    .bf-row--difference td {
      background: var(--sat-sys-warning-container);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TieOutPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = [
    'account',
    'costCenter',
    'gl',
    'budgetflow',
    'difference',
    'status',
  ];
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canPrepare = computed(() => this.session.can('actuals.manage'));
  protected readonly canSign = computed(() => this.session.can('gl.sign_off'));
  protected readonly months = Array.from(
    { length: 12 },
    (_, i) => `2026-${String(i + 1).padStart(2, '0')}`,
  );
  protected readonly monthLabel = monthLabel;

  protected readonly month = signal(todayIso().slice(0, 7));
  protected readonly entityId = signal<string | null>(null);
  protected readonly entities = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly list = resource({
    params: () => ({ month: this.month() }),
    loader: ({ params }) => data(this.api.listTieOuts({ query: params })),
  });
  protected readonly runs = computed(() => valueOf(this.list)?.items ?? []);
  protected readonly run = computed(() => {
    const runs = this.runs();
    const id = this.entityId();
    return (
      runs.find((r) => r.legalEntityId === id) ??
      (id
        ? null
        : (runs.find((r) => r.status !== 'reconciled' && r.status !== 'signed_off') ??
          runs[0] ??
          null))
    );
  });

  protected readonly selectedLine = signal<string | null>(null);
  protected readonly drill = resource({
    params: () => {
      const r = this.run();
      const l = this.selectedLine();
      return r && l ? { tieOutId: r.id, lineId: l } : undefined;
    },
    loader: ({ params }) => data(this.api.getTieOutLine({ params })),
  });

  protected readonly explaining = signal<string | null>(null);
  protected readonly explanation = signal('');
  protected readonly comment = signal('');
  protected readonly preparing = signal(false);
  protected readonly prepEntity = signal<string | null>(null);
  protected readonly prepTolerance = signal('50.00');
  protected readonly prepFile = signal<string | null>(null);
  protected readonly prepContent = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.run();
      this.selectedLine.set(null);
      this.explaining.set(null);
    });
  }

  protected readonly aboveTolerance = computed(() => {
    const r = this.run();
    return r
      ? r.lines
          .filter((l) => !l.withinTolerance)
          .reduce((s, l) => s + Math.abs(l.difference.amountMinor), 0)
      : 0;
  });
  protected readonly isPreparer = computed(() => {
    const r = this.run();
    return Boolean(r?.preparedByPersonId && r.preparedByPersonId === this.session.me()?.personId);
  });
  protected readonly signBlockedReason = computed(() => {
    const r = this.run();
    if (!r) return null;
    if (r.status === 'signed_off') return null;
    if (!this.canSign()) return 'Sign-off needs a finance admin.';
    if (this.isPreparer()) return 'The person who prepared the tie-out cannot sign it off.';
    if (r.unexplainedExceptions > 0)
      return 'Resolve differences above tolerance or add an explanation.';
    return null;
  });

  protected chipText(r: TieOut): string {
    if (r.status === 'signed_off') return 'Signed off';
    return r.exceptions ? `${r.exceptions} difference${r.exceptions === 1 ? '' : 's'}` : 'Tied';
  }

  protected money(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  protected selectLine(l: Line): void {
    this.selectedLine.set(this.selectedLine() === l.id ? null : l.id);
  }

  protected startExplain(): void {
    const r = this.run();
    const target =
      r?.lines.find((l) => l.id === this.selectedLine() && !l.withinTolerance) ??
      r?.lines.find((l) => !l.withinTolerance && !l.explanation);
    if (!target) return;
    this.explaining.set(target.id);
    this.explanation.set(target.explanation ?? '');
  }

  protected async explain(): Promise<void> {
    const r = this.run();
    const lineId = this.explaining();
    if (!r || !lineId) return;
    await this.run$(async () => {
      await data(
        this.api.explainTieOutLine({
          params: { tieOutId: r.id, lineId },
          body: { explanation: this.explanation() },
        }),
      );
      this.notice.set('Explanation added.');
      this.explaining.set(null);
      this.list.reload();
    });
  }

  protected async signOff(): Promise<void> {
    const r = this.run();
    if (!r) return;
    await this.run$(async () => {
      const after = await data(
        this.api.signOffTieOut({
          params: { tieOutId: r.id },
          body: this.comment().trim() ? { comment: this.comment().trim() } : {},
        }),
      );
      this.notice.set(
        `${after.legalEntityCode} ${after.period.label} signed off. The tie-out is locked.`,
      );
      this.list.reload();
    });
  }

  protected async prepare(): Promise<void> {
    await this.run$(async () => {
      const r = await data(
        this.api.createTieOut({
          body: {
            legalEntityId: this.prepEntity()!,
            month: this.month(),
            toleranceMinor: toMinor(this.prepTolerance(), 'USD') ?? 0,
            fileName: this.prepFile() ?? 'gl-balances.csv',
            content: this.prepContent(),
          },
        }),
      );
      this.notice.set(
        `Tie-out for ${r.legalEntityCode} ${r.period.label} prepared: ${r.exceptions} difference(s) above tolerance.`,
      );
      this.preparing.set(false);
      this.entityId.set(r.legalEntityId);
      this.list.reload();
    });
  }

  protected async exportCsv(): Promise<void> {
    const r = this.run();
    if (!r) return;
    await this.run$(async () => {
      const file = await data(this.api.exportTieOut({ params: { tieOutId: r.id } }));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  private async run$(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
