import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PolicyExplanation } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi } from './api';

const OUTCOMES: Record<
  PolicyExplanation['outcome'],
  {
    label: string;
    tone: 'success' | 'warning' | 'important' | 'neutral';
    banner: 'success' | 'warning' | 'important' | 'info';
  }
> = {
  allowed: { label: 'Allowed', tone: 'success', banner: 'success' },
  needs_approval: { label: 'Needs approval', tone: 'warning', banner: 'warning' },
  blocked: { label: 'Blocked', tone: 'important', banner: 'important' },
  not_covered: { label: 'No policy covers this', tone: 'neutral', banner: 'info' },
};

/**
 * Screen 069a: the policy assistant. The rules engine decides and its outcome is shown first,
 * unchanged; the model only restates that outcome in plain English. When AI is off or unavailable
 * the same outcome, facts and compliant options still appear — nobody loses the reason for a block.
 */
@Component({
  selector: 'bf-policy-assistant-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Policy assistant</h1>
          <bf-ai-label text="AI explanations" />
        </div>
        <p class="bf-page__subtitle">
          Why something was blocked or needs extra approval, and what you can do within policy. The
          rules engine decides; the assistant explains its decision.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/requests">My requests</a>
      </div>
    </header>

    <section class="bf-card" aria-labelledby="policy-ask-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="policy-ask-title">Ask about a policy or a request</h2>
      </div>
      <div class="bf-form">
        <mat-form-field appearance="outline" class="bf-form__wide" subscriptSizing="dynamic">
          <mat-label>Is this allowed?</mat-label>
          <input
            matInput
            maxlength="500"
            [(ngModel)]="question"
            placeholder="for example Can I buy gifts for my team's work anniversaries?"
            data-testid="policy-question"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Request id (optional)</mat-label>
          <input matInput [(ngModel)]="requestId" data-testid="policy-request-id" />
          <mat-hint>To explain why a request was blocked</mat-hint>
        </mat-form-field>
      </div>
      <div class="bf-form__actions">
        <button
          mat-flat-button
          type="button"
          [disabled]="asking() || (!question().trim() && !requestId().trim())"
          (click)="explain()"
          data-testid="policy-explain"
        >
          Check
        </button>
      </div>
    </section>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Policy assistant explanations"
        [detail]="detail"
        stillWorks="The rules engine still shows which rules matched and why, on the request itself."
      />
    }
    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="policy-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }
    @if (asking()) {
      <section class="bf-card">
        <div class="bf-card__body"><bf-ai-preparing label="Checking the rules…" /></div>
      </section>
    }

    @if (explanation(); as e) {
      <section class="bf-card" aria-labelledby="policy-result-title" data-testid="policy-result">
        <div class="bf-card__header">
          <div class="bf-title-row">
            <h2 class="bf-card__title" id="policy-result-title">The rules engine's outcome</h2>
            <sat-status-tag [status]="outcome(e).tone" [attr.data-testid]="'outcome-' + e.outcome">
              {{ outcome(e).label }}
            </sat-status-tag>
          </div>
        </div>
        <div class="bf-card__body bf-policy">
          <sat-banner [variant]="outcome(e).banner" data-testid="policy-headline">
            <sat-banner-message>{{ e.headline }}</sat-banner-message>
          </sat-banner>

          @if (e.refusal; as refusal) {
            <bf-ai-refusal [refusal]="refusal" />
          } @else if (addsSomething(e)) {
            <div class="bf-policy__ai">
              <bf-ai-label text="AI explanation" />
              <bf-ai-prose
                [text]="e.explanation!"
                note="Written by the model. The outcome above is the rules engine's own, unchanged."
              />
            </div>
          } @else if (e.explanation) {
            <p class="bf-cell__secondary" data-testid="policy-no-extra">
              The rules engine's own wording above says it plainly, so there is nothing for the
              assistant to add.
            </p>
          } @else {
            <bf-ai-unavailable noun="explanations" (retry)="explain()" />
          }

          @if (e.facts.length) {
            <div>
              <h3 class="bf-section__title">Facts the rules engine used</h3>
              <dl class="bf-facts" data-testid="policy-facts">
                @for (f of e.facts; track f.label) {
                  <div>
                    <dt>{{ f.label }}</dt>
                    <dd>{{ f.value }}</dd>
                  </div>
                }
              </dl>
            </div>
          }

          @if (e.options.length) {
            <div>
              <h3 class="bf-section__title">What you can do</h3>
              <p class="bf-cell__secondary">
                Only options that comply, or the exception path. Each one opens the normal form,
                which runs the rules again before anything is submitted.
              </p>
              <div class="bf-policy__options" data-testid="policy-options">
                @for (o of e.options; track o.label) {
                  @if (optionLink(o.resourceType, o.resourceId); as href) {
                    <a mat-stroked-button [routerLink]="href" data-testid="policy-option">{{
                      o.label
                    }}</a>
                  } @else {
                    <span class="bf-chip" data-testid="policy-option">{{ o.label }}</span>
                  }
                }
              </div>
            </div>
          }

          <bf-ai-why [why]="[]" [confidence]="e.confidence" />
          <bf-ai-sources [sources]="e.sources" />
          <bf-ai-provenance [provenance]="e.provenance" />
        </div>
      </section>
    } @else if (!asking() && !disabled() && !failure()) {
      <sat-empty-state data-testid="policy-empty">
        <mat-icon satEmptyStateIllustration svgIcon="ai" aria-hidden="true" />
        <h2 satEmptyStateHeadline>Nothing checked yet</h2>
        <p satEmptyStateDescription>
          Ask whether something is allowed, or give a request id to see why it was blocked or needs
          extra approval.
        </p>
      </sat-empty-state>
    }
  `,
  styles: `
    .bf-policy {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bf-policy__ai {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .bf-policy__options {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PolicyAssistantPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly query = this.route.snapshot.queryParamMap;

  protected readonly question = signal(this.query.get('q') ?? '');
  protected readonly requestId = signal(this.query.get('requestId') ?? '');
  protected readonly asking = signal(false);
  protected readonly explanation = signal<PolicyExplanation | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly disabled = signal<string | null>(null);

  protected outcome(e: PolicyExplanation) {
    return OUTCOMES[e.outcome];
  }

  /** The rules engine's own words are never repeated back under an AI label. */
  protected addsSomething(e: PolicyExplanation): boolean {
    const plain = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    return Boolean(e.explanation) && plain(e.explanation!) !== plain(e.headline);
  }

  protected optionLink(resourceType: string | null, resourceId: string | null): string | null {
    if (!resourceType) return null;
    const paths: Record<string, string> = {
      request: '/requests',
      budget: '/budgets',
      event: '/events',
      rule: '/admin/rules',
      policy: '/admin/rules',
    };
    const base = paths[resourceType];
    return base ? (resourceId ? `${base}/${resourceId}` : base) : null;
  }

  protected async explain(): Promise<void> {
    const question = this.question().trim();
    const requestId = this.requestId().trim();
    if (!question && !requestId) return;
    this.asking.set(true);
    this.failure.set(null);
    this.disabled.set(null);
    this.explanation.set(null);
    try {
      this.explanation.set(
        await data(
          this.api.explainPolicy({
            body: {
              channel: 'web',
              ...(question ? { question } : {}),
              ...(requestId ? { requestId } : {}),
            },
          }),
        ),
      );
    } catch (error) {
      if (isFeatureDisabled(error)) this.disabled.set(errorMessage(error));
      else this.failure.set(errorMessage(error));
    } finally {
      this.asking.set(false);
    }
  }
}
