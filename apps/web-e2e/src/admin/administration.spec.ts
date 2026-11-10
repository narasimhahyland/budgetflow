// Phase 14 administration journeys: feature flags (105), data retention and legal holds (111), users
// and roles (103, 103a), company settings (102b, 109, 110, 112), system health (114), the setup
// checklist (010a) and a person's own activity (122).
//
// Three of these exist because getting them wrong would mislead somebody about money or about data
// that cannot be recovered:
//   - a change that needs a second person must show the value still in force, never the request;
//   - a capability that is on but not allowed must not be offered, because the API refuses it;
//   - a retention run must be previewed and then confirmed by typing DELETE.
//
// Subjects are split so the suites can run side by side: the seeded waiting change on
// `integrations.card_limit_push` is only ever read, and every mutating journey works on its own
// subject and runs once, on desktop.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const CARD_FLAG = 'integrations.card_limit_push';
const AUTO_APPROVE_FLAG = 'approvals.auto_approve_within_policy';
const INVITE_FLAG = 'experience.bulk_owner_invites';

/** The flag list is wide; narrowing it keeps the row in view and the assertions on one subject. */
async function findFlag(page: Page, search: string): Promise<void> {
  await page.goto('/admin/features');
  await expect(page.getByTestId('flag-search')).toBeVisible();
  await page.getByTestId('flag-search').fill(search);
}

test.describe('feature flags (105): a waiting change never reads as a result', () => {
  test.describe('as the Finance Controller who would confirm it', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('shows the state still in force next to the change waiting for a second person', async ({
      page,
    }) => {
      await findFlag(page, 'card');
      // The seeded request asks for this flag to be turned on. Until it is confirmed the flag is off,
      // and the row has to say so: this is the assertion that stops a request reading as a result.
      await expect(page.getByTestId(`flag-state-${CARD_FLAG}`)).toHaveText('Off');
      const pending = page.getByTestId(`pending-${CARD_FLAG}`);
      await expect(pending).toContainText('Waiting for a second person');
      await expect(pending).toContainText('Off is still in force');
      await expect(pending).toContainText('This has not taken effect');
      await expect(pending).toContainText('Turn Push approved commitments to card limits on');
      await expect(pending).toContainText('Priya Raman');
      await expect(pending.getByRole('button', { name: 'Confirm change' })).toBeVisible();
    });
  });

  test.describe('as the Finance Admin who asked for it', () => {
    test.use({ storageState: authFile('finance-admin') });

    test('the requester is told somebody else has to confirm, and can only withdraw', async ({
      page,
    }) => {
      await findFlag(page, 'card');
      const pending = page.getByTestId(`pending-${CARD_FLAG}`);
      await expect(pending).toContainText('You asked for this change, so somebody else has to');
      await expect(pending.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
      await expect(pending.getByRole('button', { name: 'Confirm change' })).toHaveCount(0);
    });
  });

  test.describe('as a read-only analyst', () => {
    test.use({ storageState: authFile('analyst') });

    test('reads the switches without being offered any of them', async ({ page }) => {
      await findFlag(page, 'slack');
      await expectShell(page);
      await expect(page.getByTestId('flag-state-channels.slack_app')).toHaveText('On');
      await expect(page.getByRole('button', { name: 'Turn off' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Pilot' })).toHaveCount(0);
      await expect(page.getByText('Changing one needs company settings')).toBeVisible();
    });
  });
});

test.describe('a money-affecting switch takes two people', () => {
  // One flow across two roles: the request, then the confirmation. Serial so the second half sees
  // what the first half left, and on its own flag so the read-only journeys above stay stable.
  test.describe.configure({ mode: 'serial' });

  test.describe('the Finance Admin asks', () => {
    test.use({ storageState: authFile('finance-admin') });

    test('the flag stays off and the request is recorded as waiting', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await findFlag(page, 'Auto-approve');
      await expect(page.getByTestId(`flag-state-${AUTO_APPROVE_FLAG}`)).toHaveText('Off');
      await page.getByTestId(`turn-on-${AUTO_APPROVE_FLAG}`).click();
      await page
        .getByTestId('switch-reason')
        .fill('Rules now mark low-value team lunches as auto-approvable.');
      await page.getByTestId('switch-submit').click();
      await expect(page.getByTestId('flags-notice')).toContainText('is unchanged and stays off');
      await expect(page.getByTestId('flags-notice')).toContainText(
        'waiting for a Finance Controller',
      );
      await expect(page.getByTestId(`flag-state-${AUTO_APPROVE_FLAG}`)).toHaveText('Off');
      await expect(page.getByTestId(`pending-${AUTO_APPROVE_FLAG}`)).toContainText(
        'Off is still in force',
      );
    });
  });

  test.describe('the Finance Controller confirms', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('confirming puts the new state in force and clears the waiting state', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await findFlag(page, 'Auto-approve');
      await expect(page.getByTestId(`flag-state-${AUTO_APPROVE_FLAG}`)).toHaveText('Off');
      await page.getByRole('button', { name: 'Confirm change' }).click();
      await page
        .getByTestId('decision-reason')
        .fill('Agreed in the finance review: the rules are tight enough.');
      await page.getByTestId('decision-submit').click();
      await expect(page.getByTestId('flags-notice')).toContainText(
        'Auto-approve within policy is now on',
      );
      await expect(page.getByTestId(`flag-state-${AUTO_APPROVE_FLAG}`)).toHaveText('On');
      await expect(page.getByTestId(`pending-${AUTO_APPROVE_FLAG}`)).toHaveCount(0);
    });
  });
});

test.describe('a capability that is on is still not permission', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: authFile('finance-admin') });

  test('the Finance Admin can switch bulk owner invites on', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await findFlag(page, 'Bulk owner invites');
    await expect(page.getByTestId(`flag-state-${INVITE_FLAG}`)).toHaveText('Off');
    await page.getByTestId(`turn-on-${INVITE_FLAG}`).click();
    await page
      .getByTestId('switch-reason')
      .fill('Activating the new budget owners for the next fiscal year.');
    await page.getByTestId('switch-submit').click();
    await expect(page.getByTestId('flags-notice')).toContainText('Bulk owner invites is now on');
    await expect(page.getByTestId(`flag-state-${INVITE_FLAG}`)).toHaveText('On');
  });

  test('the same person is still refused the capability they just switched on', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'follows the switch above');
    await findFlag(page, 'Bulk owner invites');
    // On for this person, because the flag is on for everyone. Not allowed, because the Finance
    // Admin holds no user administration. Both are needed, so the capability is not offered.
    await expect(page.getByTestId(`flag-state-${INVITE_FLAG}`)).toHaveText('On');
    await expect(page.getByTestId(`capability-${INVITE_FLAG}`)).toHaveText(
      'No — shown but not allowed',
    );
    await page.goto('/admin/users/invitations');
    await expect(page.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    await expect(page.getByTestId('invite-email')).toHaveCount(0);
  });
});

test.describe('bulk owner invites as the Organization Admin (103a)', () => {
  test.use({ storageState: authFile('org-admin') });

  test('tracks who was invited and says an invitation grants nothing', async ({ page }) => {
    await page.goto('/admin/users/invitations');
    const table = page.getByRole('table', { name: 'Invited budget owners' });
    await expect(table.getByRole('row', { name: /Nisha Varma/ })).toContainText('Invited');
    // The table says once, for every row, that the proposed role comes only from user administration.
    await expect(
      page.getByText(
        'The role proposed is granted only through user administration, never by the invitation.',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('invite-funnel')).toContainText('of 2 invited people');
  });
});

test.describe('data retention and legal holds (111)', () => {
  test.describe('as the Organization Admin', () => {
    test.use({ storageState: authFile('org-admin') });

    test('presents every period as a provisional default and says which are acted on', async ({
      page,
    }) => {
      await page.goto('/admin/retention');
      await expect(page.getByTestId('period-ledger_journals')).toBeVisible();
      await expect(page.getByTestId('provisional-note')).toContainText(
        'is an approved legal position for any country',
      );
      await expect(page.getByTestId('provisional-note')).toContainText(
        'never deleted, whatever these settings say',
      );
      await expect(page.getByTestId('signoff-summary')).toContainText('13 of 13');
      await expect(page.getByTestId('automation-summary')).toContainText('5 of 13');
      // Locked categories say so in words, and the accounting record is never deletable.
      await expect(page.getByTestId('signoff-ledger_journals')).toHaveText('Provisional');
      await expect(page.getByTestId('locked-ledger_journals')).toContainText('append-only');
      await expect(page.getByTestId('edit-ledger_journals')).toHaveCount(0);
      // A category nothing acts on says that, instead of implying a job is deleting data.
      await expect(page.getByTestId('automation-survey_responses')).toHaveText(
        'Stated policy only',
      );
      await expect(page.getByTestId('automation-notifications')).toHaveText('Applied nightly');
      // AI conversation history is the thirteenth category, and it really deletes: it used to be a
      // read-side filter that kept the text forever while 113a promised a window.
      await expect(page.getByTestId('period-ai_conversations')).toBeVisible();
      await expect(page.getByTestId('signoff-ai_conversations')).toHaveText('Provisional');
      await expect(page.getByTestId('automation-ai_conversations')).toHaveText('Applied nightly');
    });

    test('can preview a run but is not offered the irreversible apply', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await page.goto('/admin/retention');
      await page.getByTestId('start-preview').click();
      await expect(page.getByTestId('preview-banner')).toContainText('Nothing has been removed');
      await expect(page.getByTestId('retention-notice')).toContainText(
        'This is a preview. Nothing has been removed.',
      );
      // Applying needs the Finance Controller, so the button is not offered here at all.
      await expect(page.getByTestId('apply-needs-controller')).toContainText(
        'only a Finance Controller can do it',
      );
      await expect(page.getByTestId('open-apply')).toHaveCount(0);
    });

    test('a shortened financial period waits, and the old one stays in force', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await page.goto('/admin/retention');
      const before = await page.getByTestId('period-financial_evidence').innerText();
      expect(before).toContain('8 years');
      await page.getByTestId('edit-financial_evidence').click();
      await page.getByTestId('period-days').fill('2600');
      await page
        .getByTestId('period-reason')
        .fill('Aligning evidence retention with the statutory seven years.');
      await page.getByTestId('period-save').click();
      await expect(page.getByTestId('retention-notice')).toContainText('is unchanged');
      // The row still shows what is in force, with the waiting change beside it.
      await expect(page.getByTestId('period-financial_evidence')).toHaveText(before);
      const pending = page.getByTestId('pending-financial_evidence');
      await expect(pending).toContainText('Waiting for a second person');
      await expect(pending).toContainText('This has not taken effect');
      await expect(pending).toContainText(before.split('\n')[0]);
      await expect(page.getByTestId('edit-financial_evidence')).toHaveCount(0);
    });
  });

  test.describe('as the Finance Controller who may apply a run', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('previews first, then applies it only once DELETE is typed', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await page.goto('/admin/retention');
      await page.getByTestId('start-preview').click();
      await expect(page.getByTestId('preview-banner')).toContainText('Nothing has been removed');

      await page.getByTestId('open-apply').click();
      await expect(page.getByTestId('irreversible-warning')).toContainText('There is no undo');
      const apply = page.getByTestId('apply-run');
      await expect(apply).toBeDisabled();
      await page.getByTestId('run-reason').fill('Monthly clean-up of expired operational records.');
      await page.getByTestId('confirmation').fill('delete');
      await expect(apply).toBeDisabled();
      await page.getByTestId('confirmation').fill('DELETE');
      await expect(apply).toBeEnabled();
      await apply.click();
      await expect(page.getByTestId('retention-notice')).toBeVisible();
      await expect(page.getByRole('table', { name: 'Retention runs' })).toContainText('Applied');
    });
  });

  test.describe('the seeded legal holds', () => {
    test.use({ storageState: authFile('auditor') });

    test('say whether they are in force, who placed them and what releasing means', async ({
      page,
    }) => {
      await page.goto('/admin/retention');
      const holds = page.getByRole('table', { name: 'Legal holds' });
      const active = holds.getByRole('row', { name: /Expense review of the cross-location event/ });
      await expect(active).toContainText('In force');
      await expect(active).toContainText('Placed by Grace Kim');
      await expect(active).toContainText('Confirmed by Daniel Weber');
      await expect(active).toContainText('Nothing in this scope is deleted or anonymised');
      const released = holds.getByRole('row', { name: /First-quarter sampling/ });
      await expect(released).toContainText('Released');
      await expect(released).toContainText('records in this scope can be removed again');
    });
  });

  test.describe('placing a hold takes two people', () => {
    test.describe.configure({ mode: 'serial' });
    const reason = `Litigation hold for the review opened ${randomUUID().slice(0, 8)}`;
    const rowName = new RegExp(reason.slice(0, 36));

    test.describe('the Auditor places it', () => {
      test.use({ storageState: authFile('auditor') });

      test('a new hold protects nothing until somebody else confirms it', async ({
        page,
      }, info) => {
        test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
        await page.goto('/admin/retention');
        await page.getByTestId('place-hold').click();
        await page.getByTestId('hold-scope').click();
        await page.getByRole('option', { name: 'A range of dates' }).click();
        await page.getByTestId('hold-from').fill('2026-07-01');
        await page.getByTestId('hold-to').fill('2026-09-30');
        await page.getByTestId('hold-reason').fill(`${reason}.`);
        await page.getByTestId('hold-submit').click();
        await expect(page.getByTestId('retention-notice')).toContainText('is not in force yet');

        const row = page.getByRole('table', { name: 'Legal holds' }).getByRole('row', {
          name: rowName,
        });
        await expect(row).toContainText('Not in force yet');
        await expect(row).toContainText('Records in this scope are not protected yet');
        // The Auditor placed it, so the Auditor is not offered the confirmation.
        await expect(row.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
      });
    });

    test.describe('the Finance Controller confirms it', () => {
      test.use({ storageState: authFile('finance-controller') });

      test('confirming puts the hold in force', async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'follows the hold placed above');
        await page.goto('/admin/retention');
        const holds = page.getByRole('table', { name: 'Legal holds' });
        await expect(holds.getByRole('row', { name: rowName })).toContainText('Not in force yet');
        await holds
          .getByRole('row', { name: rowName })
          .getByRole('button', { name: 'Confirm' })
          .click();
        await page
          .getByTestId('hold-decision-reason')
          .fill('Confirmed with legal: the quarter stays untouched.');
        await page.getByTestId('hold-decision-submit').click();
        await expect(page.getByTestId('retention-notice')).toContainText('is in force');
        await expect(holds.getByRole('row', { name: rowName })).toContainText('In force');
      });
    });
  });
});

test.describe('users and roles (103)', () => {
  test.use({ storageState: authFile('org-admin') });

  test('lists people with their roles and marks the privileged ones', async ({ page }) => {
    await page.goto('/admin/users');
    const table = page.getByRole('table', { name: 'People and roles' });
    await expect(table.getByRole('row', { name: /Daniel Weber/ })).toContainText(
      'Finance controller',
    );
    await expect(table.getByRole('row', { name: /Daniel Weber/ })).toContainText('Privileged');
    await expect(table.getByRole('row', { name: /Arjun Das/ })).toContainText('Not in the review');
    await expect(page.getByTestId('privileged-summary')).toContainText('review:');
  });

  test('a grant beyond the requester’s own authority waits, and the roles stay as they were', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/admin/users');
    await page.getByTestId('user-search').fill('Ananya');
    const row = page.getByRole('row', { name: /Ananya Iyer/ });
    await expect(row).toContainText('Regional manager');
    await row.getByRole('button', { name: 'Manage roles' }).click();
    await page.getByTestId('grant-role').click();
    await page.getByRole('option', { name: 'Finance controller', exact: true }).click();
    await page
      .getByTestId('grant-reason')
      .fill('Covering the controller role during the year-end run.');
    await page.getByTestId('grant-submit').click();
    await expect(page.getByTestId('users-notice')).toContainText(
      'does not hold Finance controller',
    );
    await expect(page.getByTestId('authority-beyond')).toContainText(
      'authority you do not hold yourself',
    );
    // The person's roles are unchanged while the grant waits.
    await expect(page.getByRole('row', { name: /Ananya Iyer/ }).first()).not.toContainText(
      'Finance controller',
    );
    await expect(page.locator('[data-testid^="pending-role-"]')).toContainText(
      'Waiting for a second person',
    );
    await expect(page.locator('[data-testid^="pending-role-"]')).toContainText(
      'Regional manager is still in force',
    );
  });
});

test.describe('company settings (102b, 109, 110, 112)', () => {
  test.describe('as the Organization Admin', () => {
    test.use({ storageState: authFile('org-admin') });

    test('offers only the sections the API says this person may change', async ({ page }) => {
      await page.goto('/admin/settings');
      await expect(page.getByTestId('branding-program')).toHaveText('BudgetFlow at Hyland');
      await expect(page.getByTestId('edit-branding')).toBeVisible();
      await expect(page.getByTestId('edit-notifications')).toBeVisible();
      await expect(page.getByTestId('edit-security')).toBeVisible();
      await expect(page.getByTestId('edit-documents')).toBeVisible();
    });

    test('saves a shorter idle timeout', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      await page.goto('/admin/settings');
      await page.getByTestId('edit-security').click();
      await page.getByTestId('idle-minutes').fill('20');
      await page.getByTestId('security-reason').fill('Shorter idle timeout agreed with security.');
      await page.getByTestId('save-security').click();
      await expect(page.getByTestId('settings-notice')).toContainText(
        'session and sign-in settings are saved',
      );
      await expect(page.getByTestId('idle-timeout')).toHaveText('20 minutes');
    });
  });

  test.describe('as a read-only analyst', () => {
    test.use({ storageState: authFile('analyst') });

    test('reads the settings with no editing controls at all', async ({ page }) => {
      await page.goto('/admin/settings');
      await expect(page.getByTestId('settings-read-only')).toContainText('You can read these');
      await expect(page.getByTestId('branding-program')).toBeVisible();
      await expect(page.getByTestId('edit-branding')).toHaveCount(0);
      await expect(page.getByTestId('edit-security')).toHaveCount(0);
      await expect(page.getByTestId('edit-documents')).toHaveCount(0);
      await expect(page.getByTestId('edit-notifications')).toHaveCount(0);
    });
  });
});

test.describe('system health and maintenance (114)', () => {
  test.use({ storageState: authFile('org-admin') });

  test('reports services and nightly jobs without any financial data', async ({ page }) => {
    await page.goto('/admin/health');
    await expect(page.getByTestId('overall-status')).toBeVisible();
    await expect(page.getByTestId('service-api')).toHaveText('Working');
    await expect(page.getByTestId('service-database')).toHaveText('Working');
    await expect(page.getByRole('table', { name: 'Nightly jobs' })).toBeVisible();
    // The page itself carries no money; the shell header chip outside it is a different thing.
    const screen = page.locator('bf-system-health-page');
    await expect(screen).not.toContainText('USD');
    await expect(screen).not.toContainText('INR');
  });

  test('announces and then cancels planned maintenance', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const message = `Planned upgrade of the reporting database ${randomUUID().slice(0, 8)}`;
    await page.goto('/admin/health');
    await page.getByTestId('schedule-notice').click();
    await page.getByTestId('notice-message').fill(message);
    await page.getByTestId('notice-start').fill('2026-12-20T02:00');
    await page.getByTestId('notice-end').fill('2026-12-20T04:00');
    await page.getByTestId('save-notice').click();
    await expect(page.getByTestId('health-notice')).toContainText('scheduled');

    const row = page
      .getByRole('table', { name: 'Planned maintenance notices' })
      .getByRole('row', { name: new RegExp(message.slice(0, 36)) });
    await expect(row).toContainText('Scheduled');
    await row.getByRole('button', { name: 'Cancel notice' }).click();
    await page.getByTestId('cancel-reason').fill('The upgrade moved to the next quarter.');
    await page.getByTestId('cancel-notice-submit').click();
    await expect(page.getByTestId('health-notice')).toContainText('cancelled');
  });
});

test.describe('setup checklist (010a)', () => {
  test.use({ storageState: authFile('org-admin') });

  test('counts the steps from the data that exists and links to what is missing', async ({
    page,
  }) => {
    await page.goto('/admin/setup');
    await expect(page.getByTestId('setup-progress')).toContainText('steps are done');
    const step = page.getByTestId('step-org_structure');
    await expect(step).toContainText('Done');
    await expect(step).toContainText('org unit(s)');
    // A step that is not done offers the screen that finishes it instead of a tick.
    const doa = page.getByTestId('step-doa_matrix');
    await expect(doa).toContainText('To do');
    await expect(doa.getByRole('link', { name: 'Go and finish this' })).toBeVisible();
  });
});

test.describe('my activity (122)', () => {
  test.describe('as a department head', () => {
    test.use({ storageState: authFile('department-head') });

    test('shows this person’s own entries and filters them by kind', async ({ page }) => {
      await page.goto('/my/activity');
      await expect(page.getByTestId('entry-count')).toContainText('entries between');
      const table = page.getByRole('table', { name: 'Your activity, newest first' });
      await expect(table.getByRole('row')).not.toHaveCount(0);
      await expect(table).toContainText('Budgets');
      await page.getByTestId('activity-types').click();
      await page.getByRole('option', { name: 'Approvals' }).click();
      await page.keyboard.press('Escape');
      await expect(table).not.toContainText('Budgets');
      await expect(table).toContainText('Approvals');
    });
  });

  test.describe('as an employee', () => {
    test.use({ storageState: authFile('employee') });

    test('says plainly when a filter matches none of this person’s activity', async ({ page }) => {
      await page.goto('/my/activity');
      await expect(page.getByTestId('entry-count')).toContainText('entries between');
      await page.getByTestId('activity-from').fill('2020-01-01');
      await page.getByTestId('activity-types').click();
      await page.getByRole('option', { name: 'Exports' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('entry-count')).toContainText('0 entries');
      await expect(page.getByText('Nothing matches these filters')).toBeVisible();
    });
  });
});
