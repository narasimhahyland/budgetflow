// Phase 10 scope: reported figures are scoped per role. Finance roles, the CEO, auditors and the
// read-only analyst see the tenant; budget owners see their own subtree and nothing above or beside
// it; employees and organizers have no reports area; and no figure ever crosses a tenant boundary.
import { expect, test } from '@playwright/test';
import { BudgetHealthOverview, ReportCatalog, ReportResult } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';

const TENANT_ROLES = ['finance-admin', 'finance-controller', 'ceo', 'auditor', 'analyst'] as const;

test.describe('report scope per role', () => {
  test('finance roles, the CEO, auditors and the analyst all report tenant-wide', async ({
    request,
  }) => {
    const totals = new Map<string, number>();
    for (const role of TENANT_ROLES) {
      const report = await expectContract(
        await request.get('/api/reports/utilization/run', { headers: await as(role) }),
        200,
        ReportResult,
      );
      expect(report.scope.tenantWide, role).toBe(true);
      expect(report.scope.note, role).toBeNull();
      expect(report.reconciliation.ties, role).toBe(true);
      totals.set(role, report.reconciliation.authorized.amountMinor);
    }
    // Everyone with tenant scope sees the same money.
    expect(new Set(totals.values()).size).toBe(1);
  });

  test('an owner sees their own subtree only, and the figures are their subtree alone', async ({
    request,
  }) => {
    const mine = await createRoot(request, {
      amountMinor: 400_000,
      owner: 'department-head',
      name: `Owner scope root ${Date.now()}`,
    });
    const child = await createChild(request, mine.id, {
      currency: 'USD',
      owner: 'department-head',
    });
    await allocateOk(request, mine.id, child.id, { amountMinor: 150_000, currency: 'USD' });

    const owner = await expectContract(
      await request.get('/api/reports/utilization/run', {
        headers: await as('department-head'),
      }),
      200,
      ReportResult,
    );
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.scope.note).toBe('Showing budgets you can see.');

    const financeTotal = (
      await expectContract(
        await request.get('/api/reports/utilization/run', { headers: await as('finance-admin') }),
        200,
        ReportResult,
      )
    ).reconciliation.authorized.amountMinor;
    // The owner's figure is strictly smaller: the rest of the company is not in it.
    expect(owner.reconciliation.authorized.amountMinor).toBeLessThan(financeTotal);
    expect(owner.rows.some((r) => r.budgetId === mine.id)).toBe(true);
    expect(owner.rows.some((r) => r.budgetId === SEED.budgets.europe)).toBe(false);
  });

  test('an owner cannot widen the scope to a budget outside their subtree', async ({ request }) => {
    await expectProblem(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${SEED.budgets.europe}`, {
        headers: await as('location-manager'),
      }),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      await request.get(
        `/api/reports/utilization/drilldown?budgetId=${SEED.budgets.europe}&bucket=actual`,
        { headers: await as('location-manager') },
      ),
      404,
      'NOT_FOUND',
    );
  });

  test('employees and organizers have no reports', async ({ request }) => {
    for (const role of ['employee', 'org-admin'] as const)
      await expectProblem(
        await request.get('/api/reports/utilization/run', { headers: await as(role) }),
        403,
        'FORBIDDEN',
      );
  });

  test('the catalog hides the company-wide reports from a scoped owner', async ({ request }) => {
    const finance = await expectContract(
      await request.get('/api/reports', { headers: await as('finance-admin') }),
      200,
      ReportCatalog,
    );
    const owner = await expectContract(
      await request.get('/api/reports', { headers: await as('location-manager') }),
      200,
      ReportCatalog,
    );
    expect(finance.scope.tenantWide).toBe(true);
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.scope.note).toBe('Showing budgets you can see.');
    expect(finance.reports.map((r) => r.reportId)).toContain('spend-per-head');
    expect(owner.reports.map((r) => r.reportId)).not.toContain('spend-per-head');
    // A report the owner cannot open is refused, not silently emptied.
    await expectProblem(
      await request.get('/api/reports/spend-per-head/run', {
        headers: await as('location-manager'),
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('figures never cross a tenant boundary', async ({ request }) => {
    const { acme: hyland, globex } = SEED.tenants;
    for (const path of ['/api/reports', '/api/reports/utilization/run', '/api/dashboards/health']) {
      await expectProblem(
        await request.get(path, { headers: await as('globex-admin', {}, hyland) }),
        403,
        'TENANT_NOT_MEMBER',
      );
      await expectProblem(
        await request.get(path, { headers: await as('finance-admin', {}, globex) }),
        403,
        'TENANT_NOT_MEMBER',
      );
    }
    const theirs = await expectContract(
      await request.get('/api/reports/utilization/run', { headers: await as('globex-admin') }),
      200,
      ReportResult,
    );
    expect(theirs.rows.map((r) => r.budgetId)).not.toContain(SEED.budgets.india);
    const ours = await expectContract(
      await request.get('/api/reports/utilization/run', { headers: await as('finance-admin') }),
      200,
      ReportResult,
    );
    expect(ours.rows.map((r) => r.budgetId)).not.toContain(SEED.budgets.globexOperations);
  });

  test('the health overview is scoped the same way and reconciles to the ledger', async ({
    request,
  }) => {
    const finance = await expectContract(
      await request.get('/api/dashboards/health', { headers: await as('finance-controller') }),
      200,
      BudgetHealthOverview,
    );
    expect(finance.scope.tenantWide).toBe(true);
    expect(finance.reconciliation.source).toBe('ledger_balances');
    expect(finance.summary.budgets).toBe(
      finance.summary.healthy + finance.summary.watch + finance.summary.atRisk,
    );

    const owner = await expectContract(
      await request.get('/api/dashboards/health', { headers: await as('regional-manager') }),
      200,
      BudgetHealthOverview,
    );
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.summary.budgets).toBeLessThan(finance.summary.budgets);
    expect(owner.rows.every((r) => r.level !== 'healthy')).toBe(true);
  });
});
