/**
 * The authorization rule table behind `PolicyService.can(actor, action, resource)`. Pure: the API
 * builds the actor and resource from the database and asks here. Role names never appear in
 * controllers, components or jobs. Matrix documented in docs/architecture/authorization.md.
 */
export const ROLE_IDS = [
  'super-admin',
  'org-admin',
  'ceo',
  'finance-admin',
  'finance-controller',
  'budget-owner',
  'department-head',
  'regional-manager',
  'location-manager',
  'event-organizer',
  'employee',
  'auditor',
  'integration-admin',
  'analyst',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ACTIONS = [
  'tenant.read',
  'tenant.settings.manage',
  'org.manage',
  'users.manage',
  'budget.read',
  'budget.create_root',
  'budget.create_child',
  'budget.allocate',
  'budget.control',
  'ledger.read',
  'ledger.manual_journal',
  'ledger.reverse',
  'period.manage',
  'fx.manage',
  'doa.manage',
  'request.create',
  'request.approve',
  'contribution.request',
  'contribution.decide',
  'event.manage',
  'actuals.manage',
  'report.read',
  'audit.read',
  'integrity.run',
  'integrity.read',
  'integration.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Scope of a grant: `tenant` = every resource in the tenant; `owned` = budget subtrees the actor owns
 * or co-owns (and scoped role grants); `self` = resources the actor created or is party to.
 */
export type Scope = 'tenant' | 'owned' | 'self';

type Grants = Partial<Record<Action, Scope>>;

const OWNER: Grants = {
  'tenant.read': 'tenant',
  'budget.read': 'owned',
  'budget.create_child': 'owned',
  'budget.allocate': 'owned',
  'budget.control': 'owned',
  'ledger.read': 'owned',
  'request.create': 'owned',
  'request.approve': 'owned',
  'contribution.request': 'owned',
  'contribution.decide': 'owned',
  'event.manage': 'owned',
  'report.read': 'owned',
};

export const ROLE_GRANTS: Record<RoleId, Grants> = {
  // Platform operator: no tenant financial data without an audited break-glass grant.
  'super-admin': {},
  'org-admin': {
    'tenant.read': 'tenant',
    'tenant.settings.manage': 'tenant',
    'org.manage': 'tenant',
    'users.manage': 'tenant',
  },
  ceo: {
    ...OWNER,
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'budget.create_root': 'tenant',
    'report.read': 'tenant',
    'audit.read': 'tenant',
  },
  'finance-admin': {
    ...OWNER,
    'budget.read': 'tenant',
    'budget.create_root': 'tenant',
    'budget.create_child': 'tenant',
    'budget.allocate': 'tenant',
    'budget.control': 'tenant',
    'ledger.read': 'tenant',
    'ledger.manual_journal': 'tenant',
    'ledger.reverse': 'tenant',
    'period.manage': 'tenant',
    'fx.manage': 'tenant',
    'doa.manage': 'tenant',
    'actuals.manage': 'tenant',
    'report.read': 'tenant',
    'audit.read': 'tenant',
    'integrity.run': 'tenant',
    'integrity.read': 'tenant',
  },
  'finance-controller': {
    'tenant.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'ledger.reverse': 'tenant',
    'period.manage': 'tenant',
    'actuals.manage': 'tenant',
    'request.approve': 'tenant',
    'report.read': 'tenant',
    'audit.read': 'tenant',
    'integrity.run': 'tenant',
    'integrity.read': 'tenant',
  },
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': {
    'tenant.read': 'tenant',
    'budget.read': 'owned',
    'ledger.read': 'owned',
    'request.create': 'owned',
    'contribution.request': 'owned',
    'event.manage': 'self',
  },
  employee: { 'tenant.read': 'tenant', 'request.create': 'self' },
  auditor: {
    'tenant.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'report.read': 'tenant',
    'audit.read': 'tenant',
    'integrity.read': 'tenant',
  },
  'integration-admin': { 'tenant.read': 'tenant', 'integration.manage': 'tenant' },
  analyst: {
    'tenant.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'report.read': 'tenant',
  },
};

export interface Actor {
  tenantId: string;
  personId: string | null;
  roles: readonly RoleId[];
  /** Materialized paths (`/root/child/`) of budgets the actor owns or co-owns. */
  ownedBudgetPaths: readonly string[];
  /** Active, audited break-glass grant (platform operators only). */
  breakGlass?: boolean;
}

export type Resource =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'budget'; tenantId: string; id: string; path: string }
  | { kind: 'owned-by'; tenantId: string; ownerPersonId: string | null };

export interface Decision {
  allowed: boolean;
  /** Whether the actor may see the resource at all (drives 404 versus 403). */
  visible: boolean;
  reason: string;
}

function scopeCovers(scope: Scope, actor: Actor, resource: Resource): boolean {
  if (scope === 'tenant') return true;
  if (resource.kind === 'tenant')
    return scope === 'owned' ? actor.ownedBudgetPaths.length > 0 : true;
  if (resource.kind === 'budget')
    return actor.ownedBudgetPaths.some((p) => resource.path.startsWith(p));
  return resource.ownerPersonId !== null && resource.ownerPersonId === actor.personId;
}

function bestScope(actor: Actor, action: Action): Scope | null {
  const order: Scope[] = ['tenant', 'owned', 'self'];
  const scopes = actor.roles
    .map((r) => ROLE_GRANTS[r]?.[action])
    .filter((s): s is Scope => Boolean(s));
  return order.find((s) => scopes.includes(s)) ?? null;
}

export function can(actor: Actor, action: Action, resource: Resource): Decision {
  if (resource.tenantId !== actor.tenantId)
    return { allowed: false, visible: false, reason: 'other tenant' };
  if (actor.roles.includes('super-admin') && !actor.breakGlass && actor.roles.length === 1) {
    return {
      allowed: false,
      visible: false,
      reason: 'platform operators need a break-glass grant',
    };
  }
  const readAction: Action = resource.kind === 'budget' ? 'budget.read' : 'tenant.read';
  const readScope = bestScope(actor, readAction);
  const visible = readScope !== null && scopeCovers(readScope, actor, resource);
  const scope = bestScope(actor, action);
  if (scope === null) return { allowed: false, visible, reason: `no role grants ${action}` };
  const allowed = scopeCovers(scope, actor, resource);
  return {
    allowed,
    visible: visible || allowed,
    reason: allowed
      ? `${action} granted at ${scope} scope`
      : `${action} is outside the actor's ${scope} scope`,
  };
}
