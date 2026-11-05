import { ApprovalsService } from '@bf/api/approvals';
import { ActorResolver, CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db, Tx } from '@bf/api/db';
import {
  EventAttendanceService,
  EventFeedbackService,
  EventInvitationsService,
  EventPlanService,
  EventQuotesService,
  EventScorecardService,
  EventsModule,
  EventsService,
  EventTemplatesService,
} from '@bf/api/events';
import {
  P5_EVENT,
  P9_DIWALI_NEEDS,
  P9_DIWALI_RSVPS,
  P9_IDS,
  P9_QUOTE_REQUEST,
  P9_TEMPLATES,
  P9_WELLBEING_EVENT,
  TENANTS,
  userById,
  type SeedUserId,
} from '@bf/seed';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

@Module({ imports: [CoreModule, EventsModule] })
class EventsDepthSeedModule {}

const T = TENANTS.acme;

/** Matches the anonymous respondent token the feedback service computes, so a replay finds the row. */
const respondentToken = (surveyId: string, personId: string): string =>
  createHash('sha256').update(`${surveyId}:${personId}`, 'utf8').digest('hex').slice(0, 64);

/**
 * Phase 9 demo data (fixed ids and idempotency keys, so a second run replays instead of posting
 * again): five company event templates, the Diwali celebration's plan, invitations, RSVPs, attendee
 * needs and catering quotes, and a wellbeing week carried through attendance, the attendance-based
 * split and a post-event survey with its scorecard notes.
 */
export async function seedEventsDepth(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(EventsDepthSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    const actors = ctx.get(ActorResolver);
    const events = ctx.get(EventsService);
    const approvals = ctx.get(ApprovalsService);
    const plan = ctx.get(EventPlanService);
    const invitations = ctx.get(EventInvitationsService);
    const attendance = ctx.get(EventAttendanceService);
    const quotes = ctx.get(EventQuotesService);
    const feedback = ctx.get(EventFeedbackService);
    const scorecard = ctx.get(EventScorecardService);
    const templates = ctx.get(EventTemplatesService);

    const as = (id: SeedUserId) =>
      actors.resolve(userById(id).subject, T, userById(id).displayName);
    const read = <R>(fn: (tx: Tx) => Promise<R>): Promise<R> =>
      s.withTenant(db, { tenantId: T, subject: 'seed' }, fn);
    const key = (k: string) => ({ idempotencyKey: `seed:p9:${k}`, requestId: 'seed' });

    const organizer = await as('event-organizer');
    const approver = await as('location-manager');
    const employee = await as('employee');

    const home = await read(
      async (tx) =>
        (await tx.select().from(s.budgets).where(eq(s.budgets.id, P5_EVENT.homeBudgetId)))[0],
    );
    const ccy = home.currency === 'INR' ? 'INR' : 'USD';
    const money = (a: { USD: number; INR: number }) => ({
      amountMinor: a[ccy as 'USD' | 'INR'],
      currency: ccy,
    });

    const vendorIdsByName = await read(async (tx) => {
      const rows = await tx.select({ id: s.vendors.id, name: s.vendors.name }).from(s.vendors);
      return new Map(rows.map((v) => [v.name, v.id]));
    });

    // Company templates ---------------------------------------------------------------------------
    await db.transaction(async (tx) => {
      for (const t of P9_TEMPLATES)
        await tx
          .insert(s.eventTemplates)
          .values({
            id: t.id,
            tenantId: T,
            scope: 'company',
            status: 'published',
            ownerPersonId: null,
            name: t.name,
            category: t.category,
            eventType: t.eventType,
            typicalDuration: t.typicalDuration,
            locationType: t.locationType,
            estimatePerAttendeeMinor: t.estimatePerAttendeeMinor,
            currency: 'USD',
            toleranceBps: t.toleranceBps,
            costSplitRule: t.costSplitRule,
            checklistTasks: t.checklistTasks,
            agendaItems: t.agendaItems,
            invitationDefaults: t.invitationDefaults,
            needsConfig: t.needsConfig,
            surveyQuestions: t.surveyQuestions,
            preferredVendorIds: t.preferredVendorNames
              .map((n) => vendorIdsByName.get(n))
              .filter((id): id is string => Boolean(id)),
          })
          .onConflictDoNothing();
    });

    // The Diwali celebration's plan, invitations, RSVPs and needs -----------------------------------
    const diwaliHasPlan = await read(
      async (tx) =>
        (
          await tx
            .select({ id: s.eventChecklists.id })
            .from(s.eventChecklists)
            .where(eq(s.eventChecklists.eventId, P5_EVENT.id))
        ).length > 0,
    );
    if (!diwaliHasPlan)
      await plan.applyTemplate(organizer, P5_EVENT.id, P9_IDS.templates.diwali, key('diwali:plan'));

    const diwaliParticipants = await read((tx) => participantsOf(tx, P5_EVENT.id));
    await invitations.send(
      organizer,
      P5_EVENT.id,
      {
        message:
          'Join us for the Diwali celebration on 20 November: lamp lighting, a rangoli contest, dinner and awards. Please tell us whether you can come by 16 November.',
        deadline: '2026-11-16T18:30:00.000Z',
        capacity: 200,
        waitlistEnabled: true,
        autoPromoteWaitlist: true,
        attachCalendarInvite: true,
        collectTravelNeeds: false,
      },
      key('diwali:invitations'),
    );
    // Seeded directory people have no sign-in, so their answers are written directly; the employee
    // persona answers through the real RSVP command so the journey has one audited response.
    await db.transaction(async (tx) => {
      for (const r of P9_DIWALI_RSVPS) {
        const p = diwaliParticipants[r.index];
        if (!p || p.personId === userById('employee').personId) continue;
        await tx
          .update(s.eventParticipants)
          .set({
            rsvpStatus: r.status,
            rsvpRespondedAt: r.status === 'invited' ? null : new Date('2026-11-08T06:00:00.000Z'),
          })
          .where(eq(s.eventParticipants.id, p.id));
      }
      for (const n of P9_DIWALI_NEEDS) {
        const p = diwaliParticipants[n.index];
        if (!p) continue;
        await tx
          .update(s.eventParticipants)
          .set({
            needs: {
              dietaryPreference: n.dietaryPreference,
              dietaryOther: null,
              allergies: n.allergies,
              allergyOther: null,
              severeAllergy: n.severeAllergy,
              accessibility: n.accessibility,
              accessibilityOther: null,
              needsTravel: false,
              travelFromCity: null,
              travelArrival: null,
              needsHotelNight: false,
              photoConsent: n.index !== 1,
              reuseForFutureEvents: false,
            },
            needsSubmittedAt: new Date('2026-11-09T06:00:00.000Z'),
          })
          .where(eq(s.eventParticipants.id, p.id));
      }
    });
    const employeeInvitation = diwaliParticipants.find(
      (p) => p.personId === userById('employee').personId,
    );
    if (employeeInvitation && employeeInvitation.rsvpStatus === 'invited')
      await invitations.respond(
        employee,
        employeeInvitation.id,
        { response: 'going' },
        key('diwali:rsvp:employee'),
      );

    // Catering quotes on the Diwali celebration -----------------------------------------------------
    const hasQuoteRequest = await read(
      async (tx) =>
        (
          await tx
            .select({ id: s.eventQuoteRequests.id })
            .from(s.eventQuoteRequests)
            .where(eq(s.eventQuoteRequests.eventId, P5_EVENT.id))
        ).length > 0,
    );
    if (hasQuoteRequest === false) {
      const q = P9_QUOTE_REQUEST;
      await quotes.createRequest(
        organizer,
        P5_EVENT.id,
        {
          title: q.title,
          category: q.category,
          description: q.description,
          quantity: q.quantity,
          neededBy: q.neededBy,
          respondBy: q.respondBy,
          includeDietaryCounts: true,
          emailed: true,
          vendorIds: q.vendorNames
            .map((n) => vendorIdsByName.get(n))
            .filter((id): id is string => Boolean(id)),
        },
        key('diwali:quote-request'),
      );
      const requestId = await read(
        async (tx) =>
          (
            await tx
              .select({ id: s.eventQuoteRequests.id })
              .from(s.eventQuoteRequests)
              .where(eq(s.eventQuoteRequests.eventId, P5_EVENT.id))
          )[0].id,
      );
      for (const quote of q.quotes) {
        const vendorId = vendorIdsByName.get(quote.vendorName);
        if (!vendorId) continue;
        await quotes.recordQuote(
          organizer,
          P5_EVENT.id,
          {
            quoteRequestId: requestId,
            vendorId,
            amount: money(quote.amount),
            depositPct: quote.depositPct,
            depositRefundable: quote.depositRefundable,
            depositTerms: quote.depositTerms,
            cancellationTerms: quote.cancellationTerms,
            validUntil: quote.validUntil,
            includesText: quote.includesText,
          },
          key(`diwali:quote:${quote.vendorName}`),
        );
      }
    }

    // A wellbeing week carried through attendance, the split and its survey --------------------------
    const w = P9_WELLBEING_EVENT;
    const existing = await read(
      async (tx) => (await tx.select().from(s.events).where(eq(s.events.id, w.id)))[0],
    );
    if (!existing) {
      await events.create(
        organizer,
        {
          name: w.name,
          eventType: w.eventType,
          homeBudgetId: w.homeBudgetId,
          eventCode: w.eventCode,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          venue: w.venue,
          description: w.description,
          expectedAttendance: w.expectedAttendance,
          toleranceBps: w.toleranceBps,
          ownFunds: money(w.ownFunds),
          perHeadLimit: money(w.perHeadLimit),
          locationOrgUnitIds: w.locations,
          participantPersonIds: P5_EVENT.participants,
          templateId: P9_IDS.templates.wellbeing,
          costLines: w.costLines.map((l) => ({
            category: l.category,
            description: l.description,
            quantity: l.quantity,
            unitCost: money(l.unit),
          })),
        },
        { ...key('wellbeing:create'), fixedId: w.id },
      );
      await events.submit(organizer, w.id, key('wellbeing:submit'));
      const ownFunds = await read(
        async (tx) =>
          (
            await tx
              .select({ id: s.requests.id })
              .from(s.requests)
              .where(and(eq(s.requests.eventId, w.id), eq(s.requests.kind, 'budget')))
          )[0],
      );
      if (ownFunds) {
        const taskId = await s.withTenant(db, { tenantId: T, subject: approver.subject }, (tx) =>
          approvals.myTask(tx, approver, 'request', ownFunds.id),
        );
        if (taskId)
          await approvals.decide(
            approver,
            taskId,
            { decision: 'approve', noConflictAttested: true },
            key('wellbeing:own-funds:approve'),
          );
      }
      // Approving the own funds already covers the estimate, so the event may be Funded by now.
      const statusOf = async () =>
        (
          await read(
            async (tx) => (await tx.select().from(s.events).where(eq(s.events.id, w.id)))[0],
          )
        ).status;
      if ((await statusOf()) === 'approved')
        await events.confirmFunding(organizer, w.id, undefined, key('wellbeing:confirm'));
      await events.commit(
        organizer,
        w.id,
        {
          description: w.commitment.description,
          vendorId: vendorIdsByName.get(w.commitment.vendorName),
          amount: money(w.commitment.amount),
        },
        key('wellbeing:commit'),
      );
      if ((await statusOf()) === 'funded')
        await events.start(organizer, w.id, undefined, key('wellbeing:start'));

      const wellbeingParticipants = await read((tx) => participantsOf(tx, w.id));
      await attendance.mark(
        organizer,
        w.id,
        {
          marks: [
            ...w.attended.map((i) => ({
              participantId: wellbeingParticipants[i].id,
              status: 'attended' as const,
            })),
            ...w.noShow.map((i) => ({
              participantId: wellbeingParticipants[i].id,
              status: 'no_show' as const,
            })),
          ],
          finalize: true,
        },
        key('wellbeing:attendance'),
      );
      await attendance.apply(
        organizer,
        w.id,
        {
          action: 'apply',
          reason: `Actual attendance: ${w.attended.length}`,
          confirmed: true,
        },
        key('wellbeing:apply-split'),
      );
      if ((await statusOf()) === 'in_progress')
        await events.complete(organizer, w.id, undefined, key('wellbeing:complete'));
      await feedback.updateSurvey(
        organizer,
        w.id,
        { status: 'open' },
        key('wellbeing:survey:open'),
      );
      const survey = await read(
        async (tx) =>
          (await tx.select().from(s.eventSurveys).where(eq(s.eventSurveys.eventId, w.id)))[0],
      );
      const locationNames = await read(async (tx) => {
        const rows = await tx.select({ id: s.orgUnits.id, name: s.orgUnits.name }).from(s.orgUnits);
        return new Map(rows.map((r) => [r.id, r.name]));
      });
      // Anonymous answers never carry a person, so they are written with the same one-way token the
      // API uses; a replay finds the row and inserts nothing.
      await db.transaction(async (tx) => {
        for (const r of w.survey.responses) {
          const p = wellbeingParticipants[r.index];
          if (!p?.personId) continue;
          await tx
            .insert(s.eventSurveyResponses)
            .values({
              tenantId: T,
              surveyId: survey.id,
              eventId: w.id,
              respondentTokenHash: respondentToken(survey.id, p.personId),
              locationOrgUnitId: p.locationOrgUnitId,
              locationName: p.locationOrgUnitId
                ? (locationNames.get(p.locationOrgUnitId) ?? null)
                : null,
              rating: r.rating,
              wouldAttendAgain: r.wouldAttendAgain,
              comment: r.comment,
              answers: {},
            })
            .onConflictDoNothing();
        }
      });
      await scorecard.updateNotes(organizer, w.id, { notes: w.notes }, key('wellbeing:notes'));
    }

    // One personal template, so the library shows both scopes side by side.
    const personalTemplates = await read(
      async (tx) =>
        (
          await tx
            .select({ id: s.eventTemplates.id })
            .from(s.eventTemplates)
            .where(eq(s.eventTemplates.scope, 'personal'))
        ).length,
    );
    if (personalTemplates === 0)
      await templates.create(
        organizer,
        {
          scope: 'personal',
          status: 'published',
          name: 'Squad celebration (my version)',
          category: 'team_events',
          eventType: 'celebration',
          typicalDuration: 'One evening',
          locationType: 'office',
          estimatePerAttendee: { amountMinor: 3_200, currency: 'USD' },
          useLocationLimit: true,
          toleranceBps: 500,
          costSplitRule: 'location',
          checklistTasks: [
            {
              section: 'before',
              title: 'Ask the squad for a date',
              relativeDueDays: -14,
              ownerRole: 'organizer',
              isSystem: false,
            },
            {
              section: 'before',
              title: 'Book the cafeteria corner',
              relativeDueDays: -7,
              ownerRole: 'organizer',
              isSystem: false,
            },
          ],
          agendaItems: [
            {
              startTime: '17:30',
              endTime: '19:30',
              title: 'Squad celebration',
              locationRoom: 'Cafeteria',
              visibleToInvitees: true,
            },
          ],
          surveyQuestions: [
            {
              id: 'rating',
              type: 'rating',
              prompt: 'How would you rate the evening?',
              required: true,
            },
          ],
        },
        key('template:personal'),
      );
  } finally {
    await ctx.close();
  }
}

function participantsOf(tx: Tx, eventId: string) {
  return tx
    .select()
    .from(s.eventParticipants)
    .where(eq(s.eventParticipants.eventId, eventId))
    .orderBy(asc(s.eventParticipants.createdAt));
}
