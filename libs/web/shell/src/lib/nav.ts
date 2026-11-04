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
    ],
  },
  {
    label: 'Events',
    items: [{ label: 'Events', path: '/events', icon: 'calendar', permission: 'event.manage' }],
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
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', path: '/reports', icon: 'bar_chart', permission: 'report.read' },
      { label: 'Audit log', path: '/audit-log', icon: 'book', permission: 'audit.read' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Organization', path: '/admin/org', icon: 'graph_org', permission: 'org.manage' },
      { label: 'Users and roles', path: '/admin/users', icon: 'users', permission: 'users.manage' },
      {
        label: 'Rules and policies',
        path: '/admin/rules',
        icon: 'rules',
        permission: 'doa.manage',
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
