import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type {
  AiConfidence,
  AiFigure,
  AiProvenance,
  AiRefusal,
  AiSourceRef,
  AiOutcome,
} from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { errorStatus, problemCode } from './api';

/**
 * The shared AI output pattern of 011a, used by every P13 surface (16b, 17c, 22d, 61f, 69a, 80f,
 * 121a): the AI label, the records the output was built from, the plain sentences behind it,
 * confidence in words, and the provenance line.
 *
 * The split these components enforce is the point of the whole layer: `bf-ai-figures` renders money
 * that BudgetFlow read from its own ledger read models, each figure carrying the record it came
 * from, while model-written prose only ever appears inside `bf-ai-prose`, under an AI label. No
 * component here parses a number out of model text.
 */

/** The AI label: a neutral status tag with the AI icon and words, never an unlabelled output. */
@Component({
  selector: 'bf-ai-label',
  imports: [MatIconModule, SatStatusTag],
  template: `
    <sat-status-tag status="info" data-testid="ai-label">
      <mat-icon svgIcon="ai" />
      {{ text() }}
    </sat-status-tag>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiLabel {
  /** "AI answer", "AI suggestion", "AI flag": what kind of model output this is. */
  readonly text = input('AI answer');
}

/** Model-written prose. Everything inside is words from the model, never a figure to act on. */
@Component({
  selector: 'bf-ai-prose',
  template: `
    <div class="bf-ai-prose" data-testid="ai-prose">
      <p class="bf-ai-prose__text">{{ text() }}</p>
      <p class="bf-ai-prose__note">{{ note() }}</p>
    </div>
  `,
  styles: `
    .bf-ai-prose {
      padding: 12px 14px;
      border-inline-start: 3px solid var(--sat-sys-info);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--sat-sys-info-container);
      color: var(--sat-sys-on-info-container);
    }
    .bf-ai-prose__text {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
    .bf-ai-prose__note {
      margin: 8px 0 0;
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiProse {
  readonly text = input.required<string>();
  /** True on every surface: the model writes sentences, BudgetFlow reads the amounts. */
  readonly note = input(
    'Written by the model. Every amount BudgetFlow shows is read from its own records.',
  );
}

/**
 * Figures BudgetFlow rendered from its own read models. Each row names the record it was read from,
 * so a reader can tell these apart from the sentences above them at a glance.
 */
@Component({
  selector: 'bf-ai-figures',
  imports: [Money],
  template: `
    <div class="bf-ai-figures">
      <p class="bf-ai-figures__caption" data-testid="figures-caption">
        BudgetFlow figures, read from the ledger{{ asOf() ? ' as of ' + asOf() : '' }}. Not written
        by the model.
      </p>
      <table class="bf-split-table" [attr.aria-label]="label()">
        <thead>
          <tr>
            <th>Figure</th>
            <th class="bf-num">Amount</th>
            <th>Read from</th>
          </tr>
        </thead>
        <tbody>
          @for (f of figures(); track f.key + f.source.id) {
            <tr [attr.data-testid]="'figure-' + f.key">
              <td>{{ f.label }}</td>
              <td class="bf-num">
                <bf-money [amountMinor]="f.amount.amountMinor" [currency]="f.amount.currency" />
              </td>
              <td>
                <span class="bf-cell__primary">{{ f.source.label }}</span>
                <span class="bf-cell__secondary">{{ f.source.type }}</span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .bf-ai-figures__caption {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiFigures {
  readonly figures = input.required<readonly AiFigure[]>();
  readonly asOf = input<string | null>(null);
  readonly label = input('BudgetFlow figures');
}

/** The records the output was built from: only records the viewer may read, each one a link. */
@Component({
  selector: 'bf-ai-sources',
  imports: [MatButtonModule, RouterLink],
  template: `
    <div class="bf-ai-sources">
      <button
        mat-button
        type="button"
        (click)="open.set(!open())"
        [attr.aria-expanded]="open()"
        data-testid="sources-toggle"
      >
        {{ sources().length }} {{ sources().length === 1 ? 'record' : 'records' }} used
      </button>
      @if (open()) {
        <ul class="bf-ai-sources__list" data-testid="sources-list">
          @for (s of sources(); track s.type + s.id) {
            <li>
              @if (link(s); as href) {
                <a [routerLink]="href" [attr.aria-label]="s.type + ' ' + s.label">{{ s.label }}</a>
              } @else {
                <span>{{ s.label }}</span>
              }
              <span class="bf-cell__secondary">{{ s.type }}</span>
            </li>
          }
          @if (sources().length === 0) {
            <li><span class="bf-cell__secondary">No records were in scope for this call.</span></li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .bf-ai-sources__list {
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
export class AiSources {
  readonly sources = input.required<readonly AiSourceRef[]>();
  protected readonly open = signal(false);

  /** Only record types with a screen get a link; the rest render as plain text. */
  protected link(source: AiSourceRef): string | null {
    const routes: Partial<Record<AiSourceRef['type'], string>> = {
      budget: '/budgets',
      event: '/events',
      request: '/requests',
      rule: '/admin/rules',
    };
    const base = routes[source.type];
    return base ? `${base}/${source.id}` : null;
  }
}

/** One or two plain sentences with the key facts behind the output, plus confidence in words. */
@Component({
  selector: 'bf-ai-why',
  imports: [SatStatusTag],
  template: `
    <div class="bf-ai-why">
      @if (why().length) {
        <h4 class="bf-ai-why__title">Why</h4>
        <ul class="bf-ai-why__list" data-testid="ai-why">
          @for (line of why(); track line) {
            <li>{{ line }}</li>
          }
        </ul>
      }
      @if (confidence(); as c) {
        <sat-status-tag [status]="tone()" data-testid="ai-confidence"
          >{{ word() }} confidence</sat-status-tag
        >
      }
    </div>
  `,
  styles: `
    .bf-ai-why {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .bf-ai-why__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-ai-why__list {
      margin: 0;
      padding-inline-start: 20px;
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiWhy {
  readonly why = input<readonly string[]>([]);
  readonly confidence = input<AiConfidence | null>(null);
  protected readonly word = computed(() => {
    const c = this.confidence();
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
  });
  protected readonly tone = computed(() =>
    this.confidence() === 'high' ? 'success' : this.confidence() === 'medium' ? 'info' : 'warning',
  );
}

/**
 * Where an AI output came from: suggestion, model and query-log ids. Carried into the audit entry of
 * any change the output leads to, so this line is what makes an accepted suggestion reconstructable.
 */
@Component({
  selector: 'bf-ai-provenance',
  template: `
    <p class="bf-ai-provenance" data-testid="ai-provenance">
      AI-generated. Check the figures before you act. Model {{ provenance().modelId }}
      {{ provenance().modelVersion }} through {{ provenance().provider }}. Query log entry
      <!-- Ids are generated per call, so visual baselines mask them. -->
      <span data-testid="ai-ids">
        {{ provenance().queryLogId.slice(0, 8) }}
        @if (provenance().suggestionId) {
          , suggestion {{ provenance().suggestionId!.slice(0, 8) }}
        }
      </span>
      .
    </p>
  `,
  styles: `
    .bf-ai-provenance {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiProvenanceNote {
  readonly provenance = input.required<AiProvenance>();
}

/**
 * The refusal states. Each kind reads differently on purpose: `discarded_unreliable` means the figure
 * guard caught the model stating a number that is not in the retrieved facts, which is worth saying
 * plainly rather than hiding behind a generic error, and an action request is always redirected to
 * the screen where a person does the work themselves.
 */
@Component({
  selector: 'bf-ai-refusal',
  imports: [MatButtonModule, RouterLink, SAT_BANNER_IMPORTS],
  template: `
    <div class="bf-ai-refusal">
      <sat-banner [variant]="variant()" [attr.data-testid]="'refusal-' + outcome()">
        <sat-banner-message>
          <strong>{{ headline() }}</strong>
          {{ refusal().message }}
        </sat-banner-message>
      </sat-banner>
      @if (redirect(); as r) {
        <a mat-stroked-button [routerLink]="r.path" data-testid="refusal-redirect">
          {{ r.label }}
        </a>
      }
    </div>
  `,
  styles: `
    .bf-ai-refusal {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRefusalCard {
  readonly refusal = input.required<AiRefusal>();
  readonly outcome = input<AiOutcome>('refused_out_of_scope');

  protected readonly variant = computed(() =>
    this.refusal().kind === 'unreliable' ? 'warning' : 'info',
  );
  protected readonly headline = computed(() => {
    switch (this.refusal().kind) {
      case 'action':
        return 'BudgetFlow AI does not act.';
      case 'unreliable':
        return 'Answer discarded: a figure in it was not in BudgetFlow\u2019s records.';
      case 'out_of_scope':
        return 'Outside what you can see.';
      case 'not_covered':
        return 'No policy covers this.';
      default:
        return 'Not answered.';
    }
  });

  /** `AiRefusal.redirect` names the screen for an action request; send the person there. */
  protected readonly redirect = computed(() => {
    const r = this.refusal().redirect;
    if (!r) return null;
    const paths: Record<string, string> = {
      request: '/requests',
      'budget-transfer': '/budgets',
      'budget-control': '/budgets',
      ledger: '/finance/actuals',
      budget: '/budgets',
      event: '/events',
      rule: '/admin/rules',
    };
    const base = paths[r.resourceType] ?? '/';
    const label =
      r.label === 'Open the screen' ? (OPEN_LABELS[r.resourceType] ?? r.label) : r.label;
    return { label, path: r.resourceId ? `${base}/${r.resourceId}` : base };
  });
}

const OPEN_LABELS: Record<string, string> = {
  request: 'Open requests to decide',
  'budget-transfer': 'Start a transfer yourself',
  'budget-control': 'Open the budget to apply a control',
  ledger: 'Open the ledger screens',
};

/**
 * A feature the Organization Admin turned off. The API answers `409 AI_FEATURE_DISABLED` rather than
 * empty data, so this is its own state: the surrounding product is unaffected and says so.
 */
@Component({
  selector: 'bf-ai-disabled',
  imports: [MatButtonModule, RouterLink, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <sat-empty-state data-testid="ai-disabled">
      <h2 satEmptyStateHeadline>{{ headline() }}</h2>
      <p satEmptyStateDescription>
        An Organization Admin can turn it on in AI settings. {{ stillWorks() }}
      </p>
      <a mat-stroked-button satEmptyStateAction routerLink="/admin/ai">Open AI settings</a>
    </sat-empty-state>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiDisabled {
  readonly feature = input('This AI feature');
  /** The API's own plain-English sentence; it is the headline, so it is never repeated below. */
  readonly detail = input('');
  protected readonly headline = computed(
    () => this.detail().trim() || `${this.feature()} is turned off for this company`,
  );
  /** What a person can still do without the feature; the task never waits for AI. */
  readonly stillWorks = input('Everything else on this screen works as usual.');
}

/** The model was unavailable or the output failed its schema: the task never waits for AI. */
@Component({
  selector: 'bf-ai-unavailable',
  imports: [MatButtonModule, SAT_BANNER_IMPORTS],
  template: `
    <div class="bf-ai-unavailable">
      <sat-banner variant="info" data-testid="ai-unavailable">
        <sat-banner-message>
          AI {{ noun() }} are unavailable right now. Everything else works as usual.
        </sat-banner-message>
      </sat-banner>
      <button mat-stroked-button type="button" (click)="retry.emit()">Try again</button>
    </div>
  `,
  styles: `
    .bf-ai-unavailable {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiUnavailable {
  readonly noun = input('suggestions');
  readonly retry = output<void>();
}

/** Helpful or not helpful on one AI output. Rating is logged in the query log, never in the audit log. */
@Component({
  selector: 'bf-ai-feedback',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="bf-ai-feedback">
      @if (rated()) {
        <span class="bf-cell__secondary" data-testid="feedback-done"
          >Thanks: recorded as {{ rated() === 'helpful' ? 'helpful' : 'not helpful' }}.</span
        >
      } @else {
        <button mat-button type="button" (click)="rate('helpful')" data-testid="feedback-helpful">
          <mat-icon svgIcon="thumbsup" />Helpful
        </button>
        <button
          mat-button
          type="button"
          (click)="rate('not_helpful')"
          data-testid="feedback-not-helpful"
        >
          <mat-icon svgIcon="thumbsdown" />Not helpful
        </button>
      }
    </div>
  `,
  styles: `
    .bf-ai-feedback {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiFeedback {
  readonly rated = input<'helpful' | 'not_helpful' | null>(null);
  readonly rating = output<'helpful' | 'not_helpful'>();
  protected rate(value: 'helpful' | 'not_helpful'): void {
    this.rating.emit(value);
  }
}

/** True when a failed call was the API refusing because the feature is switched off. */
export const isFeatureDisabled = (error: unknown): boolean =>
  errorStatus(error) === 409 && problemCode(error) === 'AI_FEATURE_DISABLED';

/** Words for an outcome, used in the query log and on every surface that shows one. */
export const OUTCOME_LABELS: Record<AiOutcome, string> = {
  answered: 'Answered',
  suggested: 'Suggested',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  rejected: 'Rejected',
  refused_out_of_scope: 'Refused \u2013 out of scope',
  refused_action: 'Refused \u2013 action',
  discarded_unreliable: 'Discarded \u2013 unreliable',
  disabled: 'Turned off',
  rate_limited: 'Rate limited',
  failed: 'Failed',
};

/** Tone for an outcome: a discarded answer is not a plain error and does not read like one. */
export const outcomeTone = (
  outcome: AiOutcome,
): 'success' | 'info' | 'warning' | 'important' | 'neutral' => {
  switch (outcome) {
    case 'answered':
    case 'accepted':
      return 'success';
    case 'suggested':
      return 'info';
    case 'discarded_unreliable':
    case 'rate_limited':
      return 'warning';
    case 'failed':
      return 'important';
    default:
      return 'neutral';
  }
};

/** Loading skeleton for an AI output, with the honest "nothing is decided yet" wording. */
@Component({
  selector: 'bf-ai-preparing',
  imports: [SatGhost],
  template: `
    <div class="bf-ai-preparing" aria-busy="true" [attr.aria-label]="label()">
      <p class="bf-cell__secondary">{{ label() }}</p>
      @for (row of rows; track $index) {
        <sat-ghost variant="box" [height]="18" fitContainer />
      }
    </div>
  `,
  styles: `
    .bf-ai-preparing {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPreparing {
  readonly label = input('Looking at your budgets\u2026');
  protected readonly rows = [0, 1, 2];
}

export const AI_OUTPUT_IMPORTS = [
  AiDisabled,
  AiFeedback,
  AiFigures,
  AiLabel,
  AiPreparing,
  AiProse,
  AiProvenanceNote,
  AiRefusalCard,
  AiSources,
  AiUnavailable,
  AiWhy,
] as const;
