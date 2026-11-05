import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import type { PerHeadResult } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, toMajor, toMinor, valueOf } from './api';
import { LoadState } from './load-state';

type EmploymentType = 'employee' | 'contractor' | 'intern';
const TYPES: { key: EmploymentType; label: string }[] = [
  { key: 'employee', label: 'Employees' },
  { key: 'intern', label: 'Interns' },
  { key: 'contractor', label: 'Contractors' },
];

/** Screen 22a: per-head driver allocation from the HR headcount import, with true-ups. */
@Component({
  selector: 'bf-per-head-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-ph {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .bf-ph {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 16px;
    }
    .bf-chip {
      padding: 6px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      font: var(--mat-sys-label-large);
    }
    .bf-chip--on {
      border-color: var(--sat-sys-on-success-container);
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
    }
    .bf-chip--off {
      border-color: var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .bf-breakdown {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    .bf-breakdown th,
    .bf-breakdown td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: end;
    }
    .bf-breakdown th:first-child,
    .bf-breakdown td:first-child {
      text-align: start;
    }
    .bf-breakdown th {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .bf-box {
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-box--target {
      border-color: var(--mat-sys-primary);
    }
    .bf-box p {
      margin: 0;
    }
    .bf-big {
      font: var(--mat-sys-headline-small);
      font-variant-numeric: tabular-nums;
    }
    .bf-delta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 12px;
      padding: 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
      font: var(--mat-sys-title-small);
    }
    .bf-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .bf-field {
      width: 100%;
    }
  `,
  template: `
    <bf-load-state
      [loading]="childRes.isLoading() && !child()"
      [error]="childRes.error()"
      what="the budget"
      (retry)="childRes.reload()"
    />
    @if (child(); as c) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">Per-head allocation · {{ c.name }}</h1>
          <p class="bf-page__subtitle">
            Headcount-driven allocation from {{ c.display.parentName }} with true-ups when HR
            refreshes the headcount
          </p>
        </div>
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/org/headcount">View headcount import</a>
          <a mat-stroked-button [routerLink]="['/budgets', c.id]">Back to budget</a>
        </div>
      </header>
      @if (pendingTrueUp(); as t) {
        <sat-banner variant="warning" data-testid="pending-true-up"
          ><sat-banner-message
            >A newer HR snapshot ({{ t.preview.asOfDate }}) changes this amount by
            <bf-money [amountMinor]="t.preview.deltaMinor" [currency]="c.currency" />. Review the
            true-up below.</sat-banner-message
          ></sat-banner
        >
      }
      <div class="bf-ph">
        <div style="display: flex; flex-direction: column; gap: 16px">
          <section class="bf-card" aria-labelledby="rules">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="rules">Headcount driver rules</h2>
            </div>
            <div class="bf-card__body">
              <div class="bf-form" style="padding: 0">
                <mat-form-field
                  ><mat-label>Rate per eligible employee per month (USD)</mat-label
                  ><input
                    matInput
                    inputmode="decimal"
                    [ngModel]="rate()"
                    (ngModelChange)="rate.set($event)"
                    data-testid="rate"
                /></mat-form-field>
                <mat-form-field
                  ><mat-label>HR snapshot on or before</mat-label
                  ><input
                    matInput
                    type="date"
                    [ngModel]="asOf()"
                    (ngModelChange)="asOf.set($event)"
                /></mat-form-field>
              </div>
              <p class="bf-card__hint">Eligibility (select to include)</p>
              <div class="bf-chips" role="group" aria-label="Eligible employment types">
                @for (t of types; track t.key) {
                  <button
                    type="button"
                    class="bf-chip"
                    [class.bf-chip--on]="eligible().includes(t.key)"
                    [class.bf-chip--off]="!eligible().includes(t.key)"
                    [attr.aria-pressed]="eligible().includes(t.key)"
                    (click)="toggle(t.key)"
                    [attr.data-testid]="'eligible-' + t.key"
                  >
                    {{ eligible().includes(t.key) ? '✓' : '✕' }} {{ t.label }}
                  </button>
                }
              </div>
              <mat-slide-toggle [ngModel]="prorate()" (ngModelChange)="prorate.set($event)"
                >Prorate joiners and leavers</mat-slide-toggle
              >
            </div>
          </section>
          <section class="bf-card" aria-labelledby="breakdown">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="breakdown">Headcount calculation breakdown</h2>
                @if (preview(); as p) {
                  <p class="bf-card__hint">
                    {{ p.preview.orgUnitName }} · HR snapshot {{ p.preview.asOfDate }}
                  </p>
                }
              </div>
            </div>
            @if (preview(); as p) {
              <table class="bf-breakdown" data-testid="breakdown">
                <thead>
                  <tr>
                    <th scope="col">Employment type</th>
                    <th scope="col">Headcount</th>
                    <th scope="col">{{ prorate() ? 'Prorated' : 'Counted' }}</th>
                    <th scope="col">Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of p.preview.byType; track t.employmentType) {
                    <tr>
                      <td>{{ t.employmentType }}</td>
                      <td>{{ t.headcount }}</td>
                      <td>{{ t.headcountMilli / 1000 }}</td>
                      <td>{{ t.eligible ? 'Yes' : 'Excluded' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="bf-card__hint" style="padding: 12px 20px">
                Formula: {{ p.preview.eligibleHeadcountMilli / 1000 }} eligible ×
                <bf-money [amountMinor]="p.preview.rateMinor" [currency]="p.preview.currency" /> =
                <strong
                  ><bf-money [amountMinor]="p.preview.amountMinor" [currency]="p.preview.currency"
                /></strong>
                ({{ p.preview.excludedHeadcount }} excluded)
              </p>
            } @else if (problem()) {
              <div class="bf-card__body">
                <sat-banner variant="important"
                  ><sat-banner-message>{{ problem() }}</sat-banner-message></sat-banner
                >
              </div>
            }
          </section>
        </div>
        <aside class="bf-card" aria-label="Allocation comparison">
          <div class="bf-card__header"><h2 class="bf-card__title">Allocation comparison</h2></div>
          <div class="bf-card__body">
            @if (preview(); as p) {
              <div class="bf-compare">
                <div class="bf-box">
                  <p class="bf-card__hint">Current driver amount</p>
                  <p class="bf-big">
                    <bf-money
                      [amountMinor]="p.preview.currentDriverAmountMinor"
                      [currency]="p.preview.currency"
                    />
                  </p>
                </div>
                <div class="bf-box bf-box--target">
                  <p class="bf-card__hint">Target calculated</p>
                  <p class="bf-big" data-testid="target-amount">
                    <bf-money
                      [amountMinor]="p.preview.amountMinor"
                      [currency]="p.preview.currency"
                    />
                  </p>
                </div>
              </div>
              <div class="bf-delta">
                <span>{{
                  p.preview.deltaMinor >= 0 ? 'Allocate from parent' : 'Return to parent'
                }}</span
                ><span data-testid="delta"
                  >{{ p.preview.deltaMinor > 0 ? '+' : ''
                  }}<bf-money [amountMinor]="p.preview.deltaMinor" [currency]="p.preview.currency"
                /></span>
              </div>
              @if (!p.preview.fits) {
                <sat-banner variant="important" style="margin-top: 12px"
                  ><sat-banner-message
                    >{{ c.display.parentName }} has only
                    <bf-money
                      [amountMinor]="p.preview.parentAvailableMinor"
                      [currency]="p.preview.currency"
                    />
                    available; the allocation would be blocked.</sat-banner-message
                  ></sat-banner
                >
              }
            }
            @if (failure()) {
              <sat-banner variant="important" style="margin-top: 12px"
                ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
              >
            }
            @if (done()) {
              <sat-banner variant="success" style="margin-top: 12px" data-testid="per-head-done"
                ><sat-banner-message>{{ done() }}</sat-banner-message></sat-banner
              >
            }
            <div class="bf-actions">
              <button mat-stroked-button type="button" (click)="recalc()" [disabled]="busy()">
                Recalculate preview
              </button>
              <button
                mat-flat-button
                type="button"
                (click)="apply()"
                [disabled]="
                  busy() ||
                  !preview() ||
                  preview()!.preview.deltaMinor === 0 ||
                  !preview()!.preview.fits
                "
                data-testid="apply-per-head"
              >
                {{ c.allocationDriver === 'per_head' ? 'Apply true-up' : 'Allocate per head' }}
              </button>
            </div>
          </div>
        </aside>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerHeadPage {
  private readonly api = injectApi();
  readonly budgetId = input.required<string>();
  protected readonly types = TYPES;
  protected readonly childRes = resource({
    params: () => ({ id: this.budgetId() }),
    loader: ({ params }) => data(this.api.getBudget({ params: { budgetId: params.id } })),
  });
  protected readonly child = computed(() => valueOf(this.childRes));
  private readonly templatesRes = resource({
    loader: async () => (await data(this.api.listProgramTemplates({}))).items,
  });
  protected readonly rate = signal('');
  protected readonly eligible = signal<EmploymentType[]>(['employee', 'intern']);
  protected readonly prorate = signal(true);
  protected readonly asOf = signal(new Date().toISOString().slice(0, 10));
  protected readonly preview = signal<PerHeadResult | null>(null);
  protected readonly pendingTrueUp = signal<PerHeadResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  private initialised = false;

  constructor() {
    effect(() => {
      const c = this.child();
      const templates = valueOf(this.templatesRes);
      if (!c || !templates || this.initialised) return;
      this.initialised = true;
      const tpl = templates.find((t) => t.code === 'PER-HEAD-ENGAGEMENT');
      const d = c.driver;
      this.rate.set(toMajor(d?.rateMinor ?? tpl?.defaults.rateMinor ?? 1_500));
      this.eligible.set([
        ...(d?.eligibleTypes ?? tpl?.defaults.eligibleTypes ?? ['employee', 'intern']),
      ]);
      this.prorate.set(d?.prorate ?? tpl?.defaults.prorate ?? true);
      if (d && c.parentId) void this.checkPending(c.id);
      void this.recalc();
    });
  }

  private async checkPending(id: string): Promise<void> {
    try {
      const r = await data(
        this.api.perHeadTrueUp({ params: { budgetId: id }, body: { dryRun: true } }),
      );
      this.pendingTrueUp.set(r.preview.deltaMinor !== 0 ? r : null);
    } catch {
      this.pendingTrueUp.set(null);
    }
  }

  protected toggle(t: EmploymentType): void {
    this.eligible.update((e) => (e.includes(t) ? e.filter((x) => x !== t) : [...e, t]));
    void this.recalc();
  }

  private body(dryRun: boolean) {
    const c = this.child()!;
    return {
      childBudgetId: c.id,
      rateMinor: toMinor(this.rate()) ?? 0,
      eligibleTypes: this.eligible(),
      prorate: this.prorate(),
      asOf: this.asOf(),
      dryRun,
    };
  }

  protected async recalc(): Promise<void> {
    const c = this.child();
    if (!c?.parentId) return;
    this.problem.set(null);
    try {
      this.preview.set(
        await data(
          this.api.allocatePerHead({ params: { budgetId: c.parentId }, body: this.body(true) }),
        ),
      );
    } catch (e) {
      this.preview.set(null);
      this.problem.set(errorMessage(e));
    }
  }

  protected async apply(): Promise<void> {
    const c = this.child();
    if (!c?.parentId) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.allocatePerHead({ params: { budgetId: c.parentId }, body: this.body(false) }),
      );
      this.done.set(
        `Posted ${r.preview.deltaMinor > 0 ? 'an allocation' : 'a return to the parent'}; ${c.name} now follows the per-head driver.`,
      );
      this.pendingTrueUp.set(null);
      this.childRes.reload();
      await this.recalc();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
