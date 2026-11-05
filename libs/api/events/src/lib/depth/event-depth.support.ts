import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  eventParticipants,
  events,
  fiscalPeriods,
  legalEntities,
  orgUnits,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lte, gte } from 'drizzle-orm';
import { EventsService, type Ctx, type EventRow } from '../events.service';

export type ParticipantRow = typeof eventParticipants.$inferSelect;

/** The structured attendee needs answer kept on `event_participants.needs` (47b). */
export interface AttendeeNeeds {
  dietaryPreference: string;
  dietaryOther: string | null;
  allergies: string[];
  allergyOther: string | null;
  severeAllergy: boolean;
  accessibility: string[];
  accessibilityOther: string | null;
  needsTravel: boolean;
  travelFromCity: string | null;
  travelArrival: string | null;
  needsHotelNight: boolean;
  photoConsent: boolean;
  reuseForFutureEvents: boolean;
}

export const EMPTY_NEEDS: AttendeeNeeds = {
  dietaryPreference: 'no_preference',
  dietaryOther: null,
  allergies: [],
  allergyOther: null,
  severeAllergy: false,
  accessibility: [],
  accessibilityOther: null,
  needsTravel: false,
  travelFromCity: null,
  travelArrival: null,
  needsHotelNight: false,
  photoConsent: true,
  reuseForFutureEvents: false,
};

export const needsOf = (p: ParticipantRow): AttendeeNeeds => ({
  ...EMPTY_NEEDS,
  ...((p.needs ?? {}) as Partial<AttendeeNeeds>),
});

/** Statuses after which the event's plan, people and money views are read-only (47e, 46b). */
export const LOCKED_STATUSES = ['reconciling', 'closed', 'cancelled'];

/**
 * Shared plumbing for the Phase 9 event depth services: tenant-scoped reads, event lookup with the
 * same visibility rules as the event itself, fiscal period lookup for the recurring series check,
 * and the audit entry every mutation writes.
 */
@Injectable()
export class EventDepthSupport {
  constructor(
    @Inject(DB) private readonly db: Db,
    readonly commands: CommandRunner,
    readonly policy: PolicyService,
    readonly audit: AuditService,
    readonly events: EventsService,
  ) {}

  /** Runs a read inside the actor's tenant context (RLS). */
  read<T>(actor: RequestActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, fn);
  }

  /** The event, when the actor may see it; `manage` additionally demands organizer rights. */
  async event(tx: Tx, actor: RequestActor, id: string, manage = false): Promise<EventRow> {
    return this.events.visible(tx, actor, id, manage);
  }

  async canManage(tx: Tx, actor: RequestActor, e: EventRow): Promise<boolean> {
    return this.events.canManage(tx, actor, e);
  }

  participants(tx: Tx, eventId: string): Promise<ParticipantRow[]> {
    return this.events.participantsOf(tx, eventId) as Promise<ParticipantRow[]>;
  }

  /** The participant row of an invitation id, with the event it belongs to. */
  async invitation(
    tx: Tx,
    actor: RequestActor,
    invitationId: string,
  ): Promise<{ participant: ParticipantRow; event: EventRow }> {
    const [p] = await tx
      .select()
      .from(eventParticipants)
      .where(eq(eventParticipants.id, invitationId));
    if (!p) throw ApiProblem.notFound('invitation');
    const [e] = await tx.select().from(events).where(eq(events.id, p.eventId));
    if (!e) throw ApiProblem.notFound('invitation');
    const mine = Boolean(actor.personId && p.personId === actor.personId);
    if (!mine && !(await this.canManage(tx, actor, e))) throw ApiProblem.notFound('invitation');
    return { participant: p, event: e };
  }

  /** Display names of the given people, by id. */
  async personNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async orgUnitNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(inArray(orgUnits.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * The fiscal period covering `date` for the event's legal entity: recurring series refuse to create
   * an occurrence in a closed period (`EVENT_DATE_IN_CLOSED_PERIOD`).
   */
  async periodOn(
    tx: Tx,
    legalEntityId: string,
    date: string,
  ): Promise<{ label: string; status: string } | null> {
    const [row] = await tx
      .select({ label: fiscalPeriods.label, status: fiscalPeriods.status })
      .from(legalEntities)
      .innerJoin(fiscalPeriods, eq(fiscalPeriods.fiscalCalendarId, legalEntities.fiscalCalendarId))
      .where(
        and(
          eq(legalEntities.id, legalEntityId),
          lte(fiscalPeriods.startDate, date),
          gte(fiscalPeriods.endDate, date),
        ),
      );
    return row ?? null;
  }

  /** One hash-chained audit entry for an event-depth mutation. */
  async log(
    tx: Tx,
    actor: RequestActor,
    e: Pick<EventRow, 'id' | 'legalEntityId'>,
    action: string,
    ctx: Pick<Ctx, 'requestId'>,
    changes: Record<string, { from: unknown; to: unknown }>,
    reason?: string | null,
  ): Promise<void> {
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action,
      resourceType: 'event',
      resourceId: e.id,
      legalEntityId: e.legalEntityId,
      requestId: ctx.requestId ?? null,
      reason: reason ?? null,
      changes,
    });
  }

  /** Refuses a change once reconciliation has started or the event is closed or cancelled. */
  assertOpen(e: EventRow, what: string): void {
    if (LOCKED_STATUSES.includes(e.status))
      throw new ApiProblem(
        409,
        'INVALID_TRANSITION',
        `${what} cannot change once the event is ${e.status.replace(/_/g, ' ')}.`,
      );
  }
}
