import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import type { AdaptivePlanLine, AdaptivePlanPreview, ConnectionDetail } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi } from './api';
import { sentence } from './labels';

/**
 * Screen 094a, inside the connector frame: the differences between an Adaptive Planning version and
 * the root budgets, with the floor each root cannot drop below. The preview is read-only — applying
 * a plan version is the budget plan import (020a), which is where the approval lives.
 */
@Component({
  selector: 'bf-plan-import',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <section class="bf-card" aria-labelledby="plan-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="plan-title">Plan import</h2>
          <p class="bf-card__hint">
            Compare a version in the planning system with the root budgets. BudgetFlow owns
            everything below the roots; nothing here changes a budget on its own.
          </p>
        </div>
      </div>

      @if (connection().summary.status === 'needs_attention') {
        <sat-banner class="bf-banner" variant="important" data-testid="plan-blocked-credentials">
          <sat-banner-message>
            <strong>The planning system is refusing BudgetFlow’s credentials.</strong>
            {{ sentence(connection().summary.attention ?? 'It refused the last call') }} Imports and
            exports stay paused until the credential is replaced on the Connection tab.
          </sat-banner-message>
        </sat-banner>
      }

      @if (canManage()) {
        <div class="bf-form">
          <mat-form-field appearance="outline">
            <mat-label>Version in the planning system</mat-label>
            <input
              matInput
              [ngModel]="version()"
              (ngModelChange)="version.set($event)"
              placeholder="FY2027 Budget, Approved"
              data-testid="plan-version"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fiscal year</mat-label>
            <input
              matInput
              [ngModel]="fiscalYear()"
              (ngModelChange)="fiscalYear.set($event)"
              placeholder="FY2027"
              data-testid="plan-fiscal-year"
            />
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || version().trim().length < 1 || fiscalYear().trim().length < 4"
            (click)="preview()"
            data-testid="plan-preview"
          >
            Show the differences
          </button>
        </div>
      } @else {
        <p class="bf-card__body bf-note">
          Reading only. Previewing a plan version needs the Integration Admin role.
        </p>
      }

      @if (failure()) {
        <sat-banner class="bf-banner" variant="important" data-testid="plan-error"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }

      @if (result(); as p) {
        @if (p.blocked) {
          <sat-banner class="bf-banner" variant="important" data-testid="plan-floor-blocked">
            <sat-banner-message>
              <strong>This version cannot be applied as it stands.</strong>
              At least one root budget would drop below what it has already allocated, held,
              committed or spent. The rows below say by how much.
            </sat-banner-message>
          </sat-banner>
        } @else if (p.requiresCeoApproval) {
          <sat-banner class="bf-banner" variant="warning" data-testid="plan-new-money">
            <sat-banner-message>
              <strong>This version adds money to the company total.</strong>
              Applying it needs a Finance Admin and the CEO to approve the plan version.
            </sat-banner-message>
          </sat-banner>
        }

        @if (p.unmappedLevels.length) {
          <sat-banner class="bf-banner" variant="warning" data-testid="plan-unmapped">
            <sat-banner-message>
              <strong
                >{{ p.unmappedLevels.length }} planning
                {{ p.unmappedLevels.length === 1 ? 'level has' : 'levels have' }} no root
                budget:</strong
              >
              {{ p.unmappedLevels.join(', ') }}. Map them on the Mappings tab; until then their
              amounts are left out.
            </sat-banner-message>
          </sat-banner>
        }

        <dl class="bf-facts">
          <div>
            <dt>Version</dt>
            <dd>{{ p.externalVersion }}</dd>
          </div>
          <div>
            <dt>Fiscal year</dt>
            <dd>{{ p.fiscalYearLabel }}</dd>
          </div>
          <div>
            <dt>Total difference</dt>
            <dd>
              <bf-money [amountMinor]="p.totalDifferenceMinor" [currency]="p.currency" />
            </dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>{{ p.lines.length | number }}</dd>
          </div>
        </dl>

        @if (lines().length) {
          <div class="bf-table-scroll">
            <table mat-table class="bf-table" [dataSource]="lines()" aria-label="Plan differences">
              <ng-container matColumnDef="level">
                <th mat-header-cell *matHeaderCellDef>Planning level</th>
                <td mat-cell *matCellDef="let l">
                  <span class="bf-cell__primary">{{ l.level }}</span>
                  <span class="bf-cell__secondary">{{
                    l.rootBudgetName ?? 'New in ' + p.fiscalYearLabel
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="current">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Root budget now</th>
                <td mat-cell *matCellDef="let l" class="bf-num">
                  @if (l.currentAmount) {
                    <bf-money
                      [amountMinor]="l.currentAmount.amountMinor"
                      [currency]="l.currentAmount.currency"
                    />
                  } @else {
                    —
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="proposed">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Plan says</th>
                <td mat-cell *matCellDef="let l" class="bf-num">
                  <bf-money
                    [amountMinor]="l.proposedAmount.amountMinor"
                    [currency]="l.proposedAmount.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="difference">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Difference</th>
                <td mat-cell *matCellDef="let l" class="bf-num">
                  @if (l.differenceMinor === 0) {
                    <span class="bf-muted">No change</span>
                  } @else {
                    <bf-money
                      [amountMinor]="l.differenceMinor"
                      [currency]="l.proposedAmount.currency"
                    />
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="note">
                <th mat-header-cell *matHeaderCellDef>What it means</th>
                <td mat-cell *matCellDef="let l">
                  @if (l.blockedReason) {
                    <sat-status-tag status="important">Blocked</sat-status-tag>
                    <span class="bf-cell__secondary">{{ l.blockedReason }}</span>
                    @if (l.floorAmount) {
                      <span class="bf-cell__secondary"
                        >It cannot go below
                        <bf-money
                          [amountMinor]="l.floorAmount.amountMinor"
                          [currency]="l.floorAmount.currency"
                      /></span>
                    }
                  } @else if (l.newMoney) {
                    <sat-status-tag status="warning">New money</sat-status-tag>
                    <span class="bf-cell__secondary"
                      >Finance Admin and the CEO approve the plan version</span
                    >
                  } @else if (l.differenceMinor === 0) {
                    <sat-status-tag status="neutral">Unchanged</sat-status-tag>
                  } @else {
                    <sat-status-tag status="info">Within the floor</sat-status-tag>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                *matRowDef="let row; columns: columns"
                [attr.data-testid]="'plan-row-' + row.level"
              ></tr>
            </table>
          </div>
        } @else {
          <div class="bf-card__body">
            <sat-empty-state>
              <h2 satEmptyStateHeadline>Nothing to compare</h2>
              <p satEmptyStateDescription>The version holds no levels that map to a root budget.</p>
            </sat-empty-state>
          </div>
        }

        <p class="bf-card__body bf-note" data-testid="plan-next-step">
          This is a comparison, not a change. To apply it, take the version to the budget plan
          import, where the plan version is created in Draft and approved before any money moves.
        </p>
      }
    </section>
  `,
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanImport {
  readonly connection = input.required<ConnectionDetail>();
  readonly canManage = input(false);

  private readonly api = injectApi();
  protected readonly sentence = sentence;
  protected readonly columns = ['level', 'current', 'proposed', 'difference', 'note'];
  protected readonly version = signal('');
  protected readonly fiscalYear = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly result = signal<AdaptivePlanPreview | null>(null);

  /** Blocked rows first, then new money, then the rest by level: a fixed order on every preview. */
  protected readonly lines = computed(() =>
    [...(this.result()?.lines ?? [])].sort(
      (a, b) => this.rank(a) - this.rank(b) || a.level.localeCompare(b.level, 'en'),
    ),
  );

  protected async preview(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.result.set(
        await data(
          this.api.previewPlanImport({
            params: { connectionId: this.connection().summary.id },
            body: {
              externalVersion: this.version().trim(),
              fiscalYearLabel: this.fiscalYear().trim(),
            },
          }),
        ),
      );
    } catch (e) {
      this.result.set(null);
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private rank(line: AdaptivePlanLine): number {
    if (line.blockedReason) return 0;
    if (line.newMoney) return 1;
    if (line.differenceMinor !== 0) return 2;
    return 3;
  }
}
