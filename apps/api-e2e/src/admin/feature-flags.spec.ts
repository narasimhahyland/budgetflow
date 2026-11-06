// Feature flags (screen 105). The invariant this file exists for: a flag may hide or reveal a
// capability, but turning one on never grants an action `PolicyService.can` would refuse. Also
// proves that a money-affecting flag needs a second person, and that lists are deterministic.
import { expect, test } from '@playwright/test';
import {
  EffectiveFeatureList,
  FeatureFlagHistory,
  ProblemDetails,
  SwitchFeatureFlagResult,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { flag, flags, reason, switchFlag, switchFlagOk } from './support';

test.describe.configure({ mode: 'serial' });

const BULK_INVITES = 'experience.bulk_owner_invites';
const AUTO_APPROVE = 'approvals.auto_approve_within_policy';
const WAITLIST = 'events.waitlist_auto_promotion';

test.describe('feature flags', () => {
  test('a flag that is on never grants an action the policy refuses', async ({ request }) => {
    // Turn the bulk-invite capability on for everyone, including people who cannot manage users.
    const on = await switchFlagOk(request, {
      user: 'org-admin',
      key: BULK_INVITES,
      enabled: true,
      reason: reason('open bulk invites to everyone to prove the flag grants nothing'),
    });
    expect(on.applied).toBe(true);
    expect(on.enabled).toBe(true);

    try {
      // The capability is revealed to the employee ...
      const mine = await expectContract(
        await request.get('/api/me/features', { headers: await as('employee') }),
        200,
        EffectiveFeatureList,
      );
      const seen = mine.items.find((f) => f.key === BULK_INVITES);
      expect(seen?.on, 'the flag is on for the employee').toBe(true);
      expect(seen?.gatedAction).toBe('users.manage');
      // ... and the API says plainly that the policy still refuses the action behind it.
      expect(seen?.allowed, 'the employee may not manage users').toBe(false);

      // The action itself is refused, flag or no flag.
      const refused = await request.post('/api/admin/owner-invites', {
        headers: await mutate('employee'),
        data: {
          invites: [
            {
              email: 'nisha.varma2@example.test',
              displayName: 'Nisha Varma',
              proposedRole: 'budget-owner',
              orgUnitId: null,
            },
          ],
          reason: reason('an employee tries to use a capability the flag reveals'),
        },
      });
      await expectProblem(refused, 403, 'FORBIDDEN');

      // The same request from someone who may manage users goes through, so the refusal above is
      // about authorization and not about the endpoint being broken.
      const allowed = await request.post('/api/admin/owner-invites', {
        headers: await mutate('org-admin'),
        data: {
          invites: [
            {
              email: `scenario.${randomUUID().slice(0, 8)}@example.test`,
              displayName: 'Scenario Invitee',
              proposedRole: 'budget-owner',
              orgUnitId: null,
            },
          ],
          reason: reason('the administrator uses the same capability'),
        },
      });
      expect(allowed.status(), await allowed.text()).toBe(201);
    } finally {
      await switchFlagOk(request, {
        user: 'org-admin',
        key: BULK_INVITES,
        enabled: false,
        reason: reason('restore the default off state'),
      });
    }
  });

  test('a capability that is off refuses the request even for someone who may do it', async ({
    request,
  }) => {
    const current = await flag(request, BULK_INVITES);
    expect(current.enabled, 'bulk invites are off by default').toBe(false);
    const res = await request.post('/api/admin/owner-invites', {
      headers: await mutate('org-admin'),
      data: {
        invites: [
          {
            email: 'off.flag@example.test',
            displayName: 'Off Flag',
            proposedRole: 'budget-owner',
            orgUnitId: null,
          },
        ],
        reason: reason('the capability is switched off'),
      },
    });
    await expectProblem(res, 409, 'FEATURE_DISABLED');
  });

  test('a money-affecting flag waits for a Finance Controller who is not the requester', async ({
    request,
  }) => {
    const before = await flag(request, AUTO_APPROVE);
    expect(before.moneyAffecting).toBe(true);
    expect(before.enabled).toBe(false);
    expect(before.pendingChange).toBeNull();

    const requested = await switchFlagOk(request, {
      user: 'finance-admin',
      key: AUTO_APPROVE,
      enabled: true,
      reason: reason('auto-approval within policy, requested by finance'),
    });
    expect(requested.applied, 'a money-affecting change is not applied on the spot').toBe(false);
    expect(requested.enabled, 'the flag stays off until it is confirmed').toBe(false);
    const changeId = requested.pendingChange?.id;
    expect(changeId).toBeTruthy();

    // Still off while it waits.
    expect((await flag(request, AUTO_APPROVE)).enabled).toBe(false);
    expect((await flag(request, AUTO_APPROVE)).pendingChange?.id).toBe(changeId);

    // The Organization Admin can switch product flags but cannot confirm a money-affecting one.
    await expectProblem(
      await request.post(`/api/admin/features/changes/${changeId}/decision`, {
        headers: await mutate('org-admin'),
        data: { decision: 'confirm', reason: reason('an admin tries to confirm') },
      }),
      403,
      'FORBIDDEN',
    );

    // Neither can the requester, even though they are a Finance Admin.
    await expectProblem(
      await request.post(`/api/admin/features/changes/${changeId}/decision`, {
        headers: await mutate('finance-admin'),
        data: { decision: 'confirm', reason: reason('the requester tries to confirm') },
      }),
      403,
      'FORBIDDEN',
    );

    // A second Finance Controller confirms, and only then does it take effect.
    const confirmed = await expectContract(
      await request.post(`/api/admin/features/changes/${changeId}/decision`, {
        headers: await mutate('finance-controller'),
        data: {
          decision: 'confirm',
          reason: reason('the Finance Controller confirms the money-affecting change'),
        },
      }),
      201,
      SwitchFeatureFlagResult,
    );
    expect(confirmed.applied).toBe(true);
    expect(confirmed.enabled).toBe(true);
    expect((await flag(request, AUTO_APPROVE)).enabled).toBe(true);

    // Deciding twice is refused.
    await expectProblem(
      await request.post(`/api/admin/features/changes/${changeId}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'decline', reason: reason('decide the same change twice') },
      }),
      409,
      'CHANGE_NOT_PENDING',
    );

    // Even with the flag on, an employee still cannot approve anything.
    const employeeFeatures = await expectContract(
      await request.get('/api/me/features', { headers: await as('employee') }),
      200,
      EffectiveFeatureList,
    );
    const autoApprove = employeeFeatures.items.find((f) => f.key === AUTO_APPROVE);
    expect(autoApprove?.on).toBe(true);
    expect(autoApprove?.allowed, 'the employee may not approve requests').toBe(false);

    // Put it back off (a second person is needed for that too).
    const off = await switchFlagOk(request, {
      user: 'finance-admin',
      key: AUTO_APPROVE,
      enabled: false,
      reason: reason('restore the default off state'),
    });
    const offChange = off.pendingChange?.id;
    expect(offChange).toBeTruthy();
    await expectContract(
      await request.post(`/api/admin/features/changes/${offChange}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'confirm', reason: reason('restore the default off state') },
      }),
      201,
      SwitchFeatureFlagResult,
    );
    expect((await flag(request, AUTO_APPROVE)).enabled).toBe(false);
  });

  test('a pilot reveals the capability only to the chosen locations', async ({ request }) => {
    const piloted = await flag(request, WAITLIST);
    expect(piloted.rolloutMode).toBe('pilot');
    expect(piloted.pilotOrgUnitIds).toContain(SEED.orgUnits.bengaluru);
    expect(piloted.pilotOrgUnitNames.length).toBe(piloted.pilotOrgUnitIds.length);

    // The Bengaluru location manager is inside the pilot; the Berlin-based department head is in the
    // other piloted location, and the New York budget owner is in neither.
    const inPilot = await expectContract(
      await request.get('/api/me/features', { headers: await as('location-manager') }),
      200,
      EffectiveFeatureList,
    );
    expect(inPilot.items.find((f) => f.key === WAITLIST)?.on).toBe(true);

    const outsidePilot = await expectContract(
      await request.get('/api/me/features', { headers: await as('budget-owner') }),
      200,
      EffectiveFeatureList,
    );
    expect(
      outsidePilot.items.find((f) => f.key === WAITLIST)?.on,
      'the United States director is outside the Bengaluru and Berlin pilot',
    ).toBe(false);

    // A pilot with nothing in it is refused.
    await expectProblem(
      await switchFlag(request, {
        user: 'org-admin',
        key: 'events.post_event_surveys',
        enabled: true,
        rolloutMode: 'pilot',
        reason: reason('a pilot without a group'),
      }),
      422,
      'FLAG_ROLLOUT_INVALID',
    );
  });

  test('a capability that needs a connected system cannot be switched on without it', async ({
    request,
  }) => {
    const teams = await flag(request, 'channels.teams_app');
    expect(teams.dependsOn).toContain('Microsoft Teams');
    expect(teams.dependencyMet, 'the Teams app is not connected in the seed').toBe(false);
    await expectProblem(
      await switchFlag(request, {
        user: 'org-admin',
        key: 'channels.teams_app',
        enabled: true,
        reason: reason('switch on a capability whose app is not connected'),
      }),
      409,
      'FLAG_DEPENDENCY_MISSING',
    );
  });

  test('flags and their history come back in a deterministic order', async ({ request }) => {
    const items = await flags(request);
    const keys = items.map((f) => `${f.area}|${f.name}|${f.key}`);
    expect(keys, 'flags are ordered by area, then name, then key').toEqual([...keys].sort());

    const again = await flags(request);
    expect(again.map((f) => f.key)).toEqual(items.map((f) => f.key));

    const history = await expectContract(
      await request.get('/api/admin/features/history', { headers: await as('auditor') }),
      200,
      FeatureFlagHistory,
    );
    const stamps = history.items.map((h) => h.requestedAt);
    expect(stamps, 'history is newest first').toEqual([...stamps].sort().reverse());
  });

  test('an unknown flag answers 404 and a reader cannot switch anything', async ({ request }) => {
    const unknown = await request.post('/api/admin/features/nope.nothing/switch', {
      headers: await mutate('org-admin'),
      data: { enabled: true, rolloutMode: 'everyone', reason: reason('unknown flag') },
    });
    await expectContract(unknown, 404, ProblemDetails);

    await expectProblem(
      await switchFlag(request, {
        user: 'auditor',
        key: BULK_INVITES,
        enabled: true,
        reason: reason('an auditor tries to switch a flag'),
      }),
      403,
      'FORBIDDEN',
    );
  });
});
