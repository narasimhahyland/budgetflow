// Role-aware navigation (screen 000a): each role sees exactly the areas its API permissions allow, the
// header names the company (Hyland) and there is no tenant or organization switcher.
import { expect, test } from '@playwright/test';
import type { RoleId } from '@bf/seed';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

/** Navigation label -> API permission it needs (Home needs none). */
const NEEDS: Record<string, string> = {
  // 011a and 069a run no permission check of their own beyond tenant membership.
  'Ask BudgetFlow': 'tenant.read',
  'Policy assistant': 'tenant.read',
  // Phase 16. Anyone may connect an assistant to their own account; the marketplace, the
  // personal automations and the personal BI connections follow the action their endpoint
  // asserts, and widget settings belong to the Organization Admin (102d).
  'My AI assistants': 'tenant.read',
  Marketplace: 'event.read',
  'My automations': 'request.create',
  'My BI connections': 'report.read',
  'Embeddable widgets': 'tenant.settings.manage',
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
  // 080f and 017c assert these at tenant scope; both are held only at tenant scope.
  'Matching suggestions': 'actuals.read',
  'Anomaly flags': 'integrity.read',
  'Fiscal periods': 'period.manage',
  'Period close': 'period.manage',
  'Rollover policies': 'period.manage',
  'Year-end': 'period.manage',
  'Exchange rates': 'fx.manage',
  'Legal entities': 'master_data.manage',
  'GL accounts': 'master_data.manage',
  'Reason codes': 'master_data.manage',
  Vendors: 'master_data.manage',
  'Delegation of authority': 'doa.read',
  Reports: 'report.read',
  Utilization: 'report.read',
  'Forecast and variance': 'report.read',
  // 016b returns the budgets the asker can read rather than checking a tenant-scope action.
  'Spending outlook': 'budget.read',
  // 016a names the action its endpoint checks; it is held only at tenant scope, unlike report.read.
  'Board and FP&A pack': 'report.board_pack',
  'Approval history': 'audit.read',
  'Audit log': 'audit.read',
  'Org import': 'org.manage',
  'Users and roles': 'users.manage',
  'Rules and policies': 'rules.read',
  Integrations: 'integration.manage',
  'Tenant settings': 'tenant.settings.manage',
  // 113a is one screen with two entries: the server gates reading it on tenant.read, and the rail is
  // deliberately stricter so an Admin entry does not appear for every role. The divergence and the
  // reason are in docs/ux/screens/113a-ai-settings-query-log.md.
  'AI settings': 'tenant.settings.manage',
  'AI accuracy': 'audit.read',
};
// 011a sits beside Home, so every role that is a member of the tenant opens with these two.
const HOME = ['Home', 'Ask BudgetFlow', 'My AI assistants'];
const ORG = ['Organization', 'People', 'Headcount'];
const READ = ['Budget hierarchy', 'Budget list', 'Budget requests'];
const OWNED_BUDGETS = [
  'Budget hierarchy',
  'Allocation workspace',
  'Budget list',
  'Budget requests',
];
// From Phase 5 everyone in the tenant browses events; requesting (and the employee's own budgets)
// follows request.create, which covers the home location's budgets as well as owned ones. 069a
// closes the group and needs only tenant.read, so roles without request.create see it on its own.
const REQUESTS = [
  'Request funds',
  'My requests',
  'My budgets',
  'Policy assistant',
  'My automations',
];
const CLOSE = ['Period close', 'Rollover policies', 'Year-end'];
// The Insights entries report.read alone opens, then 016b, which follows budget.read: no role holds
// one without the other. 016a needs report.board_pack and is listed per role.
const INSIGHTS_READ = ['Reports', 'Utilization', 'Forecast and variance', 'Spending outlook'];
// The two AI review queues in Finance, both tenant-scope only (Finance Admin, Controller, Auditor).
const AI_QUEUES = ['Matching suggestions', 'Anomaly flags'];
const OWNER = [
  ...HOME,
  ...OWNED_BUDGETS,
  'Events',
  'Marketplace',
  'Co-funding board',
  'Approval inbox',
  ...REQUESTS,
  ...ORG,
  ...INSIGHTS_READ,
  'My BI connections',
];

const EXPECTED: Record<RoleId, string[]> = {
  'super-admin': ['Home'],
  'org-admin': [
    ...HOME,
    'Events',
    'Policy assistant',
    ...ORG,
    'Org import',
    'Users and roles',
    'Tenant settings',
    'Embeddable widgets',
    'AI settings',
  ],
  ceo: [
    ...HOME,
    ...OWNED_BUDGETS,
    'Plans and versions',
    'Events',
    'Marketplace',
    'Co-funding board',
    'Approval inbox',
    ...REQUESTS,
    ...ORG,
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    'Approval history',
    'Audit log',
    'My BI connections',
    'Rules and policies',
    'AI accuracy',
  ],
  // Owner-scoped grants (requests, events, approvals) need an owned budget; from Phase 4 the seeded finance
  // admin owns the central contingency reserve.
  'finance-admin': [
    ...HOME,
    ...OWNED_BUDGETS,
    'Plans and versions',
    'Program templates',
    'Events',
    'Marketplace',
    'Co-funding board',
    'Approval inbox',
    ...REQUESTS,
    ...ORG,
    'Cost centers',
    'Actuals and matching',
    'Intercompany recharges',
    'GL tie-out',
    ...AI_QUEUES,
    'Fiscal periods',
    ...CLOSE,
    'Exchange rates',
    'Legal entities',
    'GL accounts',
    'Reason codes',
    'Vendors',
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    'Approval history',
    'Audit log',
    'My BI connections',
    'Rules and policies',
    'AI accuracy',
  ],
  'finance-controller': [
    ...HOME,
    ...READ,
    'Events',
    'Marketplace',
    'Approval inbox',
    'Policy assistant',
    ...ORG,
    'Actuals and matching',
    'Intercompany recharges',
    'GL tie-out',
    ...AI_QUEUES,
    'Fiscal periods',
    ...CLOSE,
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    'Approval history',
    'Audit log',
    'My BI connections',
    'Rules and policies',
    'AI accuracy',
  ],
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': [...HOME, 'Events', 'Marketplace', 'Co-funding board', ...REQUESTS, ...ORG],
  employee: [...HOME, 'Events', ...REQUESTS, ...ORG],
  auditor: [
    ...HOME,
    ...READ,
    'Events',
    'Marketplace',
    'Policy assistant',
    ...ORG,
    ...AI_QUEUES,
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    'Approval history',
    'Audit log',
    'My BI connections',
    'Rules and policies',
    'AI accuracy',
  ],
  'integration-admin': [...HOME, 'Events', 'Policy assistant', 'Integrations'],
  // The analyst holds report.board_pack, so 016a is in their navigation; the audit entries are not.
  analyst: [
    ...HOME,
    ...READ,
    'Events',
    'Marketplace',
    'Policy assistant',
    ...ORG,
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    'My BI connections',
  ],
};

for (const [role, expected] of Object.entries(EXPECTED) as [RoleId, string[]][]) {
  test.describe(`navigation for ${role}`, () => {
    test.use({ storageState: authFile(role) });

    test(`${role} sees exactly the areas their permissions allow`, async ({ page, request }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Platform Navigation' });
      await expect(nav.getByRole('menuitem')).toHaveText(expected);
      // Satori draws the icon with <mat-icon [svgIcon]>, which renders nothing at all when the name
      // is not in the icon set, so a wrong name is invisible unless something asserts the glyph.
      const iconless = await nav
        .getByRole('menuitem')
        .evaluateAll((items) =>
          items.filter((i) => !i.querySelector('svg')).map((i) => (i.textContent ?? '').trim()),
        );
      expect(iconless, 'every navigation item renders its icon').toEqual([]);
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
