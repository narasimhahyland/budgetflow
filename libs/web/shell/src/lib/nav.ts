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
  { label: null, items: [{ label: 'Home', path: '/', icon: 'home' }] },
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
    ],
  },
  {
    label: 'Events',
    items: [
      { label: 'Events', path: '/events', icon: 'calendar', permission: 'tenant.read' },
      {
        label: 'Co-funding board',
        path: '/events/cofunding-board',
        icon: 'users',
        permission: 'event.manage',
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
      {
        label: 'Fiscal periods',
        path: '/finance/periods',
        icon: 'clock',
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
        label: 'Approval history',
        path: '/approvals/history',
        icon: 'checklist',
        permission: 'audit.read',
      },
      { label: 'Audit log', path: '/audit-log', icon: 'book', permission: 'audit.read' },
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
