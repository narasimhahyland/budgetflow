import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import type { ReclaimChoice, ReclaimNotice } from '@bf/contracts';
import { formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, toMinor, valueOf } from './api';
import { CloseTag } from './close-tag';
import { noticeTag, responseText } from './reclaim-format';

/**
 * Screen 086a, owner notice (phone first): the budget, what it has available, what is forecast to
 * lapse and the proposal, with three choices. Keeping the money needs a reason and a plan. The API
 * refuses an amount above the floor and the page shows its sentence next to the amount.
 */
@Component({
  selector: 'bf-reclaim-notice-page',
  imports: [
    CloseTag,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    @if (notice.isLoading() && !notice.hasValue()) {
      <bf-load-state [loading]="true" what="the notice" />
    } @else if (notice.error()) {
      <bf-load-state [error]="notice.error()" what="the notice" (retry)="notice.reload()" />
    } @else if (n(); as n) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">Release unused money from {{ n.budgetName }}</h1>
          <p class="bf-page__subtitle">
            {{ n.campaignName }} · respond by {{ n.respondBy | date: 'd MMM y' }}
          </p>
        </div>
      </header>

      <section class="bf-card bf-reclaim__notice" aria-labelledby="notice-facts">
        <h2 class="bf-card__title" id="notice-facts">Your budget</h2>
        <dl class="bf-rows bf-reclaim__facts">
          <div>
            <dt>Available under its rules</dt>
            <dd>
              <bf-money [amountMinor]="n.available.amountMinor" [currency]="n.available.currency" />
            </dd>
          </div>
          <div>
            <dt>Forecast unused at year end</dt>
            <dd>
              <bf-money
                [amountMinor]="n.forecastUnused.amountMinor"
                [currency]="n.forecastUnused.currency"
              />
            </dd>
          </div>
          @if (n.pendingRequests.amountMinor > 0) {
            <div>
              <dt>Pending requests (not part of the floor)</dt>
              <dd>
                <bf-money
                  [amountMinor]="n.pendingRequests.amountMinor"
                  [currency]="n.pendingRequests.currency"
                />
              </dd>
            </div>
          }
          <div class="bf-rows__total">
            <dt>Proposed release</dt>
            <dd>
              <bf-money [amountMinor]="n.proposed.amountMinor" [currency]="n.proposed.currency" />
            </dd>
          </div>
        </dl>
        <p class="bf-note">
          Why: {{ money(n.proposed) }} is forecast to lapse on {{ n.yearEnd | date: 'd MMM y' }}. At
          most {{ money(n.maxReclaimable) }} can be released today (floor: committed + actual +
          children, {{ money(n.floor) }}).
          @if (n.pendingRequests.amountMinor > 0) {
            Releasing more than is available leaves pending requests of
            {{ money(n.pendingRequests) }} short; those go back to their requesters.
          }
        </p>
      </section>

      @if (done()) {
        <sat-banner variant="success"
          ><sat-banner-message>{{ done() }}</sat-banner-message></sat-banner
        >
      }

      @if (n.canRespond) {
        <section class="bf-card bf-reclaim__notice" aria-labelledby="notice-choice">
          <h2 class="bf-card__title" id="notice-choice">Your answer</h2>
          @if (n.status === 'parent_review') {
            <p class="bf-note">
              {{ n.ownerName ?? 'The owner' }} did not answer by the deadline. As the owner of a
              budget above it, you decide.
            </p>
          }
          <mat-radio-group
            class="bf-radios"
            aria-label="Your answer"
            [value]="choice()"
            (change)="choice.set($event.value)"
          >
            <mat-radio-button value="release_all" data-testid="choice-release-all"
              >Release {{ money(n.proposed) }}</mat-radio-button
            >
            <mat-radio-button value="release_part" data-testid="choice-release-part"
              >Release a different amount</mat-radio-button
            >
            <mat-radio-button value="keep" data-testid="choice-keep">Keep it</mat-radio-button>
          </mat-radio-group>
          @if (choice() === 'release_part') {
            <mat-form-field class="bf-field">
              <mat-label>Amount to release ({{ n.proposed.currency }})</mat-label>
              <input
                matInput
                inputmode="decimal"
                [ngModel]="amount()"
                (ngModelChange)="amount.set($event)"
                data-testid="release-amount"
                aria-describedby="release-error"
              />
              <mat-hint>Up to {{ money(n.proposed) }}.</mat-hint>
            </mat-form-field>
          }
          @if (choice() === 'keep' || choice() === 'release_part') {
            <mat-form-field class="bf-field">
              <mat-label>{{
                choice() === 'keep' ? 'Why you are keeping it' : 'What you keep it for (optional)'
              }}</mat-label>
              <input
                matInput
                maxlength="500"
                [ngModel]="reason()"
                (ngModelChange)="reason.set($event)"
                [required]="choice() === 'keep'"
                data-testid="keep-reason"
              />
            </mat-form-field>
          }
          @if (choice() === 'keep') {
            <mat-form-field class="bf-field">
              <mat-label>Plan for the money</mat-label>
              <textarea
                matInput
                rows="2"
                maxlength="500"
                required
                [ngModel]="plan()"
                (ngModelChange)="plan.set($event)"
                data-testid="keep-plan"
              ></textarea>
              <mat-hint>For example a committed event or a selected quote.</mat-hint>
            </mat-form-field>
          }
          @if (failure()) {
            <p class="bf-reclaim__error" id="release-error" role="alert">{{ failure() }}</p>
          }
          <div class="bf-reclaim__actions">
            <button
              mat-flat-button
              satImportantButton
              type="button"
              [disabled]="busy() || !ready()"
              (click)="submit(n)"
              data-testid="submit-reclaim"
            >
              Submit
            </button>
          </div>
        </section>
      } @else {
        <section class="bf-card bf-reclaim__notice" aria-labelledby="notice-answer">
          <h2 class="bf-card__title" id="notice-answer">Answer</h2>
          <p><bf-close-tag [tag]="tagOf(n)" /></p>
          @if (n.released.amountMinor > 0) {
            <p class="bf-reclaim__remainder">
              Released <strong>{{ money(n.released) }}</strong>
            </p>
          }
          <p class="bf-note">
            {{ responseOf(n) }}
            @if (n.respondedByName && n.respondedAt) {
              · answered by {{ n.respondedByName }} on {{ n.respondedAt | date: 'd MMM y' }}
            }
          </p>
        </section>
      }
    }
  `,
  styleUrls: ['./close.scss', './dialogs.scss', './reclaim.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReclaimNoticePage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly noticeId = computed(() => this.params().get('noticeId') ?? '');
  protected readonly notice = resource({
    params: () => this.noticeId(),
    loader: ({ params }) => data(this.api.getReclaimNotice({ params: { noticeId: params } })),
  });
  protected readonly n = computed(() => valueOf(this.notice));
  protected readonly choice = signal<ReclaimChoice>('release_all');
  protected readonly amount = signal('');
  protected readonly reason = signal('');
  protected readonly plan = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly money = (m: { amountMinor: number; currency: string }) =>
    formatMoney(m.amountMinor, m.currency);

  protected readonly ready = computed(() => {
    const c = this.choice();
    if (c === 'keep') return this.reason().trim() !== '' && this.plan().trim() !== '';
    if (c === 'release_part')
      return toMinor(this.amount(), this.n()?.proposed.currency ?? 'USD') !== undefined;
    return true;
  });

  protected tagOf(n: ReclaimNotice) {
    return noticeTag(n);
  }

  protected responseOf(n: ReclaimNotice) {
    return responseText(n);
  }

  protected async submit(n: ReclaimNotice): Promise<void> {
    const c = this.choice();
    this.busy.set(true);
    this.failure.set(null);
    try {
      const saved = await data(
        this.api.respondReclaimNotice({
          params: { noticeId: n.id },
          body: {
            choice: c,
            ...(c === 'release_part'
              ? { amountMinor: toMinor(this.amount(), n.proposed.currency) }
              : {}),
            ...(this.reason().trim() && c !== 'release_all'
              ? { reason: this.reason().trim() }
              : {}),
            ...(c === 'keep' ? { plan: this.plan().trim() } : {}),
          },
        }),
      );
      this.done.set(
        saved.status === 'kept'
          ? `Thanks. ${n.budgetName} keeps its money; finance sees your reason and plan.`
          : `Thanks. You released ${this.money(saved.released)} from ${n.budgetName}. It moves when finance redistributes the pool.`,
      );
      this.snack.open('Answer sent', 'Close', { duration: 4000 });
      this.notice.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
