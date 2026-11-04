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
  Events: 'event.manage',
  'Approval inbox': 'request.approve',
  'Request funds': 'request.create',
  'My requests': 'request.create',
  Organization: 'org.read',
  People: 'org.read',
  Headcount: 'org.read',
  'Cost centers': 'master_data.manage',
  'Actuals and matching': 'actuals.manage',
  'GL tie-out': 'actuals.manage',
  'Fiscal periods': 'period.manage',
  'Exchange rates': 'fx.manage',
  'Legal entities': 'master_data.manage',
  'GL accounts': 'master_data.manage',
  'Reason codes': 'master_data.manage',
  Vendors: 'master_data.manage',
  'Delegation of authority': 'doa.read',
  Reports: 'report.read',
  'Audit log': 'audit.read',
  'Org import': 'org.manage',
  'Users and roles': 'users.manage',
  'Rules and policies': 'doa.manage',
  Integrations: 'integration.manage',
  'Tenant settings': 'tenant.settings.manage',
};
const ORG = ['Organization', 'People', 'Headcount'];
const OWNER = [
  'Home',
  'Budget hierarchy',
  'Allocation workspace',
  'Events',
  'Approval inbox',
  'Request funds',
  'My requests',
  ...ORG,
  'Reports',
];

const EXPECTED: Record<RoleId, string[]> = {
  'super-admin': ['Home'],
  'org-admin': ['Home', ...ORG, 'Org import', 'Users and roles', 'Tenant settings'],
  ceo: [...OWNER.slice(0, -1), 'Delegation of authority', 'Reports', 'Audit log'],
  // Owner-scoped grants (requests, events, approvals) need an owned budget; the seeded finance admin owns none.
  'finance-admin': [
    'Home',
    'Budget hierarchy',
    'Allocation workspace',
    ...ORG,
    'Cost centers',
    'Actuals and matching',
    'GL tie-out',
    'Fiscal periods',
    'Exchange rates',
    'Legal entities',
    'GL accounts',
    'Reason codes',
    'Vendors',
    'Delegation of authority',
    'Reports',
    'Audit log',
    'Rules and policies',
  ],
  'finance-controller': [
    'Home',
    'Budget hierarchy',
    'Approval inbox',
    ...ORG,
    'Actuals and matching',
    'GL tie-out',
    'Fiscal periods',
    'Delegation of authority',
    'Reports',
    'Audit log',
  ],
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': ['Home', 'Events', ...ORG],
  employee: ['Home', 'Request funds', 'My requests', ...ORG],
  auditor: ['Home', 'Budget hierarchy', ...ORG, 'Delegation of authority', 'Reports', 'Audit log'],
  'integration-admin': ['Home', 'Integrations'],
  analyst: ['Home', 'Budget hierarchy', ...ORG, 'Reports'],
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
