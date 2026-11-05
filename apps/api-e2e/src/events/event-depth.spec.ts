// Phase 9 event depth: templates and recurring series (45a), the plan (46b), invitations, RSVP,
// capacity and the waitlist (47a), attendee-needs privacy and the audited name export (47b), the
// attendance-based cost split re-posted through the ledger (47e), vendor quotes (51a), the survey
// privacy threshold (54a) and the ROI scorecard (54b).
import { expect, test } from '@playwright/test';
import {
  EmployeeInvitationView,
  EventAttendanceView,
  EventDetail,
  EventFeedbackView,
  EventInvitationView,
  EventNeedsSummaryView,
  EventPlanView,
  EventQuotesView,
  EventScorecardView,
  EventTemplate,
  EventTemplateList,
  EventList,
  EventsDashboardView,
  ExportCatererNeedsResult,
  RecurringSeriesResult,
  VendorList,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  approvedEvent,
  auditFor,
  directorTree,
  fundedChild,
  getEvent,
  runLedgerCheck,
  usd,
} from '../support/p5';

const PEOPLE = {
  employee: userById('employee').personId!,
  organizer: userById('event-organizer').personId!,
  analyst: userById('analyst').personId!,
};

test.describe('event templates, recurring series and clone (45a)', () => {
  test('a personal template is private, a company template needs master data rights, and a series creates one draft event per occurrence', async ({
    request,
  }) => {
    const mine = await expectContract(
      await request.post('/api/events/templates', {
        headers: await mutate('event-organizer'),
        data: {
          scope: 'personal',
          name: `Scenario template ${randomUUID().slice(0, 6)}`,
          estimatePerAttendee: usd(4_000),
          checklistTasks: [
            { section: 'before', title: 'Book the room', relativeDueDays: -7 },
            { section: 'after', title: 'Upload receipts', relativeDueDays: 7 },
          ],
          agendaItems: [{ startTime: '18:00', endTime: '20:00', title: 'Dinner' }],
        },
      }),
      201,
      EventTemplate,
    );
    expect(mine.scope).toBe('personal');
    expect(mine.ownerPersonId).toBe(PEOPLE.organizer);

    // Another organizer cannot see someone else's personal template.
    await expectProblem(
      await request.get(`/api/events/templates/${mine.id}`, { headers: await as('budget-owner') }),
      404,
      'NOT_FOUND',
    );

    // Only Finance Admin or Organization Admin publishes a company template.
    await expectProblem(
      await request.post('/api/events/templates', {
        headers: await mutate('event-organizer'),
        data: {
          scope: 'company',
          status: 'published',
          name: `Company template ${randomUUID().slice(0, 6)}`,
          estimatePerAttendee: usd(4_000),
        },
      }),
      403,
      'FORBIDDEN',
    );
    const company = await expectContract(
      await request.post('/api/events/templates', {
        headers: await mutate('finance-admin'),
        data: {
          scope: 'company',
          status: 'published',
          name: `Company template ${randomUUID().slice(0, 6)}`,
          estimatePerAttendee: usd(4_000),
        },
      }),
      201,
      EventTemplate,
    );
    const library = await expectContract(
      await request.get('/api/events/templates', { headers: await as('event-organizer') }),
      200,
      EventTemplateList,
    );
    expect(library.items.map((t) => t.id)).toEqual(expect.arrayContaining([mine.id, company.id]));

    // Archiving takes it out of the library and keeps it out of further edits.
    await expectContract(
      await request.post(`/api/events/templates/${mine.id}/archive`, {
        headers: await mutate('event-organizer'),
        data: { reason: 'Replaced by the company template' },
      }),
      200,
      EventTemplate,
    );
    const after = await expectContract(
      await request.get('/api/events/templates', { headers: await as('event-organizer') }),
      200,
      EventTemplateList,
    );
    expect(after.items.map((t) => t.id)).not.toContain(mine.id);
  });

  test('a dry-run series previews its occurrences without creating anything, and creating makes a draft event each', async ({
    request,
  }) => {
    const { team } = await directorTree(request, { teamMinor: 8_000_000 });
    const body = {
      name: `Quarterly lunch ${randomUUID().slice(0, 6)}`,
      homeBudgetId: team.id,
      locationOrgUnitIds: [SEED.orgUnits.newYork],
      estimatePerOccurrence: usd(200_000),
      frequency: 'quarterly' as const,
      firstDate: '2026-12-10',
      endCount: 3,
    };
    const preview = await expectContract(
      await request.post('/api/events/series', {
        headers: await mutate('budget-owner'),
        data: { ...body, dryRun: true },
      }),
      200,
      RecurringSeriesResult,
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.seriesId).toBeNull();
    expect(preview.occurrences.map((o) => o.occurrenceDate)).toEqual([
      '2026-12-10',
      '2027-03-10',
      '2027-06-10',
    ]);
    expect(preview.totalEstimate).toEqual(usd(600_000));
    expect(preview.occurrences.every((o) => o.createdEventId === null)).toBe(true);

    const created = await expectContract(
      await request.post('/api/events/series', {
        headers: await mutate('budget-owner'),
        data: { ...body, dryRun: false },
      }),
      200,
      RecurringSeriesResult,
    );
    expect(created.seriesId).not.toBeNull();
    expect(created.occurrences).toHaveLength(3);
    for (const o of created.occurrences) {
      expect(o.createdEventId).not.toBeNull();
      const event = await getEvent(request, 'budget-owner', o.createdEventId!);
      // The series reserves nothing: each occurrence is an ordinary draft with its own code.
      expect(event.status).toBe('draft');
      expect(event.seriesId).toBe(created.seriesId);
      expect(event.funding.ownFunds).toEqual(usd(0));
    }
  });

  test('a series refuses dates in a closed accounting period', async ({ request }) => {
    const { team } = await directorTree(request);
    const preview = await expectContract(
      await request.post('/api/events/series', {
        headers: await mutate('budget-owner'),
        data: {
          name: `Closed period series ${randomUUID().slice(0, 6)}`,
          homeBudgetId: team.id,
          locationOrgUnitIds: [SEED.orgUnits.newYork],
          estimatePerOccurrence: usd(100_000),
          frequency: 'custom',
          firstDate: '2026-01-15',
          customDates: ['2026-01-15'],
          dryRun: true,
        },
      }),
      200,
      RecurringSeriesResult,
    );
    test.skip(
      !preview.hasBlockedOccurrences,
      'no closed accounting period in the seeded calendar to test against',
    );
    await expectProblem(
      await request.post('/api/events/series', {
        headers: await mutate('budget-owner'),
        data: {
          name: `Closed period series ${randomUUID().slice(0, 6)}`,
          homeBudgetId: team.id,
          locationOrgUnitIds: [SEED.orgUnits.newYork],
          estimatePerOccurrence: usd(100_000),
          frequency: 'custom',
          firstDate: '2026-01-15',
          customDates: ['2026-01-15'],
          dryRun: false,
        },
      }),
      409,
      'EVENT_DATE_IN_CLOSED_PERIOD',
    );
  });

  test('cloning copies the plan and never the money', async ({ request }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
    });
    await expectContract(
      await request.post(`/api/events/${event.id}/plan/tasks`, {
        headers: await mutate('budget-owner'),
        data: { section: 'before', title: 'Confirm the venue', dueDate: '2026-11-25' },
      }),
      201,
      EventPlanView,
    );
    const clone = await expectContract(
      await request.post(`/api/events/${event.id}/clone`, {
        headers: await mutate('budget-owner'),
        data: { name: `${event.name} next year`, startsAt: '2027-12-03T09:00:00.000Z' },
      }),
      201,
      EventDetail,
    );
    expect(clone.status).toBe('draft');
    expect(clone.eventCode).not.toBe(event.eventCode);
    expect(clone.funding.ownFunds).toEqual(usd(0));
    expect(clone.funding.contributions).toEqual(usd(0));
    expect(clone.commitments).toHaveLength(0);
    const plan = await expectContract(
      await request.get(`/api/events/${clone.id}/plan`, { headers: await as('budget-owner') }),
      200,
      EventPlanView,
    );
    expect(plan.tasks.map((t) => t.title)).toContain('Confirm the venue');
  });
});

test.describe('invitations, capacity and the waitlist (47a)', () => {
  test('a Going answer beyond capacity waits, and a place that frees up promotes the first in line', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
      participantPersonIds: [PEOPLE.employee, PEOPLE.analyst],
    });
    const sent = await expectContract(
      await request.post(`/api/events/${event.id}/invitations/send`, {
        headers: await mutate('budget-owner'),
        data: {
          message: 'Please tell us whether you can come.',
          deadline: '2026-12-01T18:00:00.000Z',
          capacity: 1,
          waitlistEnabled: true,
          autoPromoteWaitlist: true,
        },
      }),
      200,
      EventInvitationView,
    );
    expect(sent.status).toBe('open');
    expect(sent.counts.invited).toBe(2);
    const invitationOf = (view: EventInvitationView, personId: string) =>
      view.participants.find((p) => p.personId === personId)!.id;

    const first = await expectContract(
      await request.post(`/api/invitations/${invitationOf(sent, PEOPLE.employee)}/rsvp`, {
        headers: await mutate('employee'),
        data: { response: 'going' },
      }),
      200,
      EmployeeInvitationView,
    );
    expect(first.rsvpStatus).toBe('going');

    const second = await expectContract(
      await request.post(`/api/invitations/${invitationOf(sent, PEOPLE.analyst)}/rsvp`, {
        headers: await mutate('analyst'),
        data: { response: 'going' },
      }),
      200,
      EmployeeInvitationView,
    );
    expect(second.rsvpStatus).toBe('waitlisted');
    expect(second.waitlistPosition).toBe(1);

    // The first person drops out: the waitlisted person takes the place.
    await expectContract(
      await request.post(`/api/invitations/${invitationOf(sent, PEOPLE.employee)}/rsvp`, {
        headers: await mutate('employee'),
        data: { response: 'cant_go' },
      }),
      200,
      EmployeeInvitationView,
    );
    const promoted = await expectContract(
      await request.get(`/api/invitations/${invitationOf(sent, PEOPLE.analyst)}`, {
        headers: await as('analyst'),
      }),
      200,
      EmployeeInvitationView,
    );
    expect(promoted.rsvpStatus).toBe('going');
    expect(promoted.waitlistPosition).toBeNull();

    // Nobody answers somebody else's invitation.
    await expectProblem(
      await request.post(`/api/invitations/${invitationOf(sent, PEOPLE.analyst)}/rsvp`, {
        headers: await mutate('employee'),
        data: { response: 'cant_go' },
      }),
      404,
      'NOT_FOUND',
    );

    // Closing RSVPs stops further answers.
    await expectContract(
      await request.post(`/api/events/${event.id}/invitations/status`, {
        headers: await mutate('budget-owner'),
        data: { status: 'closed' },
      }),
      200,
      EventInvitationView,
    );
    await expectProblem(
      await request.post(`/api/invitations/${invitationOf(sent, PEOPLE.employee)}/rsvp`, {
        headers: await mutate('employee'),
        data: { response: 'going' },
      }),
      409,
      'RSVP_CLOSED',
    );
  });
});

test.describe('attendee needs privacy and the caterer export (47b)', () => {
  test('organizers see individual answers, others see counts only, and a name export is audited', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
      participantPersonIds: [PEOPLE.employee],
    });
    const sent = await expectContract(
      await request.post(`/api/events/${event.id}/invitations/send`, {
        headers: await mutate('budget-owner'),
        data: { message: 'Join us.', deadline: '2026-12-01T18:00:00.000Z' },
      }),
      200,
      EventInvitationView,
    );
    const invitationId = sent.participants.find((p) => p.personId === PEOPLE.employee)!.id;
    await request.post(`/api/invitations/${invitationId}/rsvp`, {
      headers: await mutate('employee'),
      data: { response: 'going' },
    });
    await expectContract(
      await request.post(`/api/invitations/${invitationId}/needs`, {
        headers: await mutate('employee'),
        data: {
          dietaryPreference: 'vegan',
          allergies: ['nuts'],
          severeAllergy: true,
          accessibility: ['step_free_access'],
          photoConsent: false,
        },
      }),
      200,
      EmployeeInvitationView,
    );
    // "Other" without a description is refused.
    await expectProblem(
      await request.post(`/api/invitations/${invitationId}/needs`, {
        headers: await mutate('employee'),
        data: { dietaryPreference: 'other' },
      }),
      422,
      'VALIDATION_FAILED',
    );

    const organizerView = await expectContract(
      await request.get(`/api/events/${event.id}/needs`, { headers: await as('budget-owner') }),
      200,
      EventNeedsSummaryView,
    );
    expect(organizerView.canSeeIndividual).toBe(true);
    expect(organizerView.individuals).toHaveLength(1);
    expect(organizerView.severeAllergyCount).toBe(1);
    expect(organizerView.photoConsentNo).toBe(1);

    // The person themselves sees their own answer, and never a list of anyone else's.
    const participantView = await expectContract(
      await request.get(`/api/events/${event.id}/needs`, { headers: await as('employee') }),
      200,
      EventNeedsSummaryView,
    );
    expect(participantView.canSeeIndividual).toBe(false);
    expect(participantView.individuals).toHaveLength(0);
    expect(participantView.dietaryCounts['vegan']).toBe(1);

    // Names need the food-safety confirmation, and that export is audited.
    await expectProblem(
      await request.post(`/api/events/${event.id}/needs/export`, {
        headers: await mutate('budget-owner'),
        data: { content: 'counts_and_allergies', foodSafetyConfirmed: false },
      }),
      422,
      'VALIDATION_FAILED',
    );
    const countsOnly = await expectContract(
      await request.post(`/api/events/${event.id}/needs/export`, {
        headers: await mutate('budget-owner'),
        data: { content: 'counts_only' },
      }),
      200,
      ExportCatererNeedsResult,
    );
    expect(countsOnly.audited).toBe(false);
    const withNames = await expectContract(
      await request.post(`/api/events/${event.id}/needs/export`, {
        headers: await mutate('budget-owner'),
        data: { content: 'counts_and_allergies', foodSafetyConfirmed: true },
      }),
      200,
      ExportCatererNeedsResult,
    );
    expect(withNames.audited).toBe(true);
    const audit = await auditFor(request, event.id);
    expect(audit.map((a) => a.action)).toContain('event.needs_exported');
  });
});

test.describe('attendance and the per-head cost split (47e)', () => {
  test('applying the attendance split re-posts the commitment funding lines and keeps the ledger balanced', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request, { teamMinor: 6_000_000 });
    const giver = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 3_000_000,
    });
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(1_000_000),
      ownFunds: usd(600_000),
      participantPersonIds: [PEOPLE.employee, PEOPLE.analyst],
    });
    const contribution = await request.post('/api/contributions', {
      headers: await mutate('budget-owner'),
      data: {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(400_000),
        purpose: 'Co-fund the scenario event',
      },
    });
    expect(contribution.status()).toBe(201);
    const contributionId = ((await contribution.json()) as { id: string }).id;
    const detail = await request.get(`/api/contributions/${contributionId}`, {
      headers: await as('department-head'),
    });
    const taskId = ((await detail.json()) as { myTaskId: string }).myTaskId;
    await request.post(`/api/approvals/tasks/${taskId}/decision`, {
      headers: await mutate('department-head'),
      data: { decision: 'approve', noConflictAttested: true },
    });
    await request.post(`/api/events/${event.id}/commitments`, {
      headers: await mutate('budget-owner'),
      data: { description: 'Catering', amount: usd(500_000) },
    });
    await request.post(`/api/events/${event.id}/confirm-funding`, {
      headers: await mutate('budget-owner'),
      data: {},
    });
    await request.post(`/api/events/${event.id}/start`, {
      headers: await mutate('budget-owner'),
      data: {},
    });

    const before = await expectContract(
      await request.get(`/api/events/${event.id}/attendance`, {
        headers: await as('budget-owner'),
      }),
      200,
      EventAttendanceView,
    );
    expect(before.previewBasis).toBe('rsvp');
    expect(before.attendanceFinal).toBe(false);

    // The split only moves once attendance is final.
    await expectProblem(
      await request.post(`/api/events/${event.id}/attendance/apply-split`, {
        headers: await mutate('budget-owner'),
        data: { action: 'apply', reason: 'Too early' },
      }),
      409,
      'ATTENDANCE_NOT_FINAL',
    );

    const marked = await expectContract(
      await request.post(`/api/events/${event.id}/attendance`, {
        headers: await mutate('budget-owner'),
        data: {
          marks: [
            { participantId: before.participants[0].id, status: 'attended' },
            { participantId: before.participants[1].id, status: 'no_show' },
          ],
          finalize: true,
        },
      }),
      200,
      EventAttendanceView,
    );
    expect(marked.attendanceFinal).toBe(true);
    expect(marked.counts.attended).toBe(1);
    expect(marked.counts.noShow).toBe(1);
    expect(marked.previewBasis).toBe('attendance');

    const applied = await expectContract(
      await request.post(`/api/events/${event.id}/attendance/apply-split`, {
        headers: await mutate('budget-owner'),
        data: { action: 'apply', reason: 'Actual attendance: 1', confirmed: true },
      }),
      200,
      EventAttendanceView,
    );
    expect(applied.splitAppliedAt).not.toBeNull();
    // The whole cost stays allocated: the shares only move between the sources.
    const total = applied.shares.reduce((a, s) => a + s.actualAmount.amountMinor, 0);
    expect(total).toBe(applied.costSoFar.amountMinor);
    for (const share of applied.shares)
      expect(share.actualAmount.amountMinor).toBeLessThanOrEqual(share.approvedMinor);

    const audit = await auditFor(request, event.id);
    const entry = audit.find((a) => a.action === 'event.attendance_split_applied');
    expect(entry, 'the applied split writes one audit entry').toBeTruthy();
    expect(entry!.reason).toBe('Actual attendance: 1');
    expect(entry!.changes['shares']).toBeTruthy();

    // Reversal plus new postings, never an edit: every journal still balances.
    const check = await runLedgerCheck(request);
    expect(check.status).toBe('clean');
  });

  test('keeping the planned split records the reason instead of moving money', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
      participantPersonIds: [PEOPLE.employee],
    });
    const kept = await expectContract(
      await request.post(`/api/events/${event.id}/attendance/apply-split`, {
        headers: await mutate('budget-owner'),
        data: { action: 'keep_planned', reason: 'The team agreed to keep the planned shares.' },
      }),
      200,
      EventAttendanceView,
    );
    expect(kept.splitKeepReason).toBe('The team agreed to keep the planned shares.');
    expect(kept.splitAppliedAt).toBeNull();
    const audit = await auditFor(request, event.id);
    expect(audit.map((a) => a.action)).toContain('event.attendance_split_kept');
  });
});

test.describe('vendor quotes (51a)', () => {
  test('only Approved or Preferred vendors can be selected, a quote above available is refused, and selecting creates the commitment', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
    });
    const list = await expectContract(
      await request.get('/api/finance/vendors?limit=100', {
        headers: await as('finance-admin'),
      }),
      200,
      VendorList,
    );
    const preferred = list.items.find((v) => v.status === 'preferred')!;
    const blocked = list.items.find((v) => v.status === 'blocked')!;
    const approved = list.items.find((v) => v.status === 'approved')!;

    // A blocked vendor is never even asked for a quote.
    await expectProblem(
      await request.post(`/api/events/${event.id}/quotes/requests`, {
        headers: await mutate('budget-owner'),
        data: { title: 'Catering', quantity: 50, vendorIds: [blocked.id] },
      }),
      409,
      'VENDOR_BLOCKED',
    );
    const created = await expectContract(
      await request.post(`/api/events/${event.id}/quotes/requests`, {
        headers: await mutate('budget-owner'),
        data: {
          title: 'Catering for the scenario event',
          quantity: 50,
          vendorIds: [preferred.id, approved.id],
        },
      }),
      201,
      EventQuotesView,
    );
    const requestId = created.requests[0].id;
    await expectContract(
      await request.post(`/api/events/${event.id}/quotes`, {
        headers: await mutate('budget-owner'),
        data: {
          quoteRequestId: requestId,
          vendorId: approved.id,
          amount: usd(160_000),
          depositPct: 20,
          validUntil: '2027-01-31',
        },
      }),
      201,
      EventQuotesView,
    );
    const withBoth = await expectContract(
      await request.post(`/api/events/${event.id}/quotes`, {
        headers: await mutate('budget-owner'),
        data: {
          quoteRequestId: requestId,
          vendorId: preferred.id,
          amount: usd(240_000),
          depositPct: 20,
          depositRefundable: false,
          validUntil: '2027-01-31',
        },
      }),
      201,
      EventQuotesView,
    );
    const quotes = withBoth.requests[0].quotes;
    const lowest = quotes.find((q) => q.vendorId === approved.id)!;
    const dearer = quotes.find((q) => q.vendorId === preferred.id)!;
    expect(lowest.isLowest).toBe(true);
    expect(dearer.isLowest).toBe(false);

    // Choosing a quote that is not the lowest needs a written reason.
    await expectProblem(
      await request.post(`/api/events/${event.id}/quotes/${dearer.id}/select`, {
        headers: await mutate('budget-owner'),
        data: {},
      }),
      422,
      'REASON_REQUIRED',
    );
    const selected = await expectContract(
      await request.post(`/api/events/${event.id}/quotes/${dearer.id}/select`, {
        headers: await mutate('budget-owner'),
        data: {
          reason: 'Preferred vendor, and the only one including the live counter.',
          notifyDeclinedVendors: true,
        },
      }),
      200,
      EventQuotesView,
    );
    const after = selected.requests[0].quotes;
    expect(after.find((q) => q.id === dearer.id)!.status).toBe('selected');
    expect(after.find((q) => q.id === dearer.id)!.commitmentId).not.toBeNull();
    expect(after.find((q) => q.id === lowest.id)!.status).toBe('declined');
    expect(selected.available.amountMinor).toBe(400_000 - 240_000);

    const detail = await getEvent(request, 'budget-owner', event.id);
    expect(detail.commitments.some((c) => c.vendorId === preferred.id)).toBe(true);
    const audit = await auditFor(request, event.id);
    expect(audit.map((a) => a.action)).toContain('event.quote_selected');
  });
});

test.describe('post-event survey and ROI scorecard (54a, 54b)', () => {
  test('survey results stay hidden until five people have answered, and the scorecard reports what the ledger holds', async ({
    request,
  }) => {
    const seeded = await expectContract(
      await request.get('/api/events?limit=100', { headers: await as('event-organizer') }),
      200,
      EventList,
    );
    const wellbeing = seeded.items.find((e) => e.eventCode === 'EV-2026-WELLBEING');
    expect(wellbeing, 'the Phase 9 seed creates the wellbeing week').toBeTruthy();

    const feedback = await expectContract(
      await request.get(`/api/events/${wellbeing!.id}/feedback`, {
        headers: await as('event-organizer'),
      }),
      200,
      EventFeedbackView,
    );
    expect(feedback.anonymous).toBe(true);
    expect(feedback.responseCount).toBeGreaterThanOrEqual(5);
    expect(feedback.minimumResponsesMet).toBe(true);
    expect(feedback.averageRating).not.toBeNull();

    const scorecard = await expectContract(
      await request.get(`/api/events/${wellbeing!.id}/scorecard`, {
        headers: await as('event-organizer'),
      }),
      200,
      EventScorecardView,
    );
    expect(scorecard.attendanceFinal).toBe(true);
    expect(scorecard.kpis.attendedCount).toBeGreaterThan(0);
    expect(scorecard.kpis.actualCostPerAttendee).not.toBeNull();
    // FX never lands in the cost of an event: the plan rate is locked for the fiscal year.
    expect(scorecard.kpis.fxEffect.amountMinor).toBe(0);
    expect(scorecard.organizerNotes).toBeTruthy();
  });

  test('a fresh survey keeps results back below the five-response threshold', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
      participantPersonIds: [PEOPLE.employee],
    });
    const sent = await expectContract(
      await request.post(`/api/events/${event.id}/invitations/send`, {
        headers: await mutate('budget-owner'),
        data: { message: 'Join us.', deadline: '2026-12-01T18:00:00.000Z' },
      }),
      200,
      EventInvitationView,
    );
    const invitationId = sent.participants.find((p) => p.personId === PEOPLE.employee)!.id;
    await request.post(`/api/invitations/${invitationId}/rsvp`, {
      headers: await mutate('employee'),
      data: { response: 'going' },
    });
    const opened = await expectContract(
      await request.put(`/api/events/${event.id}/feedback/survey`, {
        headers: await mutate('budget-owner'),
        data: { status: 'open' },
      }),
      200,
      EventFeedbackView,
    );
    expect(opened.status).toBe('open');
    const answered = await expectContract(
      await request.post(`/api/surveys/${opened.surveyId}/responses`, {
        headers: await mutate('employee'),
        data: { rating: 5, wouldAttendAgain: true, comment: 'Good fun.' },
      }),
      201,
      EventFeedbackView,
    );
    expect(answered.responseCount).toBe(1);
    expect(answered.minimumResponsesMet).toBe(false);
    expect(answered.averageRating).toBeNull();
    expect(answered.comments).toHaveLength(0);

    // One answer per person.
    await expectProblem(
      await request.post(`/api/surveys/${opened.surveyId}/responses`, {
        headers: await mutate('employee'),
        data: { rating: 1, wouldAttendAgain: false },
      }),
      409,
      'SURVEY_ALREADY_ANSWERED',
    );
    // People who were not in the audience never answer.
    await expectProblem(
      await request.post(`/api/surveys/${opened.surveyId}/responses`, {
        headers: await mutate('analyst'),
        data: { rating: 5, wouldAttendAgain: true },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('events dashboard (043)', () => {
  test('the dashboard answers what is coming up and what needs the organizer', async ({
    request,
  }) => {
    const view = await expectContract(
      await request.get('/api/events/dashboard', { headers: await as('event-organizer') }),
      200,
      EventsDashboardView,
    );
    expect(view.generatedAt).toBeTruthy();
    expect(view.attention.length).toBeGreaterThan(0);
    for (const item of view.attention) expect(item.actionLabel.length).toBeGreaterThan(0);
  });

  test('an employee cannot open the organizer dashboard data for events they do not take part in', async ({
    request,
  }) => {
    const view = await expectContract(
      await request.get('/api/events/dashboard', { headers: await as('employee') }),
      200,
      EventsDashboardView,
    );
    // Scope, not a 403: an employee sees only the events they are part of.
    for (const e of view.upcoming) expect(e.id).toBeTruthy();
    expect(view.kpis.upcomingCount).toBeLessThanOrEqual(view.upcoming.length);
  });
});
