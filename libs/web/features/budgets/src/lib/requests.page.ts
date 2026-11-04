import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ChangeRequests } from './change-requests';

/** Increase requests and contingency reserve releases waiting for (or decided by) the user. */
@Component({
  selector: 'bf-budget-requests-page',
  imports: [ChangeRequests],
  styleUrl: './page.scss',
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Budget requests</h1>
        <p class="bf-page__subtitle">
          Increase requests go to the owner of the parent budget; contingency reserve releases go to
          the owner of the reserve’s parent or finance. Approving allocates the money; nothing moves
          before that.
        </p>
      </div>
    </header>
    <bf-change-requests />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetRequestsPage {}
