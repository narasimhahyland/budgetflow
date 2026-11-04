# Screen skeletons

Adapt names to the real data-access API in `libs/web/data-access`; these show structure, not exact symbols.

## Route (feature lib)
```ts
export const budgetsRoutes: Routes = [
  {
    path: 'allocate/:budgetId',
    title: 'Allocate budget',
    canActivate: [permissionGuard('budget.allocate')],
    loadComponent: () => import('./allocate/allocate-page').then((m) => m.AllocatePage),
  },
];
```

## Component
```ts
@Component({
  selector: 'bf-allocate-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [/* Satori and Material imports, MoneyComponent */],
  templateUrl: './allocate-page.html',
  styleUrl: './allocate-page.scss',
})
export class AllocatePage {
  private readonly budgets = inject(BudgetsDataAccess);
  readonly budgetId = input.required<string>();
  readonly view = this.budgets.allocationView(this.budgetId); // resource: loading | error | value
  readonly state = computed(() => toScreenState(this.view)); // loading | forbidden | blocked | ready | error
}
```

## Template states
```html
@switch (state().kind) {
  @case ('loading') { <sat-ghost /> }
  @case ('forbidden') { <sat-403-error-state /> }
  @case ('error') { <sat-500-error-state /> }
  @default {
    @if (state().kind === 'blocked') {
      <sat-banner>{{ state().message }}</sat-banner> <!-- e.g. "This budget is frozen. New allocations are disabled." -->
    }
    @if (rows().length === 0) {
      <sat-empty-state>No child budgets yet. Add a region to start allocating.</sat-empty-state>
    } @else {
      <!-- mat-table with satTableWithRowStates; money via <bf-money> (currency code, tabular numerals, triplet tooltip) -->
    }
  }
}
```
Check each Satori element's real inputs and content slots in its `.d.ts` before copying this.

## Journey (`apps/web-e2e/src/budgets/allocate.spec.ts`)
```ts
test.use({ storageState: authFile('regional-manager') });

test('over-allocation is a hard block with the remaining amount', async ({ page, request }) => {
  await page.goto('/budgets/allocate/india');
  await page.getByLabel('Amount for Hyderabad Events').fill('999999999');
  await expect(page.getByRole('alert')).toContainText('exceeds the available amount');
  await expect(page.getByRole('button', { name: 'Allocate' })).toBeDisabled();
  const india = await (await request.get('/api/budgets/india', { headers: await bearer('regional-manager') })).json();
  expect(india.available.amountMinor).toBe(seed.india.availableMinor); // nothing posted
});
```

## Visual baseline entry (`apps/web-e2e/visual/screens.json`)
```json
{
  "id": "005-budget-allocation",
  "path": "/budgets/allocate/india",
  "role": "regional-manager",
  "states": [
    { "state": "default", "waitFor": "role=heading[name=\"Allocate budget\"]", "mask": ["[data-testid=last-updated]"] },
    { "state": "over-allocation", "waitFor": "role=heading[name=\"Allocate budget\"]",
      "actions": [{ "fill": ["role=spinbutton[name=\"Amount\"]", "999999999"] }] }
  ]
}
```
