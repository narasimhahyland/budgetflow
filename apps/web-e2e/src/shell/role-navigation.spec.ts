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
  'Budget hierarchy': 'budget.read',
  'Allocation workspace': 'budget.allocate',
  'Budget list': 'budget.read',
  'Budget requests': 'budget.read',
  'Plans and versions': 'budget.create_root',
  'Program templates': 'master_data.manage',
  // 031a reads budgets to model against; who may author or promote a scenario is decided per
  // scenario by the API, so the entry follows the same budget.read the list endpoint asserts.
  'What-if scenarios': 'budget.read',
  Events: 'tenant.read',
  'Co-funding board': 'event.manage',
  // 122a turnout carries no money and names no individual, so tenant membership is enough.
  Participation: 'tenant.read',
  'Approval inbox': 'request.approve',
  'Request funds': 'request.create',
  'My requests': 'request.create',
  'My budgets': 'request.create',
  // 010a lists only the signed-in person's own activity, so tenant membership is the whole check.
  'My activity': 'tenant.read',
  // 120b and 120a belong to a person rather than to a finance role, so every member reaches them.
  'My wallets': 'tenant.read',
  Recognition: 'tenant.read',
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
  // 011b and 015c read the same reporting scope; drafting and approving a summary need audit.read
  // on top, which the page itself decides rather than the rail.
  'Leadership summaries': 'report.read',
  Outcomes: 'report.read',
  'Approval history': 'audit.read',
  'Audit log': 'audit.read',
  'Org import': 'org.manage',
  'Users and roles': 'users.manage',
  'Rules and policies': 'rules.read',
  Integrations: 'integration.manage',
  'Tenant settings': 'tenant.settings.manage',
  // The four Phase 14 administration screens, all behind the same action as tenant settings.
  'Feature flags': 'tenant.settings.manage',
  'Data retention': 'tenant.settings.manage',
  'System health': 'tenant.settings.manage',
  'Set up BudgetFlow': 'tenant.settings.manage',
  // 113a is one screen with two entries: the server gates reading it on tenant.read, and the rail is
  // deliberately stricter so an Admin entry does not appear for every role. The divergence and the
  // reason are in docs/ux/screens/113a-ai-settings-query-log.md.
  'AI settings': 'tenant.settings.manage',
  'AI accuracy': 'audit.read',
};
// 011a sits beside Home, so every role that is a member of the tenant opens with these two.
const HOME = ['Home', 'Ask BudgetFlow'];
const ORG = ['Organization', 'People', 'Headcount'];
// 031a closes the Budgets group, so for a reader without allocate it follows the three read entries.
const READ = ['Budget hierarchy', 'Budget list', 'Budget requests', 'What-if scenarios'];
const OWNED_BUDGETS = [
  'Budget hierarchy',
  'Allocation workspace',
  'Budget list',
  'Budget requests',
];
// From Phase 5 everyone in the tenant browses events; requesting (and the employee's own budgets)
// follows request.create, which covers the home location's budgets as well as owned ones. 010a,
// 120b, 120a and 069a sit at the end of the group on tenant.read alone, so a role without
// request.create still sees those four on their own.
const PERSONAL = ['My activity', 'My wallets', 'Recognition', 'Policy assistant'];
const REQUESTS = ['Request funds', 'My requests', 'My budgets', ...PERSONAL];
// Everything tenant.settings.manage opens, in rail order; Phase 14 added the last four.
const TENANT_ADMIN = [
  'Tenant settings',
  'Feature flags',
  'Data retention',
  'System health',
  'Set up BudgetFlow',
];
const CLOSE = ['Period close', 'Rollover policies', 'Year-end'];
// The Insights entries report.read alone opens, then 016b, which follows budget.read: no role holds
// one without the other. 016a needs report.board_pack and is listed per role.
const INSIGHTS_READ = ['Reports', 'Utilization', 'Forecast and variance', 'Spending outlook'];
// 011b and 015c follow 016a in the group, so they come after the board pack for the roles that
// hold report.board_pack and straight after the read entries for the roles that do not.
const INSIGHTS_DRAFTED = ['Leadership summaries', 'Outcomes'];
// The two AI review queues in Finance, both tenant-scope only (Finance Admin, Controller, Auditor).
const AI_QUEUES = ['Matching suggestions', 'Anomaly flags'];
const OWNER = [
  ...HOME,
  ...OWNED_BUDGETS,
  'What-if scenarios',
  'Events',
  'Co-funding board',
  'Participation',
  'Approval inbox',
  ...REQUESTS,
  ...ORG,
  ...INSIGHTS_READ,
  ...INSIGHTS_DRAFTED,
];

const EXPECTED: Record<RoleId, string[]> = {
  'super-admin': ['Home'],
  'org-admin': [
    ...HOME,
    'Events',
    'Participation',
    ...PERSONAL,
    ...ORG,
    'Org import',
    'Users and roles',
    ...TENANT_ADMIN,
    'AI settings',
  ],
  ceo: [
    ...HOME,
    ...OWNED_BUDGETS,
    'Plans and versions',
    'What-if scenarios',
    'Events',
    'Co-funding board',
    'Participation',
    'Approval inbox',
    ...REQUESTS,
    ...ORG,
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    ...INSIGHTS_DRAFTED,
    'Approval history',
    'Audit log',
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
    'What-if scenarios',
    'Events',
    'Co-funding board',
    'Participation',
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
    ...INSIGHTS_DRAFTED,
    'Approval history',
    'Audit log',
    'Rules and policies',
    'AI accuracy',
  ],
  'finance-controller': [
    ...HOME,
    ...READ,
    'Events',
    'Participation',
    'Approval inbox',
    ...PERSONAL,
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
    ...INSIGHTS_DRAFTED,
    'Approval history',
    'Audit log',
    'Rules and policies',
    'AI accuracy',
  ],
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': [...HOME, 'Events', 'Co-funding board', 'Participation', ...REQUESTS, ...ORG],
  employee: [...HOME, 'Events', 'Participation', ...REQUESTS, ...ORG],
  auditor: [
    ...HOME,
    ...READ,
    'Events',
    'Participation',
    ...PERSONAL,
    ...ORG,
    ...AI_QUEUES,
    'Delegation of authority',
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    ...INSIGHTS_DRAFTED,
    'Approval history',
    'Audit log',
    'Rules and policies',
    'AI accuracy',
  ],
  'integration-admin': [...HOME, 'Events', 'Participation', ...PERSONAL, 'Integrations'],
  // The analyst holds report.board_pack, so 016a is in their navigation; the audit entries are not.
  analyst: [
    ...HOME,
    ...READ,
    'Events',
    'Participation',
    ...PERSONAL,
    ...ORG,
    ...INSIGHTS_READ,
    'Board and FP&A pack',
    ...INSIGHTS_DRAFTED,
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
