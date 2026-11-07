/**
 * Navigation in the shell. Each item names the API permission it needs (from GET /api/me), never a
 * role. Items for areas built in later phases open a placeholder page until their feature lib lands;
 * the integrator then points the route at the feature's Routes.
 */
export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** API action the item needs; omitted for Home. */
  permission?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Home', path: '/', icon: 'home' },
      /**
       * 011a. The spec reaches the assistant from a header button on every screen; it is built as a
       * page, so it sits beside Home as a tool that belongs to no one area rather than in a group of
       * its own. `tenant.read` is tenant membership, which is what the ask endpoint requires: it
       * runs no further check and scopes every fact it retrieves to the asker.
       */
      { label: 'Ask BudgetFlow', path: '/ask', icon: 'ai', permission: 'tenant.read' },
      /**
       * 092c, the personal half. The connector endpoint runs no further check than tenant
       * membership and scopes everything it returns to the asker, which is also what the page
       * needs: anyone may connect an assistant to their own account.
       */
      {
        label: 'My AI assistants',
        path: '/me/ai-assistants',
        icon: 'gear_ai',
        permission: 'tenant.read',
      },
    ],
  },
  {
    label: 'Budgets',
    items: [
      { label: 'Budget hierarchy', path: '/budgets', icon: 'tree', permission: 'budget.read' },
      {
        label: 'Allocation workspace',
        path: '/budgets/allocate',
        icon: 'grid_view',
        permission: 'budget.allocate',
      },
      {
        label: 'Budget list',
        path: '/budgets/list',
        icon: 'list_bullet',
        permission: 'budget.read',
      },
      {
        label: 'Budget requests',
        path: '/budgets/requests',
        icon: 'check_double',
        permission: 'budget.read',
      },
      {
        label: 'Plans and versions',
        path: '/budgets/plans',
        icon: 'table_chart',
        permission: 'budget.create_root',
      },
      {
        label: 'Program templates',
        path: '/budgets/templates',
        icon: 'copy',
        permission: 'master_data.manage',
      },
      /**
       * 031a. Reading a scenario needs `budget.read`, which is what the list endpoint asserts at
       * tenant scope; whether the reader may also author or promote one is decided by the API per
       * scenario, so the entry appears for the roles that can at least be collaborators.
       */
      {
        label: 'What-if scenarios',
        path: '/budgets/scenarios',
        icon: 'graph_branch',
        permission: 'budget.read',
      },
    ],
  },
  {
    label: 'Events',
    items: [
      { label: 'Events', path: '/events', icon: 'calendar', permission: 'tenant.read' },
      /**
       * 092d. The offers endpoint asserts `event.read` at tenant scope, so the entry appears for
       * exactly the roles that can see anything there.
       */
      { label: 'Marketplace', path: '/marketplace', icon: 'market', permission: 'event.read' },
      {
        label: 'Co-funding board',
        path: '/events/cofunding-board',
        icon: 'users',
        permission: 'event.manage',
      },
      /** 122a. Turnout contains no money and no individual, so every signed-in person may see it. */
      {
        label: 'Participation',
        path: '/participation',
        icon: 'user_group',
        permission: 'tenant.read',
      },
    ],
  },
  {
    label: 'Requests',
    items: [
      {
        label: 'Approval inbox',
        path: '/approvals',
        icon: 'inbox',
        permission: 'request.approve',
      },
      {
        label: 'Request funds',
        path: '/requests/new',
        icon: 'circle_add',
        permission: 'request.create',
      },
      {
        label: 'My requests',
        path: '/requests',
        icon: 'list_bullet',
        permission: 'request.create',
      },
      {
        label: 'My budgets',
        path: '/my/budgets',
        icon: 'currency_dollar',
        permission: 'request.create',
      },
      /**
       * 120b and 120a. Both endpoints assert `tenant.read`: a wallet and a thank-you note belong to
       * a person rather than to a finance role, so every signed-in employee reaches them. The
       * reviewer queue at /wallets/review is linked from the wallet page for the people who have
       * claims to decide, rather than put in front of everyone.
       */
      {
        label: 'My wallets',
        path: '/wallets',
        icon: 'currency_dollar',
        permission: 'tenant.read',
      },
      {
        label: 'Recognition',
        path: '/recognition',
        icon: 'star',
        permission: 'tenant.read',
      },
      /**
       * 069a, which the spec places at "Requests > Policy assistant". The explain endpoint checks
       * only that the feature is on, so `tenant.read` is the permission behind it.
       */
      {
        label: 'Policy assistant',
        path: '/policy-assistant',
        icon: 'chat_info',
        permission: 'tenant.read',
      },
      /**
       * 092b, the personal half. An automation only ever reads a balance or leaves a Draft for the
       * person who connected it, so it sits with their own requests.
       */
      {
        label: 'My automations',
        path: '/me/automations',
        icon: 'connectors',
        permission: 'request.create',
      },
    ],
  },
  {
    label: 'Organization',
    items: [
      { label: 'Organization', path: '/org', icon: 'graph_org', permission: 'org.read' },
      { label: 'People', path: '/org/people', icon: 'users', permission: 'org.read' },
      { label: 'Headcount', path: '/org/headcount', icon: 'user_group', permission: 'org.read' },
      {
        label: 'Cost centers',
        path: '/org/cost-centers',
        icon: 'tag',
        permission: 'master_data.manage',
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Actuals and matching',
        path: '/finance/actuals',
        icon: 'table_chart',
        permission: 'actuals.manage',
      },
      {
        label: 'Intercompany recharges',
        path: '/finance/recharges',
        icon: 'currency_dollar',
        permission: 'actuals.manage',
      },
      {
        label: 'GL tie-out',
        path: '/finance/gl-tie-out',
        icon: 'checklist_rtl',
        permission: 'actuals.manage',
      },
      /**
       * 080f and 017c, the two AI review queues the specs place under Finance. Both list endpoints
       * assert their action at tenant scope, so the entry appears for exactly the roles the server
       * admits: `actuals.read` and `integrity.read` are held only at tenant scope, by Finance Admin,
       * Finance Controller and Auditor.
       */
      {
        label: 'Matching suggestions',
        path: '/finance/actuals/suggestions',
        icon: 'ai',
        permission: 'actuals.read',
      },
      {
        label: 'Anomaly flags',
        path: '/finance/anomalies',
        icon: 'flag',
        permission: 'integrity.read',
      },
      {
        label: 'Fiscal periods',
        path: '/finance/periods',
        icon: 'clock',
        permission: 'period.manage',
      },
      {
        label: 'Period close',
        path: '/finance/close',
        icon: 'checklist_rtl',
        permission: 'period.manage',
      },
      {
        label: 'Rollover policies',
        path: '/finance/rollover-policies',
        icon: 'rules',
        permission: 'period.manage',
      },
      {
        label: 'Year-end',
        path: '/finance/year-end',
        icon: 'calendar',
        permission: 'period.manage',
      },
      {
        label: 'Exchange rates',
        path: '/finance/rates',
        icon: 'currency_dollar',
        permission: 'fx.manage',
      },
      {
        label: 'Legal entities',
        path: '/finance/legal-entities',
        icon: 'globe',
        permission: 'master_data.manage',
      },
      { label: 'GL accounts', path: '/finance/gl', icon: 'book', permission: 'master_data.manage' },
      {
        label: 'Reason codes',
        path: '/finance/reason-codes',
        icon: 'list_bullet',
        permission: 'master_data.manage',
      },
      {
        label: 'Vendors',
        path: '/finance/vendors',
        icon: 'user_square',
        permission: 'master_data.manage',
      },
      {
        label: 'Delegation of authority',
        path: '/finance/doa',
        icon: 'gavel',
        permission: 'doa.read',
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', path: '/reports', icon: 'bar_chart', permission: 'report.read' },
      {
        label: 'Utilization',
        path: '/reports/utilization',
        icon: 'chart_arrow_up',
        permission: 'report.read',
      },
      {
        label: 'Forecast and variance',
        path: '/reports/forecast-variance',
        icon: 'chart_arrow_up',
        permission: 'report.read',
      },
      /**
       * 016b, at "Insights > Spending outlook" per the spec. The list endpoint runs no tenant-scope
       * check and instead returns the budgets the asker can read, so `budget.read` is the permission
       * that decides whether there is anything to see. It is granted at `owned` scope to the owner
       * roles, which keeps the entry away from employees and organizers, as the spec asks.
       */
      {
        label: 'Spending outlook',
        path: '/insights/outlook',
        icon: 'chart_arrow_up',
        permission: 'budget.read',
      },
      /**
       * 016a. `report.board_pack` is the action the pack endpoint checks, held only at tenant scope,
       * so the entry appears for exactly the roles `BoardPackService.assertCanBuild` admits. The
       * route guard keeps `report.read` on purpose, so an owner reaching the URL sees the
       * `sat-403-error-state` the spec calls for: docs/ux/screens/016a-board-fpa-pack.md.
       */
      {
        label: 'Board and FP&A pack',
        path: '/reports/board-pack',
        icon: 'book',
        permission: 'report.board_pack',
      },
      /**
       * 011b and 015c, both gated on `report.read` at tenant scope, which is exactly what the
       * summary and outcome endpoints assert. Drafting and approving a summary need `audit.read`
       * on top, which the page checks by showing the actions the API would allow.
       */
      {
        label: 'Leadership summaries',
        path: '/insights/summaries',
        icon: 'note',
        permission: 'report.read',
      },
      {
        label: 'Outcomes',
        path: '/dashboards/outcomes',
        icon: 'chart_arrow_up',
        permission: 'report.read',
      },
      {
        label: 'Approval history',
        path: '/approvals/history',
        icon: 'checklist_rtl',
        permission: 'audit.read',
      },
      { label: 'Audit log', path: '/audit-log', icon: 'book', permission: 'audit.read' },
      /**
       * 092a, the personal half. `report.read` is exactly what the connector asks for before it
       * will let anyone connect a BI tool, so the entry appears for the people who can use it.
       */
      {
        label: 'My BI connections',
        path: '/me/bi-connections',
        icon: 'dataset_linked',
        permission: 'report.read',
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Org import', path: '/org/import', icon: 'upload', permission: 'org.manage' },
      { label: 'Users and roles', path: '/admin/users', icon: 'users', permission: 'users.manage' },
      {
        label: 'Rules and policies',
        path: '/admin/rules',
        icon: 'rules',
        permission: 'rules.read',
      },
      {
        label: 'Integrations',
        path: '/admin/integrations',
        icon: 'cloud_check',
        permission: 'integration.manage',
      },
      {
        label: 'Tenant settings',
        path: '/admin/settings',
        icon: 'gear',
        permission: 'tenant.settings.manage',
      },
      /**
       * 102d. The Organization Admin owns widget settings, so the rail entry is theirs; the
       * Integration Admin, who co-manages them, reaches the same screen from the connector frame
       * of 092 instead of getting a second entry here.
       */
      {
        label: 'Embeddable widgets',
        path: '/admin/widgets',
        icon: 'apps',
        permission: 'tenant.settings.manage',
      },
      /**
       * 113a, one screen with Features, Query log and Accuracy tabs, reached by two entries because
       * its two audiences hold different permissions. Both are stricter than the server, which gates
       * reading settings and accuracy on `tenant.read`: that would put an Admin entry in front of
       * every signed-in role, and 113a's roles are Organization Admin, Finance Admin and Auditor
       * only. Recorded in docs/ux/screens/113a-ai-settings-query-log.md.
       *
       * `tenant.settings.manage` is the action behind the switches, so AI settings appears for the
       * Organization Admin who sets them. `audit.read` carries the Finance Admin, Finance Controller,
       * Auditor and CEO to the Accuracy tab, which is also how they reach the query log; the path is
       * the tab's own route so the rail highlights the page the person is on.
       */
      {
        label: 'AI settings',
        path: '/admin/ai/features',
        icon: 'gear_ai',
        permission: 'tenant.settings.manage',
      },
      { label: 'AI accuracy', path: '/admin/ai/accuracy', icon: 'speed', permission: 'audit.read' },
    ],
  },
];

/** The groups and items the user's permissions allow; empty groups are dropped. */
export function visibleNav(permissions: ReadonlySet<string>): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || permissions.has(i.permission)),
  })).filter((g) => g.items.length > 0);
}

/** Display names for role ids (labels only; authorization never uses them). */
export const ROLE_LABELS: Record<string, string> = {
  'super-admin': 'Super admin',
  'org-admin': 'Organization admin',
  ceo: 'CEO',
  'finance-admin': 'Finance admin',
  'finance-controller': 'Finance controller',
  'budget-owner': 'Budget owner',
  'department-head': 'Department head',
  'regional-manager': 'Regional manager',
  'location-manager': 'Location manager',
  'event-organizer': 'Event organizer',
  employee: 'Employee',
  auditor: 'Auditor',
  'integration-admin': 'Integration admin',
  analyst: 'Read-only analyst',
};
