import { ApiProblem, type CommandResult, type RequestActor } from '@bf/api/core';
import {
  budgets,
  commitments,
  contributionRequests,
  eventParticipants,
  events,
  legalEntities,
  people,
  type Tx,
} from '@bf/api/db';
import {
  CommitmentsService,
  FundingSourcesService,
  PostingSupport,
  type SourceRow,
} from '@bf/api/spend';
import type {
  ApplyAttendanceSplitBody,
  EventAttendanceView,
  MarkAttendanceBody,
} from '@bf/contracts';
import { recalculateAttendanceSplit, type AttendanceSourceInput } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Ctx, EventRow } from '../events.service';
import { EventDepthSupport, LOCKED_STATUSES, type ParticipantRow } from './event-depth.support';
import { EventPlanService } from './event-plan.service';

const ATTENDED = ['attended', 'walk_in'];

/**
 * Attendance and the per-head recalculation (47e). RSVPs give a preview; once attendance is final the
 * organizer applies the attendance-based split, which re-posts every open commitment's funding lines
 * as releases and new encumbrances. A contributor's share may only grow up to what its owner
 * approved: beyond that the API answers `SHARE_EXCEEDS_CONTRIBUTION`.
 */
@Injectable()
export class EventAttendanceService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly sources: FundingSourcesService,
    private readonly commitments: CommitmentsService,
    private readonly posting: PostingSupport,
    private readonly plan: EventPlanService,
  ) {}

  /**
   * Headcount per funding source: a source carries the people of the location its budget funds, so
   * own funds carry the home locations and each contribution the location it was asked for.
   */
  private async sourceInputs(
    tx: Tx,
    srcs: SourceRow[],
    participants: ParticipantRow[],
    basis: 'rsvp' | 'attendance',
  ): Promise<AttendanceSourceInput[]> {
    const budgetRows = srcs.length
      ? await tx
          .select({ id: budgets.id, name: budgets.name, orgUnitId: budgets.orgUnitId })
          .from(budgets)
          .where(inArray(budgets.id, [...new Set(srcs.map((s) => s.originBudgetId))]))
      : [];
    const contributions = srcs.some((s) => s.contributionRequestId)
      ? await tx
          .select({ id: contributionRequests.id, ref: contributionRequests.ref })
          .from(contributionRequests)
          .where(
            inArray(
              contributionRequests.id,
              srcs.map((s) => s.contributionRequestId).filter((x): x is string => Boolean(x)),
            ),
          )
      : [];
    const units = await this.support.orgUnitNames(tx, [
      ...budgetRows.map((b) => b.orgUnitId),
      ...participants.map((p) => p.locationOrgUnitId),
    ]);
    const planned = (p: ParticipantRow) => p.rsvpStatus !== 'cant_go';
    const counted = (p: ParticipantRow) =>
      basis === 'attendance' ? ATTENDED.includes(p.attendanceStatus) : p.rsvpStatus === 'going';
    const claimed = new Set<string>();
    const inputs: AttendanceSourceInput[] = [];
    for (const s of srcs) {
      const budget = budgetRows.find((b) => b.id === s.originBudgetId);
      const unitId = budget?.orgUnitId ?? null;
      const mine = (p: ParticipantRow) =>
        unitId !== null ? p.locationOrgUnitId === unitId : false;
      const ownPlanned = participants.filter((p) => planned(p) && mine(p));
      const ownActual = participants.filter((p) => counted(p) && mine(p));
      for (const p of [...ownPlanned, ...ownActual]) claimed.add(p.id);
      inputs.push({
        sourceId: s.id,
        budgetId: s.budgetId,
        budgetName: budget?.name ?? '',
        locationOrgUnitId: unitId,
        locationName: unitId ? (units.get(unitId) ?? 'No location') : (budget?.name ?? ''),
        contributionRef: contributions.find((c) => c.id === s.contributionRequestId)?.ref ?? null,
        approvedMinor: s.fundedMinor - s.returnedMinor,
        plannedHeadcount: ownPlanned.length,
        actualHeadcount: ownActual.length,
      });
    }
    // Anyone whose location no source covers is carried by the event's own funds (the home budget).
    const own = inputs.find((i) => srcs.find((s) => s.id === i.sourceId)?.kind === 'own');
    if (own) {
      own.plannedHeadcount += participants.filter((p) => planned(p) && !claimed.has(p.id)).length;
      own.actualHeadcount += participants.filter((p) => counted(p) && !claimed.has(p.id)).length;
    }
    return inputs;
  }

  /** Cost the event has consumed from its sources so far, in the event currency. */
  private costSoFar(srcs: readonly SourceRow[]): number {
    return srcs.filter((s) => s.status === 'active').reduce((a, s) => a + s.consumedMinor, 0);
  }

  /** Per-head catering or ticket cost on the event's commitments, which is what a no-show wastes. */
  private async variablePerHead(tx: Tx, e: EventRow, headcount: number): Promise<number> {
    if (headcount <= 0) return 0;
    const rows = await tx
      .select({ amount: commitments.amountMinor, description: commitments.description })
      .from(commitments)
      .where(
        and(
          eq(commitments.eventId, e.id),
          inArray(commitments.status, ['encumbered', 'partially_consumed', 'consumed']),
        ),
      );
    const variable = rows.filter((r) =>
      /cater|lunch|dinner|food|ticket|activit/i.test(r.description),
    );
    const total = variable.reduce((a, r) => a + r.amount, 0);
    return Math.round(total / headcount);
  }

  async view(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventAttendanceView> {
    const canManage = await this.support.canManage(tx, actor, e);
    const participants = await this.support.participants(tx, e.id);
    const srcs = await this.sources.list(tx, e.id);
    const basis: 'rsvp' | 'attendance' = e.attendanceFinal ? 'attendance' : 'rsvp';
    const inputs = await this.sourceInputs(tx, srcs, participants, basis);
    const counts = {
      planned: e.expectedAttendance ?? participants.length,
      going: participants.filter((p) => p.rsvpStatus === 'going').length,
      attended: participants.filter((p) => p.attendanceStatus === 'attended').length,
      walkIn: participants.filter((p) => p.attendanceStatus === 'walk_in').length,
      noShow: participants.filter((p) => p.attendanceStatus === 'no_show').length,
      notMarked: participants.filter((p) => p.attendanceStatus === 'unknown').length,
      totalActualAttendees: participants.filter((p) => ATTENDED.includes(p.attendanceStatus))
        .length,
    };
    const actualHeadcount = basis === 'attendance' ? counts.totalActualAttendees : counts.going;
    const cost = this.costSoFar(srcs);
    const funding = await this.support.events.funding(tx, e, srcs);
    const result = recalculateAttendanceSplit({
      capMinor: funding.capMinor,
      costSoFarMinor: cost,
      variablePerHeadMinor: await this.variablePerHead(tx, e, Math.max(actualHeadcount, 1)),
      plannedHeadcount: counts.planned,
      actualHeadcount,
      noShowCount: counts.noShow,
      perHeadLimitMinor: e.perHeadLimitMinor,
      perHeadLimitMode: 'soft',
      sources: inputs,
    });
    const entityNames = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (x) => [x.id, x.name],
      ),
    );
    const attendees = participants.filter((p) =>
      basis === 'attendance' ? ATTENDED.includes(p.attendanceStatus) : p.rsvpStatus === 'going',
    );
    const entityBreakdown = [
      ...new Set(attendees.map((p) => p.employingEntityId ?? e.legalEntityId)),
    ]
      .map((id) => {
        const n = attendees.filter((p) => (p.employingEntityId ?? e.legalEntityId) === id).length;
        return {
          entityName: entityNames.get(id) ?? 'Unknown entity',
          attendees: n,
          shareBps: attendees.length ? Math.round((n * 10_000) / attendees.length) : 0,
        };
      })
      .sort((a, b) => b.attendees - a.attendees);
    const appliedBy = await this.support.personNames(tx, [e.splitAppliedByPersonId]);
    const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
    return {
      eventId: e.id,
      canManage,
      locked: LOCKED_STATUSES.includes(e.status),
      attendanceFinal: e.attendanceFinal,
      splitAppliedAt: e.splitAppliedAt?.toISOString() ?? null,
      splitAppliedByName: e.splitAppliedByPersonId
        ? (appliedBy.get(e.splitAppliedByPersonId) ?? null)
        : null,
      splitKeepReason: e.splitKeepReason,
      counts,
      costSoFar: m(cost),
      perHeadPlanned: m(result.perHeadPlannedMinor),
      perHeadActual: m(result.perHeadActualMinor),
      noShowCost: m(result.noShowCostMinor),
      perHeadLimit: result.limitCheck
        ? {
            limit: m(result.limitCheck.limitMinor),
            mode: result.limitCheck.mode,
            exceeded: result.limitCheck.exceeded,
            excess: m(result.limitCheck.excessMinor),
            message: result.limitCheck.message,
          }
        : null,
      previewBasis: basis,
      shares: result.shares.map((s) => ({
        sourceId: s.sourceId,
        budgetId: s.budgetId,
        budgetName: s.budgetName,
        locationName: s.locationName,
        contributionRef: s.contributionRef,
        approvedMinor: s.approvedMinor,
        plannedHeadcount: s.plannedHeadcount,
        plannedAmount: m(s.plannedAmountMinor),
        actualHeadcount: s.actualHeadcount,
        actualAmount: m(s.actualAmountMinor),
        deltaMinor: s.deltaMinor,
        exceedsApprovedByMinor: s.exceedsApprovedByMinor,
      })),
      entityBreakdown,
      blockedReason: result.exceedingSource
        ? `${result.exceedingSource.budgetName}'s share would be above its approved contribution. Ask for more through a contribution request before applying the split.`
        : LOCKED_STATUSES.includes(e.status)
          ? 'The split is locked once reconciliation starts.'
          : null,
      participants: await this.support.events.participantViews(tx, e),
    };
  }

  get(actor: RequestActor, eventId: string): Promise<EventAttendanceView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.view(tx, actor, e);
    });
  }

  mark(
    actor: RequestActor,
    eventId: string,
    body: MarkAttendanceBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventAttendanceView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.attendance.mark:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'Attendance');
        if (e.attendanceFinal && !body.finalize)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Attendance is final for this event and cannot change.',
          );
        let marked = 0;
        if (body.markAllGoingAttended) {
          const rows = await tx
            .update(eventParticipants)
            .set({ attendanceStatus: 'attended' })
            .where(
              and(
                eq(eventParticipants.eventId, e.id),
                eq(eventParticipants.rsvpStatus, 'going'),
                eq(eventParticipants.attendanceStatus, 'unknown'),
              ),
            )
            .returning({ id: eventParticipants.id });
          marked += rows.length;
        }
        for (const mark of body.marks ?? []) {
          const [p] = await tx
            .select()
            .from(eventParticipants)
            .where(
              and(
                eq(eventParticipants.id, mark.participantId),
                eq(eventParticipants.eventId, e.id),
              ),
            );
          if (!p) throw ApiProblem.notFound('participant');
          await tx
            .update(eventParticipants)
            .set({ attendanceStatus: mark.status })
            .where(eq(eventParticipants.id, p.id));
          marked += 1;
        }
        let walkIn: string | null = null;
        if (body.walkInPersonId) {
          const [person] = await tx.select().from(people).where(eq(people.id, body.walkInPersonId));
          if (!person)
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'That person is not in the directory.', {
              field: 'walkInPersonId',
            });
          const [existing] = await tx
            .select()
            .from(eventParticipants)
            .where(
              and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.personId, person.id)),
            );
          if (existing) {
            await tx
              .update(eventParticipants)
              .set({ attendanceStatus: 'walk_in' })
              .where(eq(eventParticipants.id, existing.id));
            walkIn = existing.id;
          } else {
            const [added] = await tx
              .insert(eventParticipants)
              .values({
                tenantId: actor.tenantId,
                eventId: e.id,
                personId: person.id,
                isEmployee: true,
                employingEntityId: person.employingEntityId,
                costCenterId: person.costCenterId,
                locationOrgUnitId: person.locationOrgUnitId,
                attendanceStatus: 'walk_in',
              })
              .returning();
            walkIn = added.id;
          }
        }
        if (body.finalize) {
          const left = (await this.support.participants(tx, e.id)).filter(
            (p) => p.attendanceStatus === 'unknown' && p.rsvpStatus !== 'cant_go',
          );
          if (left.length)
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              `Mark everyone before finalizing: ${left.length} people are still not marked.`,
              { notMarked: left.length },
            );
          await tx
            .update(eventParticipants)
            .set({ attendanceStatus: 'no_show' })
            .where(
              and(
                eq(eventParticipants.eventId, e.id),
                eq(eventParticipants.attendanceStatus, 'unknown'),
              ),
            );
          await tx
            .update(events)
            .set({ attendanceFinal: true, attendanceFinalAt: new Date(), updatedAt: new Date() })
            .where(eq(events.id, e.id));
          await this.plan.completeSystemTask(tx, e.id, 'attendance', {
            id: e.id,
            label: 'Attendance marked final',
          });
        }
        await this.support.log(tx, actor, e, 'event.attendance_marked', ctx, {
          marked: { from: null, to: marked },
          ...(walkIn ? { walkIn: { from: null, to: walkIn } } : {}),
          ...(body.finalize ? { attendanceFinal: { from: false, to: true } } : {}),
        });
        const refreshed = (await this.support.events.row(tx, e.id))!;
        return this.view(tx, actor, refreshed);
      },
    );
  }

  /**
   * Applies the attendance-based split, or keeps the planned one with a reason. Applying re-posts
   * every open commitment's funding lines (release then new encumbrance) with ordered budget locks
   * and one audit entry carrying the shares before and after.
   */
  apply(
    actor: RequestActor,
    eventId: string,
    body: ApplyAttendanceSplitBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventAttendanceView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.attendance.apply:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'The cost split');
        const before = await this.view(tx, actor, e);
        if (body.action === 'keep_planned') {
          await tx
            .update(events)
            .set({ splitKeepReason: body.reason, updatedAt: new Date() })
            .where(eq(events.id, e.id));
          await this.support.log(
            tx,
            actor,
            e,
            'event.attendance_split_kept',
            ctx,
            {
              shares: {
                from: null,
                to: before.shares.map((s) => ({
                  sourceId: s.sourceId,
                  plannedAmount: s.plannedAmount,
                })),
              },
            },
            body.reason,
          );
          return this.view(tx, actor, (await this.support.events.row(tx, e.id))!);
        }
        if (!e.attendanceFinal)
          throw new ApiProblem(
            409,
            'ATTENDANCE_NOT_FINAL',
            'Mark attendance final before applying the attendance-based split.',
          );
        const exceeding = before.shares.find((s) => s.exceedsApprovedByMinor > 0);
        if (exceeding)
          throw new ApiProblem(
            409,
            'SHARE_EXCEEDS_CONTRIBUTION',
            `${exceeding.budgetName}'s share would be ${exceeding.actualAmount.amountMinor} ${e.currency} minor units, above its approved ${exceeding.approvedMinor}. Request ${exceeding.exceedsApprovedByMinor} more through a contribution request.`,
            {
              sourceId: exceeding.sourceId,
              budgetName: exceeding.budgetName,
              excessMinor: exceeding.exceedsApprovedByMinor,
            },
          );
        const weights = new Map(
          before.shares.map((s) => [s.sourceId, Math.max(s.actualAmount.amountMinor, 0)]),
        );
        if ([...weights.values()].every((w) => w === 0))
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'There is nothing committed yet, so there is no split to re-post.',
          );
        await this.sources.list(tx, e.id, { lock: true });
        const open = await tx
          .select({ id: commitments.id })
          .from(commitments)
          .where(and(eq(commitments.eventId, e.id), eq(commitments.status, 'encumbered')));
        const pc = this.support.events.pc(actor, 'events.attendance.apply', ctx);
        const journalIds: string[] = [];
        for (const c of open)
          journalIds.push(
            ...(await this.commitments.rebalanceEventFunding(tx, pc, c.id, weights)).journalIds,
          );
        await tx
          .update(events)
          .set({
            splitAppliedAt: new Date(),
            splitAppliedByPersonId: actor.personId,
            splitKeepReason: null,
            updatedAt: new Date(),
          })
          .where(eq(events.id, e.id));
        const after = await this.view(tx, actor, (await this.support.events.row(tx, e.id))!);
        await this.support.log(
          tx,
          actor,
          e,
          'event.attendance_split_applied',
          ctx,
          {
            attendance: {
              from: null,
              to: {
                attended: before.counts.attended,
                walkIn: before.counts.walkIn,
                noShow: before.counts.noShow,
              },
            },
            shares: {
              from: before.shares.map((s) => ({
                sourceId: s.sourceId,
                amount: s.plannedAmount,
              })),
              to: after.shares.map((s) => ({ sourceId: s.sourceId, amount: s.actualAmount })),
            },
            journalIds: { from: null, to: journalIds },
          },
          body.reason,
        );
        return after;
      },
    );
  }
}
