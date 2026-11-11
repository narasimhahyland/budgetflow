import { formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { AiProvenance, AiSourceRef, SummaryFigure, SuppressibleFigure } from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

/**
 * How an aggregate is written out once BudgetFlow has decided it is safe to show. The API hands
 * back thousandths in every case (`valueMilli`), so the unit lives here rather than in each screen:
 * a pulse rating is out of five, eNPS is a signed whole number and retention is a percentage.
 */
export type FigureKind = 'rating' | 'percent' | 'enps';

export function formatSuppressible(figure: SuppressibleFigure, kind: FigureKind): string {
  const value = figure.valueMilli;
  if (value === null) return '';
  switch (kind) {
    case 'rating':
      return `${formatNumber(value / 1000, 'en-US', '1.1-1')} of 5`;
    case 'enps':
      return `${value > 0 ? '+' : ''}${Math.round(value / 10)}`;
    case 'percent':
      return `${formatNumber(value / 10, 'en-US', '1.1-1')}%`;
  }
}

/** A group size in words, so every figure on screen says how many people stand behind it. */
export const groupSizeText = (figure: SuppressibleFigure, noun: 'responses' | 'people'): string =>
  `${figure.groupSize} ${figure.groupSize === 1 ? noun.replace(/s$/, '') : noun}`;

/**
 * An aggregate the API may have refused to disclose.
 *
 * A suppressed figure is rendered as the threshold it fell under — "Fewer than 5 responses" — and
 * never as a blank or a zero. Blank reads as "we have no data" and zero reads as "the answer is
 * nought"; both are claims BudgetFlow is not making. What it is actually saying is that the group
 * behind the number is too small to show without pointing at a person.
 */
@Component({
  selector: 'bf-suppressible',
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @let f = figure();
    @if (f.suppressed) {
      <span
        class="bf-suppressed"
        [attr.data-testid]="testId() ? testId() + '-suppressed' : null"
        [matTooltip]="tooltip()"
        tabindex="0"
      >
        <mat-icon svgIcon="shield_lock" class="bf-suppressed__icon" />
        {{ f.suppressionReason ?? 'Too few to show' }}
      </span>
    } @else {
      <span class="bf-figure" [attr.data-testid]="testId()">
        <span class="bf-figure__value">{{ text() }}</span>
        <span class="bf-figure__group">of {{ group() }}</span>
      </span>
    }
  `,
  styles: `
    .bf-suppressed {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      cursor: help;
    }
    .bf-suppressed__icon {
      width: 16px;
      height: 16px;
    }
    .bf-figure {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
    }
    .bf-figure__value {
      font-variant-numeric: tabular-nums;
    }
    .bf-figure__group {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Suppressible {
  readonly figure = input.required<SuppressibleFigure>();
  readonly kind = input<FigureKind>('percent');
  /** What the group behind the figure is made of, so the sentence reads naturally. */
  readonly noun = input<'responses' | 'people'>('responses');
  readonly testId = input<string | null>(null);

  protected readonly text = computed(() => formatSuppressible(this.figure(), this.kind()));
  protected readonly group = computed(() => groupSizeText(this.figure(), this.noun()));
  protected readonly tooltip = computed(
    () =>
      `This group has ${groupSizeText(this.figure(), this.noun())}, which is too few to show without identifying someone. BudgetFlow drops the figure rather than estimating it.`,
  );
}

/** One piece of a drafted section: either words the model wrote, or a figure BudgetFlow read. */
interface Segment {
  text: string;
  figure: SummaryFigure | null;
  /** A token with no figure behind it; shown as a gap rather than as raw `{{figure:x}}`. */
  missing: boolean;
}

const TOKEN = /\{\{figure:([a-z0-9_]+)\}\}/g;

/** The value of a drafted figure, in the unit the ledger produced it in. */
export function formatSummaryFigure(figure: SummaryFigure): string {
  if (figure.unit === 'money' && figure.value)
    return formatMoney(figure.value.amountMinor, figure.value.currency);
  const n = figure.numericValue;
  if (n === null) return '';
  switch (figure.unit) {
    case 'percent_bps':
      return `${formatNumber(n / 100, 'en-US', '1.1-1')}%`;
    case 'rating_milli':
      return `${formatNumber(n / 1000, 'en-US', '1.1-1')} of 5`;
    default:
      return String(n);
  }
}

/**
 * A drafted section, with every `{{figure:token}}` replaced by the figure the API attached to it.
 *
 * The replacement happens here and only here. The model writes the sentences and leaves a token
 * where a number belongs; BudgetFlow fills the token from the `figures` array, which was read from
 * the reconciled ledger read models. That is what makes the number in a summary checkable: it is
 * not a number the model chose to type, and hovering it names the record it came from.
 */
@Component({
  selector: 'bf-summary-text',
  imports: [MatTooltipModule],
  template: `<p class="bf-summary-text" [attr.data-testid]="testId()">
    @for (s of segments(); track $index) {
      @if (s.figure) {
        <span
          class="bf-summary-text__figure"
          [matTooltip]="tooltip(s.figure)"
          tabindex="0"
          [attr.data-testid]="'figure-' + s.figure.token"
          >{{ s.text }}</span
        >
      } @else if (s.missing) {
        <span class="bf-summary-text__missing">(figure not available)</span>
      } @else {
        {{ s.text }}
      }
    }
  </p>`,
  styles: `
    .bf-summary-text {
      margin: 0;
      font: var(--mat-sys-body-medium);
      white-space: pre-wrap;
    }
    .bf-summary-text__figure {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      text-decoration: underline dotted;
      text-underline-offset: 3px;
      cursor: help;
    }
    .bf-summary-text__missing {
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryText {
  readonly text = input.required<string>();
  readonly figures = input.required<readonly SummaryFigure[]>();
  readonly testId = input<string | null>(null);

  protected readonly segments = computed<Segment[]>(() => {
    const byToken = new Map(this.figures().map((f) => [f.token, f]));
    const out: Segment[] = [];
    let last = 0;
    const source = this.text();
    for (const match of source.matchAll(TOKEN)) {
      const at = match.index;
      if (at > last) out.push({ text: source.slice(last, at), figure: null, missing: false });
      const figure = byToken.get(match[1]);
      out.push(
        figure
          ? { text: formatSummaryFigure(figure), figure, missing: false }
          : { text: '', figure: null, missing: true },
      );
      last = at + match[0].length;
    }
    if (last < source.length) out.push({ text: source.slice(last), figure: null, missing: false });
    return out;
  });

  protected tooltip(figure: SummaryFigure): string {
    return `${figure.label}: read by BudgetFlow from ${figure.source.label} (${figure.source.type.replace(/_/g, ' ')}).`;
  }
}

/** The records a drafted text was built from; only records the reader may open are listed. */
@Component({
  selector: 'bf-sources',
  imports: [MatButtonModule, RouterLink],
  template: `
    <div class="bf-sources">
      <button
        mat-button
        type="button"
        (click)="open.set(!open())"
        [attr.aria-expanded]="open()"
        [attr.data-testid]="testId()"
      >
        {{ sources().length }} {{ sources().length === 1 ? 'record' : 'records' }} used
      </button>
      @if (open()) {
        <ul class="bf-sources__list">
          @for (s of sources(); track s.type + s.id) {
            <li>
              @if (link(s); as href) {
                <a [routerLink]="href">{{ s.label }}</a>
              } @else {
                <span>{{ s.label }}</span>
              }
              <span class="bf-cell__secondary">{{ s.type.replace('_', ' ') }}</span>
            </li>
          } @empty {
            <li>
              <span class="bf-cell__secondary">No records were in scope for this draft.</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .bf-sources__list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sources {
  readonly sources = input.required<readonly AiSourceRef[]>();
  readonly testId = input<string | null>(null);
  protected readonly open = signal(false);

  protected link(source: AiSourceRef): string | null {
    const routes: Partial<Record<AiSourceRef['type'], string>> = {
      budget: '/budgets',
      event: '/events',
      request: '/requests',
    };
    const base = routes[source.type];
    return base ? `${base}/${source.id}` : null;
  }
}

/** The AI label: drafted text always says so, next to the model that drafted it. */
@Component({
  selector: 'bf-ai-draft-note',
  imports: [MatIconModule, SatStatusTag],
  template: `
    <div class="bf-ai-note">
      <sat-status-tag status="info" data-testid="ai-label">
        <mat-icon svgIcon="ai" />
        {{ label() }}
      </sat-status-tag>
      @if (provenance(); as p) {
        <span class="bf-cell__secondary">
          Model {{ p.modelId }} {{ p.modelVersion }} through {{ p.provider }}. Query log entry
          <span data-testid="ai-ids">{{ p.queryLogId.slice(0, 8) }}</span
          >.
        </span>
      }
    </div>
  `,
  styles: `
    .bf-ai-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .bf-ai-note [data-testid='ai-ids'] {
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiDraftNote {
  readonly label = input('AI draft');
  readonly provenance = input<AiProvenance | null>(null);
}
