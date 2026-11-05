// Role-aware navigation (screen 000a): each role sees exactly the areas its API permissions allow, the
// header names the company (Hyland) and there is no tenant or organization switcher.
import { expect, test } from '@playwright/test';
import type { RoleId } from '@bf/seed';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

/** Navigation label -> API permission it needs (Home needs none). */
const NEEDS: Record<string, string> = {
  'Budget hierarchy': 'budget.read',
  'Allocation workspace': 'budget.allocate',
  'Budget list': 'budget.read',
  'Budget requests': 'budget.read',
  'Plans and versions': 'budget.create_root',
  'Program templates': 'master_data.manage',
  Events: 'tenant.read',
  'Co-funding board': 'event.manage',
  'Approval inbox': 'request.approve',
  'Request funds': 'request.create',
  'My requests': 'request.create',
  'My budgets': 'request.create',
  Organization: 'org.read',
  People: 'org.read',
  Headcount: 'org.read',
  'Cost centers': 'master_data.manage',
  'Actuals and matching': 'actuals.manage',
  'Intercompany recharges': 'actuals.manage',
  'GL tie-out': 'actuals.manage',
  'Fiscal periods': 'period.manage',
  'Exchange rates': 'fx.manage',
  'Legal entities': 'master_data.manage',
  'GL accounts': 'master_data.manage',
  'Reason codes': 'master_data.manage',
  Vendors: 'master_data.manage',
  'Delegation of authority': 'doa.read',
  Reports: 'report.read',
  Utilization: 'report.read',
  'Approval history': 'audit.read',
  'Audit log': 'audit.read',
  'Org import': 'org.manage',
  'Users and roles': 'users.manage',
  'Rules and policies': 'rules.read',
  Integrations: 'integration.manage',
  'Tenant settings': 'tenant.settings.manage',
};
const ORG = ['Organization', 'People', 'Headcount'];
const READ = ['Budget hierarchy', 'Budget list', 'Budget requests'];
// From Phase 5 everyone in the tenant browses events; requesting (and the employee's own budgets)
// follows request.create, which covers the home location's budgets as well as owned ones.
const REQUESTS = ['Request funds', 'My requests', 'My budgets'];
const OWNER = [
  'Home',
  'Budget hierarchy',
  'Allocation workspace',
  'Budget list',
  'Budget requests',
  'Events',
  'Co-funding board',
  'Approval inbox',
  ...REQUESTS,
  ...ORG,
  'Reports',
  'Utilization',
];

const EXPECTED: Record<RoleId, string[]> = {
  'super-admin': ['Home'],
  'org-admin': ['Home', 'Events', ...ORG, 'Org import', 'Users and roles', 'Tenant settings'],
  ceo: [
    ...OWNER.slice(0, 5),
    'Plans and versions',
    ...OWNER.slice(5, -2),
    'Delegation of authority',
    'Reports',
    'Utilization',
    'Approval history',
    'Audit log',
    'Rules and policies',
  ],
  // Owner-scoped grants (requests, events, approvals) need an owned budget; from Phase 4 the seeded finance
  // admin owns the central contingency reserve.
  'finance-admin': [
    'Home',
    'Budget hierarchy',
    'Allocation workspace',
    'Budget list',
    'Budget requests',
    'Plans and versions',
    'Program templates',
    'Events',
    'Co-funding board',
    'Approval inbox',
    ...REQUESTS,
    ...ORG,
    'Cost centers',
    'Actuals and matching',
    'Intercompany recharges',
    'GL tie-out',
    'Fiscal periods',
    'Exchange rates',
    'Legal entities',
    'GL accounts',
    'Reason codes',
    'Vendors',
    'Delegation of authority',
    'Reports',
    'Utilization',
    'Approval history',
    'Audit log',
    'Rules and policies',
  ],
  'finance-controller': [
    'Home',
    ...READ,
    'Events',
    'Approval inbox',
    ...ORG,
    'Actuals and matching',
    'Intercompany recharges',
    'GL tie-out',
    'Fiscal periods',
    'Delegation of authority',
    'Reports',
    'Utilization',
    'Approval history',
    'Audit log',
    'Rules and policies',
  ],
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': ['Home', 'Events', 'Co-funding board', ...REQUESTS, ...ORG],
  employee: ['Home', 'Events', ...REQUESTS, ...ORG],
  auditor: [
    'Home',
    ...READ,
    'Events',
    ...ORG,
    'Delegation of authority',
    'Reports',
    'Utilization',
    'Approval history',
    'Audit log',
    'Rules and policies',
  ],
  'integration-admin': ['Home', 'Events', 'Integrations'],
  analyst: ['Home', ...READ, 'Events', ...ORG, 'Reports', 'Utilization'],
};

for (const [role, expected] of Object.entries(EXPECTED) as [RoleId, string[]][]) {
  test.describe(`navigation for ${role}`, () => {
    test.use({ storageState: authFile(role) });

    test(`${role} sees exactly the areas their permissions allow`, async ({ page, request }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Platform Navigation' });
      await expect(nav.getByRole('menuitem')).toHaveText(expected);
      await expect(page.getByTestId('header-company')).toHaveText('Hyland');
      await expect(
        page.getByRole('button', { name: /switch|tenant|organi[sz]ation/i }),
      ).toHaveCount(0);
      await expect(page.getByRole('combobox')).toHaveCount(0);

      const me = await request.get(`${API_URL}/api/me`, {
        headers: { authorization: `Bearer ${await apiToken(role)}` },
      });
      expect(me.status()).toBe(200);
      const { permissions } = (await me.json()) as { permissions: string[] };
      const allowedByApi = Object.keys(NEEDS).filter((label) => permissions.includes(NEEDS[label]));
      expect(allowedByApi.sort()).toEqual(expected.filter((l) => l !== 'Home').sort());
    });
  });
}
