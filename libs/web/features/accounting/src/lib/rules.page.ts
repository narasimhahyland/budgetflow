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
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import type { MappingRule } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from './load-state';

/** Actual-to-budget mapping rules: conditions on entity, cost center, GL, event code, vendor, card program, merchant and memo. */
@Component({
  selector: 'bf-rules-page',
  imports: [
    ActualsTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Mapping rules</h1>
        <p class="bf-page__subtitle">
          Rules run in priority order after reference and event-code matching. The first rule that
          fits proposes the match.
        </p>
      </div>
      @if (canManage() && !adding()) {
        <button mat-flat-button type="button" (click)="adding.set(true)">Add rule</button>
      }
    </header>
    <bf-actuals-tabs />
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (adding()) {
      <section class="bf-card" aria-labelledby="add-rule">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="add-rule">Add mapping rule</h2>
        </div>
        <form class="bf-form" (ngSubmit)="create()">
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Name</mat-label>
            <input
              matInput
              name="name"
              required
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Priority (lower runs first)</mat-label>
            <input
              matInput
              name="priority"
              type="number"
              min="1"
              [ngModel]="priority()"
              (ngModelChange)="priority.set($event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Legal entity</mat-label>
            <mat-select
              name="entity"
              [ngModel]="cond().legalEntityId ?? ''"
              (ngModelChange)="setCond('legalEntityId', $event)"
            >
              <mat-option value="">Any</mat-option>
              @for (e of valueOf(entities)?.items ?? []; track e.id) {
                <mat-option [value]="e.id">{{ e.code }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Cost center</mat-label>
            <mat-select
              name="cc"
              [ngModel]="cond().costCenterId ?? ''"
              (ngModelChange)="setCond('costCenterId', $event)"
            >
              <mat-option value="">Any</mat-option>
              @for (c of valueOf(costCenters)?.items ?? []; track c.id) {
                <mat-option [value]="c.id">{{ c.code }} · {{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>GL account</mat-label>
            <mat-select
              name="gl"
              [ngModel]="cond().glAccountId ?? ''"
              (ngModelChange)="setCond('glAccountId', $event)"
            >
              <mat-option value="">Any</mat-option>
              @for (g of glAccounts(); track g.id) {
                <mat-option [value]="g.id">{{ g.code }} · {{ g.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Event code</mat-label>
            <input
              matInput
              name="eventCode"
              [ngModel]="cond().eventCode ?? ''"
              (ngModelChange)="setCond('eventCode', $event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Vendor</mat-label>
            <mat-select
              name="vendor"
              [ngModel]="cond().vendorId ?? ''"
              (ngModelChange)="setCond('vendorId', $event)"
            >
              <mat-option value="">Any</mat-option>
              @for (v of valueOf(vendors)?.items ?? []; track v.id) {
                <mat-option [value]="v.id">{{ v.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Card program</mat-label>
            <input
              matInput
              name="card"
              [ngModel]="cond().cardProgram ?? ''"
              (ngModelChange)="setCond('cardProgram', $event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Merchant contains</mat-label>
            <input
              matInput
              name="merchant"
              [ngModel]="cond().merchantContains ?? ''"
              (ngModelChange)="setCond('merchantContains', $event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Description contains</mat-label>
            <input
              matInput
              name="memo"
              [ngModel]="cond().memoContains ?? ''"
              (ngModelChange)="setCond('memoContains', $event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Send to budget</mat-label>
            <mat-select
              name="budget"
              [ngModel]="targetBudget()"
              (ngModelChange)="targetBudget.set($event); targetEvent.set(null)"
            >
              <mat-option [value]="null">—</mat-option>
              @for (b of valueOf(budgets)?.items ?? []; track b.id) {
                <mat-option [value]="b.id">{{ b.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Or to an event's commitments</mat-label>
            <mat-select
              name="event"
              [ngModel]="targetEvent()"
              (ngModelChange)="targetEvent.set($event); targetBudget.set(null)"
            >
              <mat-option [value]="null">—</mat-option>
              @for (e of valueOf(events)?.items ?? []; track e.id) {
                <mat-option [value]="e.id">{{ e.eventCode }} · {{ e.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </form>
        <div class="bf-form__actions">
          <button mat-button type="button" (click)="adding.set(false)">Cancel</button>
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || !name().trim() || (!targetBudget() && !targetEvent())"
            (click)="create()"
          >
            Save rule
          </button>
        </div>
      </section>
    }
    <section class="bf-card" aria-label="Mapping rules">
      @if (rules.isLoading() && !valueOf(rules)) {
        <bf-load-state [loading]="true" what="mapping rules" />
      } @else if (rules.error()) {
        <bf-load-state [error]="rules.error()" what="mapping rules" (retry)="rules.reload()" />
      } @else if ((valueOf(rules)?.items ?? []).length === 0) {
        <p class="bf-empty">No mapping rules yet.</p>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="valueOf(rules)!.items" aria-label="Mapping rules">
            <ng-container matColumnDef="priority">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Priority</th>
              <td mat-cell *matCellDef="let r" class="bf-num">{{ r.priority }}</td>
            </ng-container>
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Rule</th>
              <td mat-cell *matCellDef="let r">
                <span class="bf-cell__primary">{{ r.name }}</span>
                <span class="bf-cell__secondary">{{ conditions(r) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="target">
              <th mat-header-cell *matHeaderCellDef>Sends to</th>
              <td mat-cell *matCellDef="let r">
                {{ r.targetBudgetName ?? 'Event ' + r.targetEventCode }}
              </td>
            </ng-container>
            <ng-container matColumnDef="active">
              <th mat-header-cell *matHeaderCellDef>Active</th>
              <td mat-cell *matCellDef="let r">
                <mat-slide-toggle
                  [checked]="r.active"
                  [disabled]="!canManage() || busy()"
                  (change)="toggle(r, $event.checked)"
                  [aria-label]="'Rule ' + r.name + ' active'"
                />
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrls: ['./page.scss', './accounting.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = ['priority', 'name', 'target', 'active'];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly rules = resource({ loader: () => data(this.api.listMappingRules({})) });
  protected readonly entities = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly costCenters = resource({
    loader: () => data(this.api.listCostCenters({ query: { asOf: todayIso() } })),
  });
  protected readonly gl = resource({ loader: () => data(this.api.listGlAccounts({ query: {} })) });
  protected readonly vendors = resource({
    loader: () => data(this.api.listVendors({ query: { limit: 200 } })),
  });
  protected readonly budgets = resource({
    loader: () => data(this.api.listBudgets({ query: { limit: 200 } })),
  });
  protected readonly events = resource({
    loader: () => data(this.api.listEventReconciliations({})),
  });
  protected readonly glAccounts = computed(() => {
    const le = this.cond().legalEntityId;
    return (valueOf(this.gl)?.items ?? []).filter((g) => !le || g.legalEntityId === le);
  });

  protected readonly adding = signal(false);
  protected readonly name = signal('');
  protected readonly priority = signal(50);
  protected readonly cond = signal<MappingRule['match']>({});
  protected readonly targetBudget = signal<string | null>(null);
  protected readonly targetEvent = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected setCond(key: keyof MappingRule['match'], value: string | null): void {
    this.cond.update((c) => {
      const next = { ...c };
      if (value === null || (typeof value === 'string' && !value.trim())) delete next[key];
      else next[key] = value.trim();
      return next;
    });
  }

  protected conditions(r: MappingRule): string {
    const m = r.match;
    const name = <T extends { id: string }>(
      items: T[] | undefined,
      id: string | undefined,
      f: (t: T) => string,
    ) =>
      id
        ? items?.find((x) => x.id === id)
          ? f(items.find((x) => x.id === id)!)
          : 'unknown'
        : null;
    return [
      name(valueOf(this.entities)?.items, m.legalEntityId, (e) => `entity ${e.code}`),
      name(valueOf(this.costCenters)?.items, m.costCenterId, (c) => `cost center ${c.code}`),
      name(valueOf(this.gl)?.items, m.glAccountId, (g) => `GL ${g.code}`),
      m.eventCode ? `event ${m.eventCode}` : null,
      name(valueOf(this.vendors)?.items, m.vendorId, (v) => `vendor ${v.name}`),
      m.cardProgram ? `card program ${m.cardProgram}` : null,
      m.merchantContains ? `merchant contains “${m.merchantContains}”` : null,
      m.memoContains ? `description contains “${m.memoContains}”` : null,
    ]
      .filter(Boolean)
      .join(' and ');
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      const r = await data(
        this.api.createMappingRule({
          body: {
            name: this.name().trim(),
            priority: Number(this.priority()),
            match: this.cond(),
            ...(this.targetBudget()
              ? { targetBudgetId: this.targetBudget()! }
              : { targetEventId: this.targetEvent()! }),
          },
        }),
      );
      this.notice.set(`Rule "${r.name}" added.`);
      this.adding.set(false);
      this.name.set('');
      this.cond.set({});
      this.rules.reload();
    });
  }

  protected async toggle(r: MappingRule, active: boolean): Promise<void> {
    await this.run(async () => {
      await data(this.api.updateMappingRule({ params: { ruleId: r.id }, body: { active } }));
      this.notice.set(`Rule "${r.name}" ${active ? 'activated' : 'deactivated'}.`);
      this.rules.reload();
    });
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
