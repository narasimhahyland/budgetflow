import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { SessionStore, VisibleBudgetsStore } from '@bf/web/data-access';
import { BudgetStatus, DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';

/**
 * Interim Home until the role dashboards land (employee dashboard in Phase 5, executive dashboard in
 * Phase 10): who you are in Hyland, and the budgets your role lets you see with API balances.
 */
@Component({
  selector: 'bf-home-page',
  imports: [
    MatButtonModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatGhost,
    Money,
    BudgetStatus,
    DateTimePipe,
  ],
  templateUrl: './home.page.html',
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  protected readonly session = inject(SessionStore);
  protected readonly budgets = inject(VisibleBudgetsStore);
  protected readonly me = this.session.me;
  protected readonly canSeeBudgets = computed(() => this.session.can('budget.read'));
  protected readonly subtitle = computed(() =>
    [this.me()?.jobTitle, this.me()?.locationName, this.me()?.tenantName]
      .filter(Boolean)
      .join(' · '),
  );
  protected readonly columns = ['name', 'status', 'available', 'createdAt'];

  ngOnInit(): void {
    if (this.canSeeBudgets()) void this.budgets.load();
  }

  protected retry(): void {
    void this.budgets.load();
  }
}
