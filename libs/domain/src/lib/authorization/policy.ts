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
  'org.read',
  'headcount.import',
  'master_data.manage',
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
  'period.prepare',
  'yearend.run',
  'yearend.approve',
  'fx.manage',
  'doa.manage',
  'doa.read',
  'rules.read',
  'rules.manage',
  'exception.resolve',
  'request.create',
  'request.approve',
  'contribution.request',
  'contribution.decide',
  'event.manage',
  'event.read',
  'actuals.manage',
  'actuals.read',
  'gl.sign_off',
  'forecast.submit',
  'forecast.manage',
  'report.read',
  'report.schedule',
  /**
   * Build, preview and generate the board and FP&A pack (016a). Separate from `report.read` because
   * the pack is tenant-wide finance work: `report.read` is also granted at `owned` scope, which
   * covers a tenant resource as soon as the actor owns a budget, so it cannot tell the roles the
   * pack admits from the owner roles it refuses. This action is held only at tenant scope.
   */
  'report.board_pack',
  'audit.read',
  /**
   * Generate a one-click evidence pack for an event or budget (088a). Held only at tenant scope by
   * the Auditor, Finance Controller and Finance Admin: a pack bundles documents and decisions across
   * several owners. Downloading a ready pack needs `audit.read`.
   */
  'evidence.generate',
  'integrity.run',
  'integrity.read',
  'integration.manage',
  'integration.read',
  'notification.manage',
  /**
   * Confirm that a finance-affecting AI feature may be turned on (113a). An Organization Admin sets
   * the switch; the feature stays off until a Finance Admin confirms it here.
   */
  'ai.confirm_finance',
  // Administration and experience (P14)
  'flags.confirm_finance',
  'retention.confirm',
  'legal_hold.manage',
  /**
   * Break-glass (112). The platform operator requests time-limited read access to a tenant's
   * financial data; an Organization Admin decides and may revoke; finance and audit read the
   * history. The access a grant opens is BREAK_GLASS_READS below, never more.
   */
  'break_glass.request',
  'break_glass.decide',
  'break_glass.read',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What an approved, unexpired, unrevoked break-glass grant lets the platform operator do: read
 * budgets and the ledger, and the tenant facts needed to read them (screen 112, "read-only; budgets
 * and ledger"). Nothing that changes data, approves or moves money is ever on this list, and nothing
 * outside it is reachable under a grant - not people, not the audit log, not actuals.
 */
export const BREAK_GLASS_READS: readonly Action[] = ['tenant.read', 'budget.read', 'ledger.read'];

/** Actions the platform operator may take without a grant: asking for one. */
const OPERATOR_ACTIONS: readonly Action[] = ['break_glass.request'];

/**
 * Scope of a grant: `tenant` = every resource in the tenant; `owned` = budget subtrees the actor owns
 * or co-owns (and scoped role grants); `self` = resources the actor created or is party to.
 */
export type Scope = 'tenant' | 'owned' | 'self';

type Grants = Partial<Record<Action, Scope>>;

const OWNER: Grants = {
  'tenant.read': 'tenant',
  'org.read': 'owned',
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
  'event.read': 'owned',
  // Owners forecast the budgets they own; accepting and closing a cycle is `forecast.manage`.
  'forecast.submit': 'owned',
  'report.read': 'owned',
  'report.schedule': 'owned',
};

export const ROLE_GRANTS: Record<RoleId, Grants> = {
  // Platform operator: no tenant financial data without an audited break-glass grant.
  'super-admin': { 'break_glass.request': 'tenant' },
  'org-admin': {
    'tenant.read': 'tenant',
    'break_glass.decide': 'tenant',
    'break_glass.read': 'tenant',
    'tenant.settings.manage': 'tenant',
    'org.manage': 'tenant',
    'org.read': 'tenant',
    'headcount.import': 'tenant',
    'users.manage': 'tenant',
    'notification.manage': 'tenant',
  },
  ceo: {
    ...OWNER,
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'budget.create_root': 'tenant',
    'report.read': 'tenant',
    'report.schedule': 'tenant',
    'report.board_pack': 'tenant',
    'event.read': 'tenant',
    'audit.read': 'tenant',
    'org.read': 'tenant',
    'doa.read': 'tenant',
    'integration.read': 'tenant',
    // The CEO approves submitted DoA matrix versions; Finance drafts them.
    'doa.manage': 'tenant',
    'rules.read': 'tenant',
  },
  'finance-admin': {
    'break_glass.read': 'tenant',
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
    'period.prepare': 'tenant',
    'yearend.run': 'tenant',
    'fx.manage': 'tenant',
    'doa.manage': 'tenant',
    'doa.read': 'tenant',
    'org.read': 'tenant',
    'headcount.import': 'tenant',
    'master_data.manage': 'tenant',
    'actuals.manage': 'tenant',
    'actuals.read': 'tenant',
    'gl.sign_off': 'tenant',
    'forecast.submit': 'tenant',
    'forecast.manage': 'tenant',
    'report.read': 'tenant',
    'report.schedule': 'tenant',
    'report.board_pack': 'tenant',
    'event.read': 'tenant',
    'audit.read': 'tenant',
    'evidence.generate': 'tenant',
    'integrity.run': 'tenant',
    'integrity.read': 'tenant',
    'integration.read': 'tenant',
    'notification.manage': 'tenant',
    'rules.read': 'tenant',
    'rules.manage': 'tenant',
    'exception.resolve': 'tenant',
    'ai.confirm_finance': 'tenant',
  },
  'finance-controller': {
    'tenant.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'ledger.reverse': 'tenant',
    'period.manage': 'tenant',
    'period.prepare': 'tenant',
    'yearend.approve': 'tenant',
    'actuals.manage': 'tenant',
    'actuals.read': 'tenant',
    'request.approve': 'tenant',
    'report.read': 'tenant',
    'report.schedule': 'tenant',
    'report.board_pack': 'tenant',
    'event.read': 'tenant',
    'audit.read': 'tenant',
    'evidence.generate': 'tenant',
    'integrity.run': 'tenant',
    'integrity.read': 'tenant',
    'integration.read': 'tenant',
    'org.read': 'tenant',
    'doa.read': 'tenant',
    'rules.read': 'tenant',
    'exception.resolve': 'tenant',
    // Confirms money-affecting feature flags and any retention change that shortens a financial
    // category; places or confirms legal holds with the Auditor.
    'flags.confirm_finance': 'tenant',
    'retention.confirm': 'tenant',
    'legal_hold.manage': 'tenant',
  },
  'budget-owner': OWNER,
  'department-head': OWNER,
  'regional-manager': OWNER,
  'location-manager': OWNER,
  'event-organizer': {
    'tenant.read': 'tenant',
    'org.read': 'self',
    'budget.read': 'owned',
    'ledger.read': 'owned',
    'request.create': 'owned',
    'contribution.request': 'owned',
    'event.manage': 'self',
    'event.read': 'self',
    // Forecast at completion for the open events the organizer runs.
    'forecast.submit': 'owned',
  },
  employee: { 'tenant.read': 'tenant', 'org.read': 'self', 'request.create': 'self' },
  auditor: {
    'tenant.read': 'tenant',
    'break_glass.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'actuals.read': 'tenant',
    'report.read': 'tenant',
    'report.schedule': 'tenant',
    'report.board_pack': 'tenant',
    'event.read': 'tenant',
    'audit.read': 'tenant',
    'evidence.generate': 'tenant',
    'integrity.read': 'tenant',
    'integration.read': 'tenant',
    'org.read': 'tenant',
    'doa.read': 'tenant',
    'rules.read': 'tenant',
    // Runs the integrity checks on demand (screen 113) and places legal holds with the Finance Controller.
    'integrity.run': 'tenant',
    'legal_hold.manage': 'tenant',
  },
  'integration-admin': {
    'tenant.read': 'tenant',
    'integration.manage': 'tenant',
    'integration.read': 'tenant',
  },
  analyst: {
    'tenant.read': 'tenant',
    'org.read': 'tenant',
    'budget.read': 'tenant',
    'ledger.read': 'tenant',
    'report.read': 'tenant',
    'report.schedule': 'tenant',
    'report.board_pack': 'tenant',
    'event.read': 'tenant',
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
  /** Org units whose subtrees the actor's `owned` org scope covers (scoped role grants, owned budgets' units, home units). */
  orgScopeUnitIds?: readonly string[];
  /** The actor's own location and team (`self` org scope). */
  homeOrgUnitIds?: readonly string[];
  /**
   * Service identity (a public API key): the complete set of actions its scopes grant, all at tenant
   * scope. When present it replaces role grants, so a key can only ever do what its scopes name.
   */
  serviceScopes?: readonly Action[];
}

export type Resource =
  | { kind: 'tenant'; tenantId: string }
  /** `orgUnitId`: the budget's location or team, which lets people there request from it (`HOME_UNIT_ACTIONS`). */
  | { kind: 'budget'; tenantId: string; id: string; path: string; orgUnitId?: string | null }
  | { kind: 'owned-by'; tenantId: string; ownerPersonId: string | null }
  /** An org unit as of a date, with every ancestor id (self included). */
  | { kind: 'org-unit'; tenantId: string; id: string; ancestorIds: readonly string[] }
  /** A person, with the ancestor ids (self included) of their location and team. */
  | { kind: 'person'; tenantId: string; personId: string; ancestorIds: readonly string[] };

export interface Decision {
  allowed: boolean;
  /** Whether the actor may see the resource at all (drives 404 versus 403). */
  visible: boolean;
  reason: string;
}

/**
 * Actions people may take on the budget of their own location or team without owning it: an employee
 * requests from their office's budget, an organizer runs events on it. Reading the budget is not one.
 */
export const HOME_UNIT_ACTIONS: readonly Action[] = [
  'request.create',
  'contribution.request',
  'event.manage',
];

function scopeCovers(scope: Scope, actor: Actor, resource: Resource, action?: Action): boolean {
  if (scope === 'tenant') return true;
  if (resource.kind === 'tenant')
    return scope === 'owned'
      ? actor.ownedBudgetPaths.length > 0 ||
          Boolean(
            action && HOME_UNIT_ACTIONS.includes(action) && (actor.homeOrgUnitIds ?? []).length > 0,
          )
      : true;
  if (resource.kind === 'budget') {
    if (actor.ownedBudgetPaths.some((p) => resource.path.startsWith(p))) return true;
    return Boolean(
      action &&
        HOME_UNIT_ACTIONS.includes(action) &&
        resource.orgUnitId &&
        (actor.homeOrgUnitIds ?? []).includes(resource.orgUnitId),
    );
  }
  if (resource.kind === 'org-unit' || resource.kind === 'person') {
    const self =
      resource.kind === 'person'
        ? resource.personId === actor.personId
        : (actor.homeOrgUnitIds ?? []).includes(resource.id);
    if (scope === 'self') return self;
    const roots = actor.orgScopeUnitIds ?? [];
    return self || resource.ancestorIds.some((a) => roots.includes(a));
  }
  return resource.ownerPersonId !== null && resource.ownerPersonId === actor.personId;
}

function bestScope(actor: Actor, action: Action): Scope | null {
  if (actor.serviceScopes) return actor.serviceScopes.includes(action) ? 'tenant' : null;
  const order: Scope[] = ['tenant', 'owned', 'self'];
  const scopes = actor.roles
    .map((r) => ROLE_GRANTS[r]?.[action])
    .filter((s): s is Scope => Boolean(s));
  return order.find((s) => scopes.includes(s)) ?? null;
}

export function can(actor: Actor, action: Action, resource: Resource): Decision {
  if (resource.tenantId !== actor.tenantId)
    return { allowed: false, visible: false, reason: 'other tenant' };
  // The platform operator holds no tenant role. Without a grant it may only ask for one; with an
  // approved grant it may read exactly BREAK_GLASS_READS, at tenant scope, and nothing else.
  if (
    actor.roles.includes('super-admin') &&
    actor.roles.length === 1 &&
    !OPERATOR_ACTIONS.includes(action)
  ) {
    if (!actor.breakGlass)
      return {
        allowed: false,
        visible: false,
        reason: 'platform operators need a break-glass grant',
      };
    const reads = BREAK_GLASS_READS.includes(action);
    // Seeing a resource follows its own read action: budgets via budget.read, people and org units
    // via org.read - which a grant does not open, so they stay invisible under one.
    const seeAction: Action =
      resource.kind === 'budget'
        ? 'budget.read'
        : resource.kind === 'org-unit' || resource.kind === 'person'
          ? 'org.read'
          : 'tenant.read';
    return {
      allowed: reads,
      visible: BREAK_GLASS_READS.includes(seeAction),
      reason: reads
        ? `${action} under a break-glass grant (read-only)`
        : 'a break-glass grant is read-only',
    };
  }
  const readAction: Action =
    resource.kind === 'budget'
      ? 'budget.read'
      : resource.kind === 'org-unit' || resource.kind === 'person'
        ? 'org.read'
        : 'tenant.read';
  const readScope = bestScope(actor, readAction);
  const visible = readScope !== null && scopeCovers(readScope, actor, resource);
  const scope = bestScope(actor, action);
  if (scope === null) return { allowed: false, visible, reason: `no role grants ${action}` };
  const allowed = scopeCovers(scope, actor, resource, action);
  return {
    allowed,
    visible: visible || allowed,
    reason: allowed
      ? `${action} granted at ${scope} scope`
      : `${action} is outside the actor's ${scope} scope`,
  };
}
