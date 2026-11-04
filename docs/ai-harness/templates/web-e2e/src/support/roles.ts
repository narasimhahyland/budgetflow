// Template for apps/web-e2e/src/support/roles.ts: one seeded Keycloak test user per role in the local realm
// (infra/keycloak). The id is the storageState file name (tmp/e2e-auth/<id>.json) used by specs and screens.json.
export const ROLES = [
  { id: 'super-admin', username: 'super.admin@example.test' },
  { id: 'org-admin', username: 'org.admin@example.test' },
  { id: 'ceo', username: 'ceo@example.test' },
  { id: 'finance-admin', username: 'finance.admin@example.test' },
  { id: 'finance-controller', username: 'finance.controller@example.test' },
  { id: 'budget-owner', username: 'budget.owner@example.test' },
  { id: 'department-head', username: 'department.head@example.test' },
  { id: 'regional-manager', username: 'regional.manager@example.test' },
  { id: 'location-manager', username: 'location.manager@example.test' },
  { id: 'event-organizer', username: 'event.organizer@example.test' },
  { id: 'employee', username: 'employee@example.test' },
  { id: 'auditor', username: 'auditor@example.test' },
  { id: 'integration-admin', username: 'integration.admin@example.test' },
  { id: 'analyst', username: 'analyst@example.test' },
] as const;

export type RoleId = (typeof ROLES)[number]['id'];
export const authFile = (role: RoleId) => `tmp/e2e-auth/${role}.json`;
