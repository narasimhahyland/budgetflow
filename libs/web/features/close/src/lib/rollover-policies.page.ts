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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { RolloverPolicy } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { CloseTabs } from './close-tabs';
import { ordered, percentOfBps, ROLLOVER_MODE, SWEEP_TARGET } from './close-format';
import { LoadState } from '@bf/web/ui';

/**
 * Screen 87c: the rules that decide what happens to unused money at year end, and which budget
 * follows which rule. Policies move no money: the year-end run (87b) applies them.
 */

const MODE_CATEGORY: Record<RolloverPolicy['mode'], 'gray' | 'blue' | 'teal' | 'purple'> = {
  lapse: 'gray',
  carry_full: 'teal',
  carry_capped: 'blue',
  carry_with_approval: 'purple',
};

const MODE_ICON: Record<RolloverPolicy['mode'], string> = {
  lapse: 'timer_off',
  carry_full: 'redo',
  carry_capped: 'redo',
  carry_with_approval: 'clock',
};
@Component({
  selector: 'bf-rollover-policies-page',
  imports: [
    CloseTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    MatIconModule,
    SAT_EMPTY_STATE_IMPORTS,
    SatCategoryTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Rollover policies</h1>
        <p class="bf-page__subtitle">
          What happens to a budget's unused money at year end: lapse it, carry all of it, carry up
          to a cap, or carry only with approval — and where the part that does not carry goes.
        </p>
      </div>
    </header>
    <bf-close-tabs />
    @if (notice()) {
      <sat-banner variant="success" data-testid="policy-notice">
        <sat-banner-message>{{ notice() }}</sat-banner-message>
      </sat-banner>
    }
    @if (failure()) {
      <sat-banner variant="important" data-testid="policy-failure">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }
    <sat-banner variant="info">
      <sat-banner-message>
        A policy moves no money on its own. It is applied once, by the year-end run, and the dry run
        shows every budget's outcome before anything posts.
      </sat-banner-message>
    </sat-banner>
    <section class="bf-card" aria-labelledby="policies-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="policies-title">Policies</h2>
          <p class="bf-card__hint">
            Policies come from the finance master data. Assign one to a budget below.
          </p>
        </div>
      </div>
      @if (policies.isLoading() && !valueOf(policies)) {
        <bf-load-state [loading]="true" what="rollover policies" />
      } @else if (policies.error()) {
        <bf-load-state
          [error]="policies.error()"
          what="rollover policies"
          (retry)="policies.reload()"
        />
      } @else if (!rows().length) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No rollover policies</h3>
          <p satEmptyStateDescription>
            Without a policy a budget's unused money lapses to its parent at year end.
          </p>
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Rollover policies">
            <ng-container matColumnDef="code">
              <th mat-header-cell *matHeaderCellDef scope="col">Policy</th>
              <td mat-cell *matCellDef="let p">
                <span class="bf-cell__name"
                  ><span class="bf-cell__code">{{ p.code }}</span
                  >{{ p.name }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="mode">
              <th mat-header-cell *matHeaderCellDef scope="col">Mode</th>
              <td mat-cell *matCellDef="let p">
                <!-- A mode is a kind of policy, not a state: a category tag, never a status tone. -->
                <span class="bf-tag-cell"
                  ><sat-category-tag [category]="modeCategory(p)"
                    ><mat-icon [svgIcon]="modeIcon(p)" aria-hidden="true" />{{
                      mode(p)
                    }}</sat-category-tag
                  ></span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="cap">
              <th mat-header-cell *matHeaderCellDef scope="col" class="bf-num">Cap</th>
              <td mat-cell *matCellDef="let p" class="bf-num">
                {{ p.capBps === null ? '—' : percentOfBps(p.capBps) }}
              </td>
            </ng-container>
            <ng-container matColumnDef="sweep">
              <th mat-header-cell *matHeaderCellDef scope="col">Part that does not carry</th>
              <td mat-cell *matCellDef="let p">{{ sweep(p) }}</td>
            </ng-container>
            <ng-container matColumnDef="outcome">
              <th mat-header-cell *matHeaderCellDef scope="col">At year end</th>
              <td mat-cell *matCellDef="let p">
                <span class="bf-cell__secondary">{{ outcome(p) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="budgets">
              <th mat-header-cell *matHeaderCellDef scope="col" class="bf-num">Budgets</th>
              <td mat-cell *matCellDef="let p" class="bf-num">{{ p.budgetCount }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
    @if (canAssign()) {
      <section class="bf-card" aria-labelledby="assign-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="assign-title">Assign a policy to a budget</h2>
            <p class="bf-card__hint">
              Search for the budget by name or code; the list shows the first 100 matches. The
              change is audited with your reason. Once a year-end run's commitment freeze date has
              passed, the server refuses changes for that year.
            </p>
          </div>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline">
            <mat-label>Find a budget</mat-label>
            <input
              matInput
              [ngModel]="budgetSearch()"
              (ngModelChange)="searchBudgets($event)"
              placeholder="Name or code"
              data-testid="assign-search"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Budget</mat-label>
            <mat-select
              [ngModel]="budgetId()"
              (ngModelChange)="budgetId.set($event)"
              data-testid="assign-budget"
            >
              @for (b of budgetOptions(); track b.id) {
                <mat-option [value]="b.id">{{ b.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Policy</mat-label>
            <mat-select
              [ngModel]="policyId()"
              (ngModelChange)="policyId.set($event)"
              data-testid="assign-policy"
            >
              <mat-option [value]="''">None (lapse to the parent)</mat-option>
              @for (p of rows(); track p.id) {
                <mat-option [value]="p.id">{{ p.code }} — {{ p.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Reason</mat-label>
            <input
              matInput
              [ngModel]="reason()"
              (ngModelChange)="reason.set($event)"
              data-testid="assign-reason"
            />
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || !ready()"
            (click)="assign()"
            data-testid="confirm-assign"
          >
            Assign policy
          </button>
          <a mat-stroked-button routerLink="/finance/year-end"
            >See every budget's outcome in a dry run</a
          >
        </div>
      </section>
    }
  `,
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolloverPoliciesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly percentOfBps = percentOfBps;
  protected readonly columns = ['code', 'mode', 'cap', 'sweep', 'outcome', 'budgets'];
  protected readonly canAssign = computed(() => this.session.can('master_data.manage'));
  protected readonly policies = resource({
    loader: () => data(this.api.listRolloverPolicies({})),
  });
  /** By code, then id: two policies with the same code would still render in one fixed order. */
  protected readonly rows = computed(() =>
    ordered(valueOf(this.policies)?.items ?? [], (p) => p.code),
  );
  protected readonly budgetSearch = signal('');
  private readonly budgets = resource({
    params: () => ({ q: this.budgetSearch().trim() }),
    loader: async ({ params }) =>
      (
        await data(
          this.api.listBudgets({ query: { limit: 100, ...(params.q ? { q: params.q } : {}) } }),
        )
      ).items,
  });
  protected readonly budgetOptions = computed(() =>
    ordered(
      valueOf(this.budgets) ?? [],
      (b) => b.path,
      (b) => b.name,
    ),
  );
  protected readonly budgetId = signal('');
  protected readonly policyId = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.budgetId().length > 0 && this.reason().trim().length >= 5,
  );

  /** A new search invalidates the chosen budget: the id must always belong to a visible option. */
  protected searchBudgets(term: string): void {
    this.budgetSearch.set(term);
    this.budgetId.set('');
  }

  protected mode(p: RolloverPolicy): string {
    return ROLLOVER_MODE[p.mode];
  }

  protected modeCategory(p: RolloverPolicy): 'gray' | 'blue' | 'teal' | 'purple' {
    return MODE_CATEGORY[p.mode];
  }

  protected modeIcon(p: RolloverPolicy): string {
    return MODE_ICON[p.mode];
  }

  protected sweep(p: RolloverPolicy): string {
    return p.mode === 'carry_full' ? 'Nothing is left behind' : SWEEP_TARGET[p.sweepTo];
  }

  /** Plain English for what the policy does, straight from its own fields — no arithmetic here. */
  protected outcome(p: RolloverPolicy): string {
    const target = SWEEP_TARGET[p.sweepTo].toLowerCase();
    switch (p.mode) {
      case 'lapse':
        return `Nothing carries; everything unused returns to the ${target}.`;
      case 'carry_full':
        return 'Everything unused carries into the next year.';
      case 'carry_capped':
        return `Up to ${p.capBps === null ? 'the cap' : percentOfBps(p.capBps)} of authorized carries; the rest returns to the ${target}.`;
      case 'carry_with_approval':
        return `Carries only once the Finance Controller approves it; the rest returns to the ${target}.`;
    }
  }

  protected async assign(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      const r = await data(
        this.api.assignRolloverPolicy({
          params: { budgetId: this.budgetId() },
          body: {
            rolloverPolicyId: this.policyId() || null,
            reason: this.reason().trim(),
          },
        }),
      );
      const policy = this.rows().find((p) => p.id === r.rolloverPolicyId);
      const message = `${r.budgetName} now follows ${policy ? policy.code : 'no policy (lapse to the parent)'}.`;
      this.notice.set(message);
      this.snack.open(message, undefined, { duration: 5000 });
      this.reason.set('');
      this.policies.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
