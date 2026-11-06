import { seedId, TENANTS } from './ids';

/**
 * One seeded Keycloak test user per role in the local realm (infra/keycloak), plus users for the
 * tenant-isolation and destructive integrity scenarios. The id is the storageState file name
 * (tmp/e2e-auth/<id>.json). Passwords are the dev-only BF_E2E_PASSWORD placeholder.
 */
export interface SeedUser {
  id: string;
  username: string;
  /** Fixed Keycloak user id (the JWT `sub`). */
  subject: string;
  personId: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  roles: string[];
  jobTitle: string;
}

const user = (
  n: number,
  id: string,
  username: string,
  first: string,
  last: string,
  roles: string[],
  jobTitle: string,
  tenantId: string = TENANTS.acme,
  person = true,
): SeedUser => ({
  id,
  username,
  subject: seedId('50000000', n),
  personId: person ? seedId('40000000', n) : null,
  displayName: `${first} ${last}`,
  firstName: first,
  lastName: last,
  tenantId,
  roles,
  jobTitle,
});

export const ROLES = [
  user(
    1,
    'super-admin',
    'super.admin@example.test',
    'Sam',
    'Rivera',
    ['super-admin'],
    'Platform operator',
    TENANTS.acme,
    false,
  ),
  user(
    2,
    'org-admin',
    'org.admin@example.test',
    'Taylor',
    'Brooks',
    ['org-admin'],
    'People systems administrator',
  ),
  user(3, 'ceo', 'ceo@example.test', 'Morgan', 'Lee', ['ceo'], 'Chief executive officer'),
  user(
    4,
    'finance-admin',
    'finance.admin@example.test',
    'Priya',
    'Raman',
    ['finance-admin'],
    'Finance systems lead',
  ),
  user(
    5,
    'finance-controller',
    'finance.controller@example.test',
    'Daniel',
    'Weber',
    ['finance-controller'],
    'Group financial controller',
  ),
  user(
    6,
    'budget-owner',
    'budget.owner@example.test',
    'Jordan',
    'Smith',
    ['budget-owner'],
    'Director, United States',
  ),
  user(
    7,
    'department-head',
    'department.head@example.test',
    'Lena',
    'Fischer',
    ['department-head'],
    'Director, Europe',
  ),
  user(
    8,
    'regional-manager',
    'regional.manager@example.test',
    'Ananya',
    'Iyer',
    ['regional-manager'],
    'Regional manager, India',
  ),
  user(
    9,
    'location-manager',
    'location.manager@example.test',
    'Rahul',
    'Menon',
    ['location-manager'],
    'Location manager, Bengaluru',
  ),
  user(
    10,
    'event-organizer',
    'event.organizer@example.test',
    'Kavya',
    'Rao',
    ['event-organizer'],
    'Employee experience coordinator',
  ),
  user(11, 'employee', 'employee@example.test', 'Arjun', 'Das', ['employee'], 'Software engineer'),
  user(12, 'auditor', 'auditor@example.test', 'Grace', 'Kim', ['auditor'], 'Internal auditor'),
  user(
    13,
    'integration-admin',
    'integration.admin@example.test',
    'Omar',
    'Haddad',
    ['integration-admin'],
    'Integration engineer',
  ),
  user(14, 'analyst', 'analyst@example.test', 'Mei', 'Chen', ['analyst'], 'Financial analyst'),
] as const satisfies readonly SeedUser[];

/**
 * Users for scenarios rather than role personas: the scenario-only second tenant (isolation), the
 * sandbox tenant (destructive integrity checks), and Hyland users for the MFA and password-reset journeys.
 */
export const EXTRA_USERS = [
  user(
    15,
    'globex-admin',
    'globex.admin@example.test',
    'Elena',
    'Rossi',
    ['finance-admin', 'ceo'],
    'Finance director',
    TENANTS.globex,
  ),
  user(
    16,
    'sandbox-admin',
    'sandbox.admin@example.test',
    'Chris',
    'Park',
    ['finance-admin', 'ceo'],
    'Sandbox administrator',
    TENANTS.sandbox,
  ),
  // Enrolled in TOTP (BF_E2E_TOTP_SECRET): sign-in always asks for the authenticator code.
  user(
    17,
    'mfa-user',
    'mfa.user@example.test',
    'Noor',
    'Saleh',
    ['finance-controller'],
    'Finance controller, Americas',
  ),
  // Used only by the forgot-password journey, which sets the same dev-only password again.
  user(
    18,
    'reset-user',
    'reset.user@example.test',
    'Elif',
    'Demir',
    ['employee'],
    'Office coordinator',
  ),
  user(
    19,
    'finance-admin-2',
    'finance.admin2@example.test',
    'Marco',
    'Bianchi',
    ['finance-admin'],
    'Finance planning lead',
  ),
  // Period close and year end need two different people: this one prepares and requests in the
  // sandbox tenant, `sandbox-admin` decides. Used by the Phase 11 close scenarios only.
  user(
    20,
    'sandbox-controller',
    'sandbox.controller@example.test',
    'Rhea',
    'Varma',
    ['finance-controller'],
    'Sandbox finance controller',
    TENANTS.sandbox,
  ),
  // A legal hold needs two different people who may manage holds (Auditor and Finance Controller).
  // The destructive retention scenarios run in the sandbox tenant, so it needs its own auditor.
  user(
    21,
    'sandbox-auditor',
    'sandbox.auditor@example.test',
    'Tomas',
    'Nilsson',
    ['auditor'],
    'Sandbox internal auditor',
    TENANTS.sandbox,
  ),
] as const satisfies readonly SeedUser[];

/** Signs in through the simulated corporate identity provider (Hyland SSO) as well as with a password. */
export const SSO_LINKED_USERS: readonly SeedUserId[] = ['employee'];

export type RoleId = (typeof ROLES)[number]['id'];
export type SeedUserId = RoleId | (typeof EXTRA_USERS)[number]['id'];
export const ALL_USERS: readonly SeedUser[] = [...ROLES, ...EXTRA_USERS];
export const authFile = (role: SeedUserId) => `tmp/e2e-auth/${role}.json`;
export const userById = (id: SeedUserId): SeedUser => ALL_USERS.find((u) => u.id === id)!;
