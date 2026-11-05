import { ApiProblem, type CommandResult, type RequestActor } from '@bf/api/core';
import {
  budgets,
  commitments,
  contributionRequests,
  eventCostLines,
  eventInvitations,
  eventQuoteRequests,
  eventQuotes,
  events,
  type Tx,
} from '@bf/api/db';
import { FundingSourcesService, type SourceRow } from '@bf/api/spend';
import type {
  EventScorecardView,
  EventsDashboardView,
  UpdateScorecardNotesBody,
} from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Ctx, EventRow } from '../events.service';
import { EventAttendanceService } from './attendance.service';
import { EventDepthSupport } from './event-depth.support';
import { EventPlanService } from './event-plan.service';
import { EventFeedbackService } from './feedback.service';

const ATTENDED = ['attended', 'walk_in'];
const UPCOMING = ['approved', 'funded', 'in_progress', 'draft', 'submitted'];
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/**
 * The event ROI scorecard (54b) and the events dashboard (043). Both read what the ledger, the
 * attendance and the survey already hold; nothing is recomputed in the browser and no figure here
 * moves money. Figures stay provisional until the event closes.
 */
@Injectable()
export class EventScorecardService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly sources: FundingSourcesService,
    private readonly attendance: EventAttendanceService,
    private readonly feedback: EventFeedbackService,
    private readonly plan: EventPlanService,
  ) {}

  /**
   * Actual cost by category: a commitment that came from a vendor quote carries that request's
   * category; anything else lands in "other". Planned cost comes from the event's cost lines.
   */
  private async costByCategory(tx: Tx, e: EventRow): Promise<EventScorecardView['costByCategory']> {
    const planned = await tx
      .select()
      .from(eventCostLines)
      .where(eq(eventCostLines.eventId, e.id))
      .orderBy(asc(eventCostLines.lineNo));
    const spent = await tx
      .select({
        commitmentId: commitments.id,
        consumedMinor: commitments.consumedMinor,
        amountMinor: commitments.amountMinor,
        releasedMinor: commitments.releasedMinor,
      })
      .from(commitments)
      .where(and(eq(commitments.eventId, e.id), ne(commitments.status, 'cancelled')));
    const categories = spent.length
      ? await tx
          .select({ commitmentId: eventQuotes.commitmentId, category: eventQuoteRequests.category })
          .from(eventQuotes)
          .innerJoin(eventQuoteRequests, eq(eventQuoteRequests.id, eventQuotes.quoteRequestId))
          .where(eq(eventQuotes.eventId, e.id))
      : [];
    const byCategory = new Map<string, { planned: number; actual: number }>();
    for (const l of planned) {
      const row = byCategory.get(l.category) ?? { planned: 0, actual: 0 };
      row.planned += l.amountMinor;
      byCategory.set(l.category, row);
    }
    for (const c of spent) {
      const category =
        categories.find((x) => x.commitmentId === c.commitmentId)?.category ?? 'other';
      const row = byCategory.get(category) ?? { planned: 0, actual: 0 };
      // What a commitment really cost the event: consumed by matched actuals, else still encumbered.
      row.actual += c.consumedMinor > 0 ? c.consumedMinor : c.amountMinor - c.releasedMinor;
      byCategory.set(category, row);
    }
    return [...byCategory.entries()]
      .map(([category, v]) => ({
        category,
        planned: { amountMinor: v.planned, currency: e.currency },
        actual: { amountMinor: v.actual, currency: e.currency },
      }))
      .sort((a, b) => b.planned.amountMinor - a.planned.amountMinor);
  }

  private async fundingAndReturns(
    tx: Tx,
    e: EventRow,
    srcs: SourceRow[],
  ): Promise<EventScorecardView['fundingAndReturns']> {
    if (!srcs.length) return [];
    const budgetRows = await tx
      .select({ id: budgets.id, name: budgets.name, legalEntityId: budgets.legalEntityId })
      .from(budgets)
      .where(inArray(budgets.id, [...new Set(srcs.map((s) => s.originBudgetId))]));
    const contributions = await tx
      .select({
        id: contributionRequests.id,
        ref: contributionRequests.ref,
        mode: contributionRequests.mode,
      })
      .from(contributionRequests)
      .where(eq(contributionRequests.eventId, e.id));
    return srcs.map((s) => {
      const budget = budgetRows.find((b) => b.id === s.originBudgetId);
      const contribution = contributions.find((c) => c.id === s.contributionRequestId);
      return {
        sourceId: s.id,
        budgetName: budget?.name ?? '',
        contributionRef: contribution?.ref ?? null,
        mode: s.mode,
        crossEntity: Boolean(budget && budget.legalEntityId !== e.legalEntityId),
        approved: { amountMinor: s.fundedMinor, currency: s.currency },
        actualShare: { amountMinor: s.consumedMinor, currency: s.currency },
        surplusReturned: { amountMinor: s.returnedMinor, currency: s.currency },
      };
    });
  }

  async scorecard(
    actor: RequestActor,
    eventId: string,
    compareEventId?: string,
  ): Promise<EventScorecardView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      const canManage = await this.support.canManage(tx, actor, e);
      const srcs = await this.sources.list(tx, e.id);
      const parts = await this.support.participants(tx, e.id);
      const attendance = await this.attendance.view(tx, actor, e);
      const survey = (await this.feedback.resultsFor(tx, [e.id])).get(e.id)!;
      const fundedMinor = srcs.reduce((a, s) => a + s.fundedMinor, 0);
      const spentMinor = srcs.reduce((a, s) => a + s.consumedMinor, 0);
      const surplusMinor = srcs.reduce((a, s) => a + s.returnedMinor, 0);
      const invited = parts.length;
      const going = parts.filter((p) => p.rsvpStatus === 'going').length;
      const attended = parts.filter((p) => ATTENDED.includes(p.attendanceStatus)).length;
      const noShow = parts.filter((p) => p.attendanceStatus === 'no_show').length;
      const plannedHeads = e.expectedAttendance ?? invited;
      const plannedPerAttendee = plannedHeads > 0 ? Math.round(fundedMinor / plannedHeads) : 0;
      const actualPerAttendee = attended > 0 ? Math.round(spentMinor / attended) : null;
      const unmatched = await tx
        .select({ id: commitments.id })
        .from(commitments)
        .where(and(eq(commitments.eventId, e.id), inArray(commitments.status, ['encumbered'])));
      const provisional = e.status !== 'closed';
      const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
      const locations = await this.support.orgUnitNames(
        tx,
        parts.map((p) => p.locationOrgUnitId),
      );
      const participationByLocation = [...new Set(parts.map((p) => p.locationOrgUnitId))].map(
        (id) => {
          const inUnit = parts.filter((p) => p.locationOrgUnitId === id);
          const came = inUnit.filter((p) => ATTENDED.includes(p.attendanceStatus)).length;
          return {
            locationName: id ? (locations.get(id) ?? 'No location') : 'No location',
            invited: inUnit.length,
            attended: came,
            ratePct: pct(came, inUnit.length),
          };
        },
      );
      return {
        eventId: e.id,
        eventName: e.name,
        eventCode: e.eventCode,
        status: e.status,
        startsAt: e.startsAt?.toISOString() ?? null,
        endsAt: e.endsAt?.toISOString() ?? null,
        closedAt: e.closedAt?.toISOString() ?? null,
        provisional,
        provisionalReason: provisional
          ? unmatched.length
            ? `Provisional until the event closes: ${unmatched.length} commitments are still open.`
            : 'Provisional until the event closes.'
          : null,
        attendanceFinal: e.attendanceFinal,
        canManage,
        kpis: {
          plannedCostPerAttendee: m(plannedPerAttendee),
          actualCostPerAttendee: actualPerAttendee === null ? null : m(actualPerAttendee),
          costPerAttendeeDeltaBps:
            actualPerAttendee !== null && plannedPerAttendee > 0
              ? Math.round(((actualPerAttendee - plannedPerAttendee) * 10_000) / plannedPerAttendee)
              : null,
          fundedTotal: m(fundedMinor),
          spentTotal: m(spentMinor),
          surplusTotal: m(surplusMinor),
          invitedCount: invited,
          goingCount: going,
          attendedCount: attended,
          participationPct: pct(attended, invited),
          noShowCount: noShow,
          noShowRatePct: pct(noShow, going),
          noShowCost: attendance.noShowCost,
          averageRating: survey.averageRating,
          responseCount: survey.responseCount,
          wouldAttendAgainPct: survey.wouldAttendAgainPct,
          // Budget consumption uses the fiscal year's locked plan rate, so FX never lands in cost.
          fxEffect: m(0),
        },
        costByCategory: await this.costByCategory(tx, e),
        fundingAndReturns: await this.fundingAndReturns(tx, e, srcs),
        participationByLocation,
        comparison: await this.comparison(tx, actor, e, compareEventId),
        organizerNotes: e.organizerNotes,
      };
    });
  }

  /** The average of closed events from the same template, or one event the viewer picked. */
  private async comparison(
    tx: Tx,
    actor: RequestActor,
    e: EventRow,
    compareEventId?: string,
  ): Promise<EventScorecardView['comparison']> {
    const empty = {
      label: 'No comparable events yet',
      eventCount: 0,
      enoughEvents: false,
      costPerAttendee: null,
      participationPct: null,
      noShowRatePct: null,
      averageRating: null,
    };
    const peers = compareEventId
      ? await tx.select().from(events).where(eq(events.id, compareEventId))
      : e.templateId
        ? await tx
            .select()
            .from(events)
            .where(
              and(
                eq(events.templateId, e.templateId),
                eq(events.status, 'closed'),
                ne(events.id, e.id),
              ),
            )
            .orderBy(desc(events.closedAt))
            .limit(12)
        : [];
    const visible: EventRow[] = [];
    for (const p of peers) if (await this.support.events.canRead(tx, actor, p)) visible.push(p);
    const minimum = compareEventId ? 1 : 3;
    if (visible.length < minimum)
      return {
        ...empty,
        label: compareEventId
          ? 'That event is not comparable'
          : 'Comparison needs at least 3 similar events',
        eventCount: visible.length,
      };
    let cost = 0;
    let participation = 0;
    let noShowRate = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    const surveys = await this.feedback.resultsFor(
      tx,
      visible.map((p) => p.id),
    );
    for (const p of visible) {
      const srcs = await this.sources.list(tx, p.id);
      const parts = await this.support.participants(tx, p.id);
      const attended = parts.filter((x) => ATTENDED.includes(x.attendanceStatus)).length;
      const going = parts.filter((x) => x.rsvpStatus === 'going').length;
      const spent = srcs.reduce((a, s) => a + s.consumedMinor, 0);
      cost += attended > 0 ? Math.round(spent / attended) : 0;
      participation += pct(attended, parts.length);
      noShowRate += pct(parts.filter((x) => x.attendanceStatus === 'no_show').length, going);
      const rating = surveys.get(p.id)?.averageRating;
      if (rating !== null && rating !== undefined) {
        ratingSum += rating;
        ratingCount += 1;
      }
    }
    const n = visible.length;
    return {
      label: compareEventId
        ? `Compared with ${visible[0].name}`
        : `Average of ${n} closed events from the same template`,
      eventCount: n,
      enoughEvents: true,
      costPerAttendee: { amountMinor: Math.round(cost / n), currency: e.currency },
      participationPct: Math.round(participation / n),
      noShowRatePct: Math.round(noShowRate / n),
      averageRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    };
  }

  updateNotes(
    actor: RequestActor,
    eventId: string,
    body: UpdateScorecardNotesBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventScorecardView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.scorecard.notes:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        if (e.status !== 'completed' && e.status !== 'reconciling' && e.status !== 'closed')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'The scorecard opens once the event is completed.',
          );
        await tx
          .update(events)
          .set({ organizerNotes: body.notes, updatedAt: new Date() })
          .where(eq(events.id, e.id));
        await this.support.log(tx, actor, e, 'event.scorecard_notes_updated', ctx, {
          organizerNotes: { from: e.organizerNotes, to: body.notes },
        });
        return this.scorecard(actor, eventId);
      },
    );
  }

  // Events dashboard (043) ------------------------------------------------------------------------

  dashboard(
    actor: RequestActor,
    query: { onlyMine?: 'true' | 'false'; locationId?: string },
  ): Promise<EventsDashboardView> {
    return this.support.read(actor, async (tx) => {
      const rows = (await this.support.events.visibleRows(tx, actor, [], 200)).filter((e) =>
        query.onlyMine === 'true' ? e.organizerPersonId === actor.personId : true,
      );
      const summaries = await this.support.events.summariesOf(tx, rows);
      const now = Date.now();
      const horizon = now + 30 * 86_400_000;
      const upcomingRows = rows.filter(
        (e) =>
          UPCOMING.includes(e.status) &&
          e.startsAt !== null &&
          e.startsAt.getTime() >= now &&
          e.startsAt.getTime() <= horizon,
      );
      const closedRows = rows
        .filter((e) => e.status === 'closed')
        .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
        .slice(0, 5);
      const nextTasks = await this.plan.nextOpenTask(
        tx,
        upcomingRows.map((e) => e.id),
      );
      const invitations = upcomingRows.length
        ? await tx
            .select()
            .from(eventInvitations)
            .where(
              inArray(
                eventInvitations.eventId,
                upcomingRows.map((e) => e.id),
              ),
            )
        : [];
      const currency = rows[0]?.currency ?? actor.reportingCurrency;
      const m = (amountMinor: number) => ({ amountMinor, currency });
      let upcomingFunded = 0;
      let upcomingCaps = 0;
      const upcoming: EventsDashboardView['upcoming'] = [];
      const attention: EventsDashboardView['attention'] = [];
      for (const e of upcomingRows) {
        const summary = summaries.find((s) => s.id === e.id)!;
        const parts = await this.support.participants(tx, e.id);
        const invitation = invitations.find((i) => i.eventId === e.id);
        const going = parts.filter((p) => p.rsvpStatus === 'going').length;
        upcomingFunded += summary.funded.amountMinor;
        upcomingCaps += summary.cap.amountMinor;
        const task = nextTasks.get(e.id);
        upcoming.push({
          ...summary,
          goingCount: going,
          capacityCount: invitation?.capacity ?? parts.length,
          nextTaskTitle: task?.title ?? null,
          nextTaskOverdue: task?.overdue ?? false,
        });
        if (!summary.fullyFunded)
          attention.push({
            id: `funding:${e.id}`,
            eventId: e.id,
            eventName: e.name,
            tone: 'warning',
            text: `${e.name} is ${pct(summary.funded.amountMinor, summary.cap.amountMinor || summary.estimate.amountMinor)}% funded.`,
            actionLabel: 'Request contribution',
            actionPath: `/events/${e.id}`,
          });
        if (invitation?.status === 'open' && invitation.deadline) {
          const responded = parts.filter((p) => p.rsvpStatus !== 'invited').length;
          if (responded < parts.length)
            attention.push({
              id: `rsvp:${e.id}`,
              eventId: e.id,
              eventName: e.name,
              tone: 'info',
              text: `RSVPs for ${e.name}: ${responded} of ${parts.length} responded.`,
              actionLabel: 'Send reminder',
              actionPath: `/events/${e.id}/people/invitations`,
            });
        }
        if (task?.overdue)
          attention.push({
            id: `task:${e.id}`,
            eventId: e.id,
            eventName: e.name,
            tone: 'warning',
            text: `${task.title} is overdue for ${e.name}.`,
            actionLabel: 'Open checklist',
            actionPath: `/events/${e.id}/plan`,
          });
        const waiting = await tx
          .select({ id: eventQuotes.id })
          .from(eventQuotes)
          .where(and(eq(eventQuotes.eventId, e.id), eq(eventQuotes.status, 'received')));
        if (waiting.length)
          attention.push({
            id: `quotes:${e.id}`,
            eventId: e.id,
            eventName: e.name,
            tone: 'info',
            text: `${waiting.length} quotes are waiting for a decision on ${e.name}.`,
            actionLabel: 'Compare quotes',
            actionPath: `/events/${e.id}/quotes`,
          });
      }
      const surveys = await this.feedback.resultsFor(
        tx,
        closedRows.map((e) => e.id),
      );
      for (const e of closedRows) {
        const result = surveys.get(e.id);
        if (result && result.responseCount >= 5)
          attention.push({
            id: `survey:${e.id}`,
            eventId: e.id,
            eventName: e.name,
            tone: 'info',
            text: `Survey results are ready for ${e.name}: ${result.averageRating} of 5 from ${result.responseCount} responses.`,
            actionLabel: 'Open scorecard',
            actionPath: `/events/${e.id}/scorecard`,
          });
      }
      let closedPlanned = 0;
      let closedActual = 0;
      let closedInvited = 0;
      let closedAttended = 0;
      const recentlyClosed: EventsDashboardView['recentlyClosed'] = [];
      for (const e of closedRows) {
        const srcs = await this.sources.list(tx, e.id);
        const parts = await this.support.participants(tx, e.id);
        const attended = parts.filter((p) => ATTENDED.includes(p.attendanceStatus)).length;
        const spent = srcs.reduce((a, s) => a + s.consumedMinor, 0);
        const funded = srcs.reduce((a, s) => a + s.fundedMinor, 0);
        const perAttendee = attended > 0 ? Math.round(spent / attended) : 0;
        closedPlanned += Math.round(funded / Math.max(e.expectedAttendance ?? parts.length, 1));
        closedActual += perAttendee;
        closedInvited += parts.length;
        closedAttended += attended;
        const result = surveys.get(e.id);
        recentlyClosed.push({
          id: e.id,
          name: e.name,
          eventCode: e.eventCode,
          closedAt: e.closedAt?.toISOString() ?? null,
          costPerAttendee: { amountMinor: perAttendee, currency: e.currency },
          averageRating: result?.averageRating ?? null,
          responseCount: result?.responseCount ?? 0,
        });
      }
      if (!attention.length)
        attention.push({
          id: 'none',
          eventId: rows[0]?.id ?? '',
          eventName: '',
          tone: 'info',
          text: 'Nothing needs you right now.',
          actionLabel: 'See all events',
          actionPath: '/events/all',
        });
      const closedCount = Math.max(closedRows.length, 1);
      return {
        generatedAt: new Date().toISOString(),
        kpis: {
          upcomingCount: upcomingRows.length,
          upcomingFunded: m(upcomingFunded),
          upcomingCaps: m(upcomingCaps),
          upcomingGap: m(Math.max(0, upcomingCaps - upcomingFunded)),
          closedPlannedPerAttendee: m(Math.round(closedPlanned / closedCount)),
          closedActualPerAttendee: m(Math.round(closedActual / closedCount)),
          closedParticipationPct: pct(closedAttended, closedInvited),
          waitingForReconciliationCount: rows.filter((e) =>
            ['completed', 'reconciling'].includes(e.status),
          ).length,
        },
        attention: attention.slice(0, 8),
        upcoming: upcoming.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
        recentlyClosed,
      };
    });
  }
}
