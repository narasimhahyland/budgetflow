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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CreateBudgetRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { BUDGET_TYPE_LABEL, data, errorMessage, injectApi, toMinor, valueOf } from './api';

/** Screen 20: create a child budget (or a root funded by a plan version) with its controls. */
@Component({
  selector: 'bf-create-budget-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-create {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .bf-create {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-side {
      position: sticky;
      top: 16px;
    }
    .bf-rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
    .bf-rows div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .bf-rows dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-rows dd {
      margin: 0;
    }
    .bf-after {
      font: var(--mat-sys-title-medium);
    }
    .bf-bad {
      color: var(--mat-sys-error);
    }
    .bf-lock {
      margin: 0 20px 12px;
      padding: 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      font: var(--mat-sys-body-small);
    }
    .bf-side-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
    }
  `,
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Create budget</h1>
        <p class="bf-page__subtitle">
          Define the budget, its owner, cost center and controls. All budgets are held in USD.
        </p>
      </div>
      <div class="bf-page__actions"><a mat-button routerLink="/budgets">Cancel</a></div>
    </header>
    <div class="bf-create">
      <div style="display: flex; flex-direction: column; gap: 16px">
        <section class="bf-card" aria-labelledby="basics">
          <div class="bf-card__header"><h2 class="bf-card__title" id="basics">Basics</h2></div>
          <div class="bf-form">
            <mat-form-field class="bf-form__wide"
              ><mat-label>Budget name</mat-label
              ><input matInput [(ngModel)]="name" required data-testid="name"
            /></mat-form-field>
            <mat-form-field class="bf-form__wide"
              ><mat-label>Parent budget</mat-label>
              <mat-select
                [ngModel]="parentId()"
                (ngModelChange)="parentId.set($event)"
                data-testid="parent"
              >
                @if (canRoot()) {
                  <mat-option value=""
                    >No parent: a root budget funded by a plan version</mat-option
                  >
                }
                @for (p of parents(); track p.id) {
                  <mat-option [value]="p.id"
                    >{{ p.name }} (<bf-money
                      [amountMinor]="p.balances.allocationAvailable.amountMinor"
                      [currency]="p.currency"
                    />
                    unallocated)</mat-option
                  >
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field
              ><mat-label>Program template</mat-label>
              <mat-select [ngModel]="templateId()" (ngModelChange)="applyTemplate($event)">
                <mat-option value="">None</mat-option>
                @for (t of templates(); track t.id) {
                  <mat-option [value]="t.id">{{ t.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field
              ><mat-label>Category</mat-label>
              <mat-select [(ngModel)]="categoryCode">
                <mat-option value="">None</mat-option>
                @for (c of categories(); track c.code) {
                  <mat-option [value]="c.code">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field
              ><mat-label>Budget type</mat-label>
              <mat-select [(ngModel)]="budgetType">
                @for (t of types; track t[0]) {
                  <mat-option [value]="t[0]">{{ t[1] }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field
              ><mat-label>Code (optional)</mat-label><input matInput [(ngModel)]="code"
            /></mat-form-field>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="owner">
          <div class="bf-card__header"><h2 class="bf-card__title" id="owner">Ownership</h2></div>
          <div class="bf-form">
            <mat-form-field class="bf-form__wide"
              ><mat-label>Budget owner</mat-label>
              <mat-select [(ngModel)]="ownerId" data-testid="owner">
                <mat-option value="">Me</mat-option>
                @for (p of people(); track p.id) {
                  <mat-option [value]="p.id"
                    >{{ p.displayName }} · {{ p.jobTitle ?? '' }}</mat-option
                  >
                }
              </mat-select>
              <mat-hint
                >Owners see and delegate their budget; approval limits come from delegation of
                authority.</mat-hint
              >
            </mat-form-field>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="acct">
          <div class="bf-card__header"><h2 class="bf-card__title" id="acct">Accounting</h2></div>
          <div class="bf-form">
            <mat-form-field
              ><mat-label>Legal entity</mat-label>
              <mat-select
                [ngModel]="legalEntityId()"
                (ngModelChange)="legalEntityId.set($event)"
                required
              >
                @for (e of entities(); track e.id) {
                  <mat-option [value]="e.id">{{ e.name }} ({{ e.code }})</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field
              ><mat-label>Cost center</mat-label>
              <mat-select [(ngModel)]="costCenterId">
                <mat-option value="">None yet</mat-option>
                @for (c of costCenters(); track c.id) {
                  <mat-option [value]="c.id">{{ c.code }} · {{ c.name }}</mat-option>
                }
              </mat-select>
              <mat-hint>Required on budgets that take spend.</mat-hint>
            </mat-form-field>
            @if (!parentId()) {
              <mat-form-field
                ><mat-label>Plan version</mat-label>
                <mat-select [(ngModel)]="planVersionId" required>
                  @for (v of planVersions(); track v.id) {
                    <mat-option [value]="v.id">{{ v.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
          </div>
          <p class="bf-lock">
            Budget currency: USD (fixed). Local-currency spend converts to USD at the plan rate
            locked for the fiscal year.
          </p>
          <div class="bf-form">
            <mat-form-field
              ><mat-label>{{
                parentId() ? 'Initial allocation (USD)' : 'Original amount (USD)'
              }}</mat-label>
              <input
                matInput
                inputmode="decimal"
                [ngModel]="amount()"
                (ngModelChange)="amount.set($event)"
                data-testid="amount"
              />
              @if (parent(); as p) {
                <mat-hint
                  >Up to
                  <bf-money
                    [amountMinor]="p.balances.allocationAvailable.amountMinor"
                    [currency]="p.currency"
                /></mat-hint>
              }
            </mat-form-field>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="controls">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="controls">Controls and governance</h2>
          </div>
          <div class="bf-card__body">
            <mat-button-toggle-group
              [value]="mode()"
              (change)="mode.set($event.value)"
              aria-label="Control mode"
            >
              <mat-button-toggle value="hard">Hard</mat-button-toggle>
              <mat-button-toggle value="soft">Soft</mat-button-toggle>
              <mat-button-toggle value="track">Track</mat-button-toggle>
            </mat-button-toggle-group>
            <p class="bf-card__hint">
              {{
                mode() === 'hard'
                  ? 'Hard block: requests beyond available are rejected.'
                  : mode() === 'soft'
                    ? 'Soft: requests beyond available warn and can proceed.'
                    : 'Track: nothing is blocked.'
              }}
            </p>
            <div class="bf-form" style="padding: 8px 0 0">
              <mat-form-field
                ><mat-label>Overrun tolerance (%)</mat-label
                ><input
                  matInput
                  type="number"
                  min="0"
                  max="100"
                  [ngModel]="tolerance()"
                  (ngModelChange)="tolerance.set(+$event)"
              /></mat-form-field>
            </div>
            <p class="bf-card__hint">Alert notification thresholds</p>
            <mat-button-toggle-group
              multiple
              [value]="thresholds()"
              (change)="thresholds.set($event.value)"
              aria-label="Alert thresholds"
            >
              @for (t of [50, 80, 90, 100]; track t) {
                <mat-button-toggle [value]="t">{{ t }}%</mat-button-toggle>
              }
            </mat-button-toggle-group>
          </div>
        </section>
      </div>
      <aside class="bf-card bf-side" aria-label="Parent budget impact preview">
        <div class="bf-card__header">
          <h2 class="bf-card__title">Parent budget impact preview</h2>
        </div>
        <div class="bf-card__body">
          @if (parent(); as p) {
            <dl class="bf-rows">
              <div>
                <dt>Parent</dt>
                <dd>{{ p.name }}</dd>
              </div>
              <div>
                <dt>Available before</dt>
                <dd>
                  <bf-money
                    [amountMinor]="p.balances.allocationAvailable.amountMinor"
                    [currency]="p.currency"
                  />
                </dd>
              </div>
              <div>
                <dt>Deducted amount</dt>
                <dd class="bf-bad">
                  − <bf-money [amountMinor]="amountMinor() ?? 0" [currency]="p.currency" />
                </dd>
              </div>
              <div>
                <dt>Available after</dt>
                <dd class="bf-after" [class.bf-bad]="over()">
                  <bf-money
                    [amountMinor]="
                      p.balances.allocationAvailable.amountMinor - (amountMinor() ?? 0)
                    "
                    [currency]="p.currency"
                  />
                </dd>
              </div>
            </dl>
            @if (over()) {
              <sat-banner variant="important" style="margin-top: 12px"
                ><sat-banner-message
                  >The parent does not have that much unallocated. Lower the amount or ask for an
                  increase.</sat-banner-message
                ></sat-banner
              >
            }
          } @else {
            <p class="bf-card__hint">
              A root budget is funded by the approved plan version and recorded as a line of it, so
              roots always tie out.
            </p>
          }
          @if (failure()) {
            <sat-banner variant="important" style="margin-top: 12px"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          }
          <div class="bf-side-actions">
            <button
              mat-flat-button
              type="button"
              [disabled]="busy() || !valid()"
              (click)="create(false)"
              data-testid="create"
            >
              Create budget
            </button>
            @if (parentId()) {
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy() || !name.trim()"
                (click)="create(true)"
              >
                Save draft
              </button>
            }
          </div>
        </div>
      </aside>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateBudgetPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly types = Object.entries(BUDGET_TYPE_LABEL);
  protected readonly canRoot = computed(() => this.session.can('budget.create_root'));
  protected name = '';
  protected code = '';
  protected categoryCode = '';
  protected budgetType: CreateBudgetRequest['budgetType'] = 'operating';
  protected ownerId = '';
  protected costCenterId = '';
  protected planVersionId = '';
  protected readonly parentId = signal<string>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('parent') ?? '',
  );
  protected readonly templateId = signal('');
  protected readonly legalEntityId = signal('');
  protected readonly amount = signal('');
  protected readonly mode = signal<'hard' | 'soft' | 'track'>('hard');
  protected readonly tolerance = signal(0);
  protected readonly thresholds = signal<number[]>([50, 80, 100]);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly budgetsRes = resource({
    loader: async () => (await data(this.api.listBudgets({ query: { limit: 500 } }))).items,
  });
  protected readonly parents = computed(() =>
    (valueOf(this.budgetsRes) ?? []).filter(
      (b) =>
        b.allowedActions.includes('budget.create_child') &&
        ['active', 'reduced', 'partially_allocated', 'fully_allocated'].includes(b.status),
    ),
  );
  protected readonly parent = computed(() => this.parents().find((p) => p.id === this.parentId()));
  private readonly templatesRes = resource({
    loader: async () => (await data(this.api.listProgramTemplates({}))).items,
  });
  protected readonly templates = computed(() => valueOf(this.templatesRes) ?? []);
  private readonly cats = resource({
    loader: async () => (await data(this.api.listCategories({}))).items,
  });
  protected readonly categories = computed(() => valueOf(this.cats) ?? []);
  private readonly peopleRes = resource({
    loader: async () => (await data(this.api.listPeople({ query: { limit: 200 } }))).items,
  });
  protected readonly people = computed(() => valueOf(this.peopleRes) ?? []);
  private readonly entitiesRes = resource({
    loader: async () => (await data(this.api.listLegalEntities({}))).items,
  });
  protected readonly entities = computed(() => valueOf(this.entitiesRes) ?? []);
  private readonly ccRes = resource({
    loader: async () => (await data(this.api.listCostCenters({}))).items,
  });
  protected readonly costCenters = computed(() => valueOf(this.ccRes) ?? []);
  private readonly pvRes = resource({
    params: () => (this.parentId() ? undefined : {}),
    loader: async () => (await data(this.api.listPlanVersions({}))).items,
  });
  protected readonly planVersions = computed(() =>
    (valueOf(this.pvRes) ?? []).filter((v) => v.status === 'approved' && v.kind !== 'forecast'),
  );
  protected readonly amountMinor = computed(() => toMinor(this.amount()));
  protected readonly over = computed(() => {
    const p = this.parent();
    return !!p && (this.amountMinor() ?? 0) > p.balances.allocationAvailable.amountMinor;
  });

  constructor() {
    effect(() => {
      const p = this.parent();
      if (p) this.legalEntityId.set(p.legalEntityId);
      else if (!this.legalEntityId() && this.entities().length)
        this.legalEntityId.set(this.entities()[0].id);
    });
  }

  protected applyTemplate(id: string): void {
    this.templateId.set(id);
    const t = this.templates().find((x) => x.id === id);
    if (!t) return;
    if (t.defaults.categoryCode) this.categoryCode = t.defaults.categoryCode;
    if (t.defaults.budgetType) this.budgetType = t.defaults.budgetType;
    if (t.defaults.alertThresholdsPct) this.thresholds.set([...t.defaults.alertThresholdsPct]);
    if (t.defaults.control) {
      this.mode.set(t.defaults.control.mode);
      this.tolerance.set(t.defaults.control.toleranceBps / 100);
    }
  }

  protected valid(): boolean {
    if (this.name.trim().length < 2 || !this.legalEntityId() || this.over()) return false;
    if (!this.parentId()) return !!this.planVersionId && (this.amountMinor() ?? 0) > 0;
    return true;
  }

  protected async create(draft: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    const fy =
      this.parent()?.fiscalYearId ??
      this.planVersions().find((v) => v.id === this.planVersionId)?.fiscalYearId;
    if (!fy) {
      this.failure.set('Choose a parent budget or a plan version.');
      this.busy.set(false);
      return;
    }
    try {
      const created = await data(
        this.api.createBudget({
          body: {
            name: this.name.trim(),
            ...(this.code.trim() ? { code: this.code.trim() } : {}),
            parentId: this.parentId() || null,
            legalEntityId: this.legalEntityId(),
            costCenterId: this.costCenterId || null,
            ...(this.ownerId ? { ownerPersonId: this.ownerId } : {}),
            ...(this.categoryCode ? { categoryCode: this.categoryCode } : {}),
            budgetType: this.budgetType,
            ...(this.templateId() ? { programTemplateId: this.templateId() } : {}),
            fiscalYearId: fy,
            control: {
              basis: ['allocated_out', 'held', 'pre_encumbered', 'encumbered', 'actual'],
              mode: this.mode(),
              toleranceBps: Math.round(this.tolerance() * 100),
            },
            alertThresholdsPct: [...this.thresholds()].sort((a, b) => a - b),
            ...(this.parentId()
              ? { draft }
              : {
                  planVersionId: this.planVersionId,
                  originalAmount: { amountMinor: this.amountMinor()!, currency: 'USD' },
                }),
          },
        }),
      );
      const amount = this.amountMinor();
      if (this.parentId() && !draft && amount && amount > 0) {
        try {
          await data(
            this.api.allocate({
              params: { budgetId: this.parentId() },
              body: {
                childBudgetId: created.id,
                amount: { amountMinor: amount, currency: 'USD' },
                memo: 'Initial allocation',
              },
            }),
          );
        } catch (e) {
          await this.router.navigate(['/budgets', created.id], {
            queryParams: { tab: 'overview' },
          });
          this.failure.set(`The budget was created but the allocation failed: ${errorMessage(e)}`);
          return;
        }
      }
      await this.router.navigate(['/budgets', created.id]);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
