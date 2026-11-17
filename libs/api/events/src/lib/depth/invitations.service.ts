import { ApiProblem, type CommandResult, type RequestActor, stampUtc } from '@bf/api/core';
import { eventInvitations, eventParticipants, events, orgUnits, people, type Tx } from '@bf/api/db';
import type {
  EmployeeInvitationView,
  EventInvitationView,
  EventNeedsSummaryView,
  ExportCatererNeedsBody,
  ExportCatererNeedsResult,
  RemindInvitationsBody,
  RsvpRespondBody,
  SendInvitationsBody,
  SetEventRsvpStateBody,
  SubmitAttendeeNeedsBody,
} from '@bf/contracts';
import { evaluateRsvpTransition } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Ctx, EventRow } from '../events.service';
import { EventPlanService } from './event-plan.service';
import {
  EMPTY_NEEDS,
  EventDepthSupport,
  needsOf,
  type AttendeeNeeds,
  type ParticipantRow,
} from './event-depth.support';

type InvitationRow = typeof eventInvitations.$inferSelect;

const GOING = 'going';
const WAITLISTED = 'waitlisted';

/**
 * Invitations, RSVP and attendee needs (47a, 47b). RSVPs never post money: they change the expected
 * attendance that the per-head recalculation (47e) works from. Capacity and the waitlist are decided
 * by the API, and individual needs answers reach only the event's organizers and the person.
 */
@Injectable()
export class EventInvitationsService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly plan: EventPlanService,
  ) {}

  private async settings(tx: Tx, actor: RequestActor, e: EventRow): Promise<InvitationRow> {
    const [row] = await tx
      .select()
      .from(eventInvitations)
      .where(eq(eventInvitations.eventId, e.id));
    if (row) return row;
    const [created] = await tx
      .insert(eventInvitations)
      .values({ tenantId: actor.tenantId, eventId: e.id })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await tx
      .select()
      .from(eventInvitations)
      .where(eq(eventInvitations.eventId, e.id));
    return existing;
  }

  private rsvpClosed(inv: InvitationRow): boolean {
    if (inv.status !== 'open') return true;
    return inv.deadline !== null && inv.deadline.getTime() < stampUtc().getTime();
  }

  async view(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventInvitationView> {
    const inv = await this.settings(tx, actor, e);
    const parts = await this.support.participants(tx, e.id);
    const units = await this.support.orgUnitNames(
      tx,
      parts.map((p) => p.locationOrgUnitId),
    );
    const count = (status: string) => parts.filter((p) => p.rsvpStatus === status).length;
    const byLocation = [...new Set(parts.map((p) => p.locationOrgUnitId))].map((id) => {
      const inUnit = parts.filter((p) => p.locationOrgUnitId === id);
      return {
        locationName: id ? (units.get(id) ?? 'No location') : 'No location',
        invited: inUnit.length,
        going: inUnit.filter((p) => p.rsvpStatus === GOING).length,
      };
    });
    const going = count(GOING);
    return {
      eventId: e.id,
      status: inv.status as 'not_sent' | 'open' | 'closed',
      message: inv.message,
      deadline: inv.deadline?.toISOString() ?? null,
      capacity: inv.capacity,
      waitlistEnabled: inv.waitlistEnabled,
      autoPromoteWaitlist: inv.autoPromoteWaitlist,
      attachCalendarInvite: inv.attachCalendarInvite,
      collectTravelNeeds: inv.collectTravelNeeds,
      sentAt: inv.sentAt?.toISOString() ?? null,
      remindersSentCount: inv.remindersSentCount,
      counts: {
        invited: parts.length,
        going,
        cantGo: count('cant_go'),
        waitlisted: count(WAITLISTED),
        noResponse: parts.filter((p) => p.rsvpStatus === 'invited').length,
      },
      byLocation: byLocation.sort((a, b) => b.invited - a.invited),
      plannedAttendance: e.expectedAttendance ?? parts.length,
      attendanceChangedFromPlan:
        inv.sentAt !== null && going > 0 && going !== (e.expectedAttendance ?? parts.length),
      participants: await this.support.events.participantViews(tx, e),
    };
  }

  get(actor: RequestActor, eventId: string): Promise<EventInvitationView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.view(tx, actor, e);
    });
  }

  send(
    actor: RequestActor,
    eventId: string,
    body: SendInvitationsBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventInvitationView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.invitations.send:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'Invitations');
        if (e.startsAt && new Date(body.deadline) > e.startsAt)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Set an RSVP deadline before the event starts.',
            { field: 'deadline' },
          );
        const inv = await this.settings(tx, actor, e);
        const parts = await this.support.participants(tx, e.id);
        if (!parts.length)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Add the people you want to invite before sending invitations.',
          );
        await tx
          .update(eventInvitations)
          .set({
            message: body.message,
            deadline: new Date(body.deadline),
            capacity: body.capacity ?? null,
            waitlistEnabled: body.waitlistEnabled,
            autoPromoteWaitlist: body.autoPromoteWaitlist,
            attachCalendarInvite: body.attachCalendarInvite,
            collectTravelNeeds: body.collectTravelNeeds,
            status: 'open',
            sentByPersonId: actor.personId,
            sentAt: inv.sentAt ?? stampUtc(),
            closedAt: null,
            updatedAt: stampUtc(),
          })
          .where(eq(eventInvitations.id, inv.id));
        await this.plan.completeSystemTask(tx, e.id, 'invitations', {
          id: inv.id,
          label: `Invitations sent to ${parts.length} people`,
        });
        await this.support.log(tx, actor, e, 'event.invitations_sent', ctx, {
          invited: { from: null, to: parts.length },
          deadline: { from: inv.deadline?.toISOString() ?? null, to: body.deadline },
          capacity: { from: inv.capacity, to: body.capacity ?? null },
          waitlistEnabled: { from: inv.waitlistEnabled, to: body.waitlistEnabled },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  remind(
    actor: RequestActor,
    eventId: string,
    body: RemindInvitationsBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventInvitationView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.invitations.remind:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const inv = await this.settings(tx, actor, e);
        if (inv.status !== 'open')
          throw new ApiProblem(409, 'RSVP_CLOSED', 'Reminders go out only while RSVPs are open.');
        const target = body.participantIds?.length
          ? and(
              eq(eventParticipants.eventId, e.id),
              inArray(eventParticipants.id, body.participantIds),
            )
          : and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.rsvpStatus, 'invited'));
        const reminded = await tx
          .update(eventParticipants)
          .set({ remindersSentCount: sql`${eventParticipants.remindersSentCount} + 1` })
          .where(target)
          .returning({ id: eventParticipants.id });
        await tx
          .update(eventInvitations)
          .set({ remindersSentCount: inv.remindersSentCount + 1, updatedAt: stampUtc() })
          .where(eq(eventInvitations.id, inv.id));
        await this.support.log(tx, actor, e, 'event.invitation_reminders_sent', ctx, {
          reminded: { from: null, to: reminded.length },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  setRsvpState(
    actor: RequestActor,
    eventId: string,
    body: SetEventRsvpStateBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventInvitationView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.invitations.state:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const inv = await this.settings(tx, actor, e);
        if (body.status === 'open' && !body.deadline && !inv.deadline)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Give a new RSVP deadline when you reopen RSVPs.',
            { field: 'deadline' },
          );
        await tx
          .update(eventInvitations)
          .set({
            status: body.status,
            ...(body.deadline ? { deadline: new Date(body.deadline) } : {}),
            closedAt: body.status === 'closed' ? stampUtc() : null,
            updatedAt: stampUtc(),
          })
          .where(eq(eventInvitations.id, inv.id));
        await this.support.log(tx, actor, e, 'event.rsvp_state_changed', ctx, {
          status: { from: inv.status, to: body.status },
          ...(body.deadline
            ? { deadline: { from: inv.deadline?.toISOString() ?? null, to: body.deadline } }
            : {}),
        });
        return this.view(tx, actor, e);
      },
    );
  }

  // Employee self-service -------------------------------------------------------------------------

  private async employeeView(
    tx: Tx,
    actor: RequestActor,
    participant: ParticipantRow,
    e: EventRow,
  ): Promise<EmployeeInvitationView> {
    const inv = await this.settings(tx, actor, e);
    const organizer = await this.support.personNames(tx, [e.organizerPersonId]);
    return {
      invitationId: participant.id,
      eventId: e.id,
      eventName: e.name,
      eventCode: e.eventCode,
      eventStatus: e.status,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      venue: e.venue,
      organizerName: organizer.get(e.organizerPersonId) ?? '',
      message: inv.message,
      deadline: inv.deadline?.toISOString() ?? null,
      rsvpClosed: this.rsvpClosed(inv) || e.status === 'cancelled',
      rsvpStatus: participant.rsvpStatus as EmployeeInvitationView['rsvpStatus'],
      waitlistPosition: participant.waitlistPosition,
      collectTravelNeeds: inv.collectTravelNeeds,
      needsSubmitted: Boolean(participant.needsSubmittedAt),
      needs: needsOf(participant),
      visibleAgenda: await this.plan.visibleAgenda(tx, e.id),
    };
  }

  getEmployeeInvitation(
    actor: RequestActor,
    invitationId: string,
  ): Promise<EmployeeInvitationView> {
    return this.support.read(actor, async (tx) => {
      const { participant, event } = await this.support.invitation(tx, actor, invitationId);
      return this.employeeView(tx, actor, participant, event);
    });
  }

  respond(
    actor: RequestActor,
    invitationId: string,
    body: RsvpRespondBody,
    ctx: Ctx,
  ): Promise<CommandResult<EmployeeInvitationView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `invitations.rsvp:${invitationId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const { participant, event } = await this.support.invitation(tx, actor, invitationId);
        if (!actor.personId || participant.personId !== actor.personId)
          throw ApiProblem.forbidden('Only the invited person can answer their invitation.');
        const inv = await this.settings(tx, actor, event);
        const parts = await this.support.participants(tx, event.id);
        const decision = evaluateRsvpTransition({
          response: body.response,
          currentStatus: participant.rsvpStatus,
          currentGoing: parts.filter((p) => p.rsvpStatus === GOING).length,
          capacity: inv.capacity,
          waitlistEnabled: inv.waitlistEnabled,
          maxWaitlistPosition: Math.max(
            0,
            ...parts.map((p) => (p.rsvpStatus === WAITLISTED ? (p.waitlistPosition ?? 0) : 0)),
          ),
          rsvpClosed: this.rsvpClosed(inv) || event.status === 'cancelled',
        });
        if (!decision.ok)
          throw new ApiProblem(
            decision.error.code === 'RSVP_CLOSED' ? 409 : 422,
            decision.error.code,
            decision.error.message,
            decision.error.params,
          );
        await tx
          .update(eventParticipants)
          .set({
            rsvpStatus: decision.value.nextStatus,
            waitlistPosition: decision.value.waitlistPosition,
            rsvpRespondedAt: stampUtc(),
          })
          .where(eq(eventParticipants.id, participant.id));
        const promoted =
          participant.rsvpStatus === GOING && decision.value.nextStatus !== GOING
            ? await this.promoteWaitlist(tx, event, inv)
            : null;
        await this.support.log(tx, actor, event, 'event.rsvp_recorded', ctx, {
          participantId: { from: null, to: participant.id },
          rsvpStatus: { from: participant.rsvpStatus, to: decision.value.nextStatus },
          ...(promoted ? { waitlistPromoted: { from: null, to: promoted } } : {}),
        });
        const [refreshed] = await tx
          .select()
          .from(eventParticipants)
          .where(eq(eventParticipants.id, participant.id));
        return this.employeeView(tx, actor, refreshed, event);
      },
    );
  }

  /**
   * Calendar responses (097), applied by the connector identity through the same transition rules
   * as an answer in the app: Accepted becomes Going (or Waitlisted beyond capacity), Declined becomes
   * Can't go, Tentative stays No response. The last answer wins across channels, so a response no
   * newer than the one already recorded changes nothing, which also makes a repeated run a no-op.
   * Each change writes one audit entry naming the channel. A response is refused, with the reason,
   * when the event or the person is unknown, the person is not invited, or RSVPs are closed.
   */
  async applyCalendarResponses(
    actor: RequestActor,
    responses: CalendarResponseInput[],
    ctx: Pick<Ctx, 'requestId'> & { channel: string },
  ): Promise<CalendarResponseOutcome> {
    return this.support.read(actor, async (tx) => {
      this.support.policy.assert(actor, 'event.rsvp_sync', {
        kind: 'tenant',
        tenantId: actor.tenantId,
      });
      const outcome: CalendarResponseOutcome = { applied: 0, unchanged: 0, refused: [] };
      // Oldest first, so within one run the latest answer is the one left standing.
      const ordered = [...responses].sort(
        (a, b) => a.at.localeCompare(b.at) || a.externalId.localeCompare(b.externalId),
      );
      for (const r of ordered) {
        const refuse = (reason: string) =>
          outcome.refused.push({ externalId: r.externalId, attendee: r.attendeeEmail, reason });
        const at = new Date(r.at);
        if (Number.isNaN(at.getTime())) {
          refuse(`"${r.at}" is not a date and time.`);
          continue;
        }
        if (!['accepted', 'declined', 'tentative'].includes(r.response)) {
          refuse(`"${r.response}" is not a calendar response BudgetFlow understands.`);
          continue;
        }
        const [event] = await tx.select().from(events).where(eq(events.eventCode, r.eventCode));
        if (!event) {
          refuse(`No event has the code ${r.eventCode || '(empty)'}.`);
          continue;
        }
        const [person] = await tx
          .select({ id: people.id })
          .from(people)
          .where(sql`lower(${people.email}) = lower(${r.attendeeEmail})`);
        const [participant] = person
          ? await tx
              .select()
              .from(eventParticipants)
              .where(
                and(
                  eq(eventParticipants.eventId, event.id),
                  eq(eventParticipants.personId, person.id),
                ),
              )
              .for('update')
          : [];
        if (!participant) {
          refuse(`${r.attendeeEmail} is not invited to ${event.eventCode}.`);
          continue;
        }
        if (participant.rsvpRespondedAt && at.getTime() <= participant.rsvpRespondedAt.getTime()) {
          outcome.unchanged += 1;
          continue;
        }
        const inv = await this.settings(tx, actor, event);
        const closed =
          inv.status !== 'open' ||
          event.status === 'cancelled' ||
          (inv.deadline !== null && inv.deadline.getTime() < stampUtc().getTime());
        if (closed) {
          refuse(`RSVPs for ${event.eventCode} are closed; the answer was not recorded.`);
          continue;
        }
        let next: { nextStatus: string; waitlistPosition: number | null };
        if (r.response === 'tentative') {
          // BudgetFlow has no Maybe (47a): Tentative counts as no response.
          next = { nextStatus: 'invited', waitlistPosition: null };
        } else {
          const parts = await this.support.participants(tx, event.id);
          const decision = evaluateRsvpTransition({
            response: r.response === 'accepted' ? 'going' : 'cant_go',
            currentStatus: participant.rsvpStatus,
            currentGoing: parts.filter((p) => p.rsvpStatus === GOING).length,
            capacity: inv.capacity,
            waitlistEnabled: inv.waitlistEnabled,
            maxWaitlistPosition: Math.max(
              0,
              ...parts.map((p) => (p.rsvpStatus === WAITLISTED ? (p.waitlistPosition ?? 0) : 0)),
            ),
            rsvpClosed: false,
          });
          if (!decision.ok) {
            refuse(decision.error.message);
            continue;
          }
          next = decision.value;
        }
        // An answer that keeps the status changes nothing, so it writes nothing (and no audit entry).
        if (next.nextStatus === participant.rsvpStatus) {
          outcome.unchanged += 1;
          continue;
        }
        await tx
          .update(eventParticipants)
          .set({
            rsvpStatus: next.nextStatus,
            waitlistPosition: next.waitlistPosition,
            rsvpRespondedAt: at,
          })
          .where(eq(eventParticipants.id, participant.id));
        const promoted =
          participant.rsvpStatus === GOING && next.nextStatus !== GOING
            ? await this.promoteWaitlist(tx, event, inv)
            : null;
        await this.support.log(tx, actor, event, 'event.rsvp_recorded', ctx, {
          participantId: { from: null, to: participant.id },
          rsvpStatus: { from: participant.rsvpStatus, to: next.nextStatus },
          channel: { from: null, to: ctx.channel },
          calendarResponse: { from: null, to: `${r.response} (${r.externalId})` },
          ...(promoted ? { waitlistPromoted: { from: null, to: promoted } } : {}),
        });
        outcome.applied += 1;
      }
      return outcome;
    });
  }

  /** A place freed by a Can't go goes to the first person on the waitlist when promotion is automatic. */
  private async promoteWaitlist(tx: Tx, e: EventRow, inv: InvitationRow): Promise<string | null> {
    if (!inv.waitlistEnabled || !inv.autoPromoteWaitlist || inv.capacity === null) return null;
    const parts = await this.support.participants(tx, e.id);
    if (parts.filter((p) => p.rsvpStatus === GOING).length >= inv.capacity) return null;
    const next = parts
      .filter((p) => p.rsvpStatus === WAITLISTED)
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))[0];
    if (!next) return null;
    await tx
      .update(eventParticipants)
      .set({ rsvpStatus: GOING, waitlistPosition: null })
      .where(eq(eventParticipants.id, next.id));
    return next.id;
  }

  submitNeeds(
    actor: RequestActor,
    invitationId: string,
    body: SubmitAttendeeNeedsBody,
    ctx: Ctx,
  ): Promise<CommandResult<EmployeeInvitationView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `invitations.needs:${invitationId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const { participant, event } = await this.support.invitation(tx, actor, invitationId);
        if (!actor.personId || participant.personId !== actor.personId)
          throw ApiProblem.forbidden('Only the invited person can submit their own needs.');
        if (body.dietaryPreference === 'other' && !body.dietaryOther?.trim())
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Describe the other dietary need.', {
            field: 'dietaryOther',
          });
        const needs: AttendeeNeeds = {
          ...EMPTY_NEEDS,
          dietaryPreference: body.dietaryPreference,
          dietaryOther: body.dietaryOther ?? null,
          allergies: body.allergies,
          allergyOther: body.allergyOther ?? null,
          severeAllergy: body.severeAllergy,
          accessibility: body.accessibility,
          accessibilityOther: body.accessibilityOther ?? null,
          needsTravel: body.needsTravel,
          travelFromCity: body.travelFromCity ?? null,
          travelArrival: body.travelArrival ?? null,
          needsHotelNight: body.needsHotelNight,
          photoConsent: body.photoConsent,
          reuseForFutureEvents: body.reuseForFutureEvents,
        };
        await tx
          .update(eventParticipants)
          .set({ needs, needsSubmittedAt: stampUtc(), needsDeletedAt: null })
          .where(eq(eventParticipants.id, participant.id));
        // Only the answers kept as "counts" are logged: the answers themselves are personal data.
        await this.support.log(tx, actor, event, 'event.attendee_needs_submitted', ctx, {
          participantId: { from: null, to: participant.id },
          hasAllergies: { from: null, to: needs.allergies.length > 0 },
          needsAccessibility: { from: null, to: needs.accessibility.length > 0 },
          photoConsent: { from: null, to: needs.photoConsent },
        });
        const [refreshed] = await tx
          .select()
          .from(eventParticipants)
          .where(eq(eventParticipants.id, participant.id));
        return this.employeeView(tx, actor, refreshed, event);
      },
    );
  }

  // Needs summary ---------------------------------------------------------------------------------

  private tally(values: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of values) out[v] = (out[v] ?? 0) + 1;
    return out;
  }

  async needsView(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventNeedsSummaryView> {
    const inv = await this.settings(tx, actor, e);
    const canSeeIndividual = await this.support.canManage(tx, actor, e);
    const parts = await this.support.participants(tx, e.id);
    const going = parts.filter((p) => p.rsvpStatus === GOING);
    const answered = going.filter((p) => p.needsSubmittedAt && !p.needsDeletedAt);
    const needs = answered.map((p) => needsOf(p));
    const units = await this.support.orgUnitNames(
      tx,
      answered.map((p) => p.locationOrgUnitId),
    );
    const names = await this.support.personNames(
      tx,
      answered.map((p) => p.personId),
    );
    const deleted = parts.find((p) => p.needsDeletedAt)?.needsDeletedAt ?? null;
    return {
      eventId: e.id,
      canSeeIndividual,
      deletedAt: deleted?.toISOString() ?? null,
      collectTravelNeeds: inv.collectTravelNeeds,
      goingCount: going.length,
      answeredCount: answered.length,
      dietaryCounts: this.tally(needs.map((n) => n.dietaryPreference)),
      allergyCounts: this.tally(needs.flatMap((n) => n.allergies)),
      severeAllergyCount: needs.filter((n) => n.severeAllergy).length,
      accessibilityCounts: this.tally(needs.flatMap((n) => n.accessibility)),
      travelCount: needs.filter((n) => n.needsTravel).length,
      hotelNightCount: needs.filter((n) => n.needsHotelNight).length,
      photoConsentYes: needs.filter((n) => n.photoConsent).length,
      photoConsentNo: needs.filter((n) => !n.photoConsent).length,
      individuals: canSeeIndividual
        ? answered.map((p) => {
            const n = needsOf(p);
            return {
              participantId: p.id,
              name: (p.personId && names.get(p.personId)) || p.guestName || 'Guest',
              locationName: p.locationOrgUnitId ? (units.get(p.locationOrgUnitId) ?? null) : null,
              dietaryPreference: n.dietaryPreference,
              dietaryOther: n.dietaryOther,
              allergies: n.allergies,
              severeAllergy: n.severeAllergy,
              accessibility: n.accessibility,
              needsTravel: n.needsTravel,
              travelFromCity: n.travelFromCity,
              needsHotelNight: n.needsHotelNight,
              photoConsent: n.photoConsent,
            };
          })
        : [],
    };
  }

  needs(actor: RequestActor, eventId: string): Promise<EventNeedsSummaryView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.needsView(tx, actor, e);
    });
  }

  /**
   * Counts for the caterer, or the allergy list with first names when food safety needs it. Including
   * names discloses personal data, so that export is audited (47b).
   */
  exportNeeds(
    actor: RequestActor,
    eventId: string,
    body: ExportCatererNeedsBody,
    ctx: Ctx,
  ): Promise<CommandResult<ExportCatererNeedsResult>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.needs.export:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const withNames = body.content === 'counts_and_allergies';
        if (withNames && !body.foodSafetyConfirmed)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Confirm that the allergy list with names is needed for food safety.',
            { field: 'foodSafetyConfirmed' },
          );
        const summary = await this.needsView(tx, actor, e);
        const lines: string[] = ['Group,Answer,Count'];
        for (const [k, n] of Object.entries(summary.dietaryCounts))
          lines.push(`Dietary,${k.replace(/_/g, ' ')},${n}`);
        for (const [k, n] of Object.entries(summary.allergyCounts))
          lines.push(`Allergy,${k.replace(/_/g, ' ')},${n}`);
        lines.push(`Allergy,severe preparations,${summary.severeAllergyCount}`);
        if (withNames) {
          lines.push('', 'First name,Allergies,Severe');
          for (const i of summary.individuals.filter((x) => x.allergies.length || x.severeAllergy))
            lines.push(
              `${i.name.split(' ')[0]},${i.allergies.join(' and ') || 'none listed'},${i.severeAllergy ? 'yes' : 'no'}`,
            );
        }
        const fileName = `${e.eventCode}-attendee-needs.${body.format}`;
        if (withNames)
          await this.support.log(tx, actor, e, 'event.needs_exported', ctx, {
            content: { from: null, to: body.content },
            format: { from: null, to: body.format },
            names: { from: null, to: summary.individuals.length },
          });
        return {
          fileName,
          format: body.format,
          content: lines.join('\n'),
          audited: withNames,
        };
      },
    );
  }

  /** The location name of each participant, for the survey and scorecard breakdowns. */
  async locationsOf(tx: Tx, eventId: string): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: eventParticipants.id, name: orgUnits.name })
      .from(eventParticipants)
      .leftJoin(orgUnits, eq(orgUnits.id, eventParticipants.locationOrgUnitId))
      .where(eq(eventParticipants.eventId, eventId));
    return new Map(rows.map((r) => [r.id, r.name ?? 'No location']));
  }
}

export interface CalendarResponseInput {
  /** The provider's id for this answer. */
  externalId: string;
  /** The BudgetFlow event code the shared-calendar invitation carries. */
  eventCode: string;
  attendeeEmail: string;
  response: string;
  /** When the person answered, at the provider (ISO 8601). */
  at: string;
}

export interface CalendarResponseOutcome {
  applied: number;
  unchanged: number;
  refused: { externalId: string; attendee: string; reason: string }[];
}
