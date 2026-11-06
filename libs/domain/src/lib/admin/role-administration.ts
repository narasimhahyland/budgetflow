/**
 * User and role administration (screens 103, 103a). The rule the whole screen exists to protect:
 * **administration cannot create authority out of nothing**.
 *
 * - Nobody grants a role to themselves.
 * - The platform operator role is never granted from inside a tenant.
 * - A role that confers authority over money or approvals only takes effect once a second person who
 *   already holds that authority confirms it, so an administrator who has no financial authority can
 *   never hand any out — not to someone else, and not to themselves.
 * - Approval limits are never part of a role grant. Authority to approve an amount comes from the
 *   versioned delegation-of-authority matrix (`doa.manage`), which lives server-side.
 */
import { ROLE_GRANTS, type Action, type RoleId } from '../authorization/policy';

/**
 * Actions that move money or decide spending. Granting a role that confers any of them is the
 * escalation risk this module guards.
 */
export const MONEY_AUTHORITY_ACTIONS: readonly Action[] = [
  'budget.create_root',
  'budget.create_child',
  'budget.allocate',
  'budget.control',
  'ledger.manual_journal',
  'ledger.reverse',
  'period.manage',
  'yearend.run',
  'yearend.approve',
  'doa.manage',
  'request.approve',
  'contribution.decide',
  'actuals.manage',
  'gl.sign_off',
  'master_data.manage',
  'flags.confirm_finance',
  'retention.confirm',
];

/** Roles reviewed in the quarterly privileged-access review (screen 113). */
export const PRIVILEGED_ROLES: readonly RoleId[] = [
  'super-admin',
  'org-admin',
  'ceo',
  'finance-admin',
  'finance-controller',
  'integration-admin',
  'auditor',
];

/** The money authority a role confers, in catalog order. */
export function moneyAuthorityOf(role: RoleId): Action[] {
  const grants = ROLE_GRANTS[role] ?? {};
  return MONEY_AUTHORITY_ACTIONS.filter((a) => Boolean(grants[a]));
}

/** The money authority a person holds through the roles they already have. */
export function moneyAuthorityHeld(roles: readonly RoleId[]): Action[] {
  const held = new Set<Action>();
  for (const role of roles) for (const a of moneyAuthorityOf(role)) held.add(a);
  return MONEY_AUTHORITY_ACTIONS.filter((a) => held.has(a));
}

export type RoleGrantError =
  | 'SELF_ROLE_GRANT'
  | 'PRIVILEGE_ESCALATION'
  | 'ROLE_ALREADY_GRANTED'
  | 'ROLE_NOT_GRANTED';

export interface RoleGrantPlan {
  role: RoleId;
  /** Money authority this grant would confer that the requester does not hold themselves. */
  authorityBeyondRequester: Action[];
  /** True when a second person who holds that authority must confirm before it takes effect. */
  needsConfirmation: boolean;
}

export function assessRoleGrant(input: {
  requesterPersonId: string | null;
  requesterRoles: readonly RoleId[];
  targetPersonId: string;
  targetRoles: readonly RoleId[];
  role: RoleId;
}): { ok: true; plan: RoleGrantPlan } | { ok: false; code: RoleGrantError; message: string } {
  if (input.requesterPersonId && input.requesterPersonId === input.targetPersonId)
    return {
      ok: false,
      code: 'SELF_ROLE_GRANT',
      message: 'Nobody can give themselves a role. Ask another administrator.',
    };
  if (input.role === 'super-admin')
    return {
      ok: false,
      code: 'PRIVILEGE_ESCALATION',
      message:
        'The platform operator role is not granted inside a tenant; operators need an approved break-glass grant instead.',
    };
  if (input.targetRoles.includes(input.role))
    return {
      ok: false,
      code: 'ROLE_ALREADY_GRANTED',
      message: 'This person already holds that role.',
    };
  const held = new Set(moneyAuthorityHeld(input.requesterRoles));
  const authorityBeyondRequester = moneyAuthorityOf(input.role).filter((a) => !held.has(a));
  return {
    ok: true,
    plan: {
      role: input.role,
      authorityBeyondRequester,
      needsConfirmation: authorityBeyondRequester.length > 0,
    },
  };
}

/**
 * Whether this person may confirm a pending grant: a different person from the requester and the
 * target, who already holds every piece of authority the grant confers. An administrator without
 * financial authority therefore cannot have one of their own requests waved through by a peer who
 * also lacks it.
 */
export function canConfirmRoleGrant(input: {
  confirmerPersonId: string | null;
  confirmerRoles: readonly RoleId[];
  requesterPersonId: string | null;
  targetPersonId: string;
  role: RoleId;
}):
  | { ok: true }
  | { ok: false; code: 'SAME_PERSON_APPROVAL' | 'PRIVILEGE_ESCALATION'; message: string } {
  if (input.confirmerPersonId && input.confirmerPersonId === input.requesterPersonId)
    return {
      ok: false,
      code: 'SAME_PERSON_APPROVAL',
      message: 'The person who asked for this role cannot confirm it.',
    };
  if (input.confirmerPersonId && input.confirmerPersonId === input.targetPersonId)
    return {
      ok: false,
      code: 'SAME_PERSON_APPROVAL',
      message: 'The person receiving the role cannot confirm it.',
    };
  const held = new Set(moneyAuthorityHeld(input.confirmerRoles));
  const missing = moneyAuthorityOf(input.role).filter((a) => !held.has(a));
  if (missing.length > 0)
    return {
      ok: false,
      code: 'PRIVILEGE_ESCALATION',
      message: `Confirming this role needs the authority it gives: ${missing.join(', ')}.`,
    };
  return { ok: true };
}
