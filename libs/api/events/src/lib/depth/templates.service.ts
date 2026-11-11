import { ApiProblem, type CommandResult, type RequestActor } from '@bf/api/core';
import {
  eventAgendaItems,
  eventChecklists,
  eventCostLines,
  eventInvitations,
  eventLocations,
  eventQuoteRequests,
  eventQuotes,
  eventSeries,
  eventSurveys,
  eventTemplates,
  vendors,
  type Tx,
} from '@bf/api/db';
import { PostingSupport } from '@bf/api/spend';
import type {
  CloneEventBody,
  CreateEventBody,
  EventDetail,
  EventTemplate,
  EventTemplateList,
  RecurringSeriesBody,
  RecurringSeriesResult,
  UpsertEventTemplateBody,
} from '@bf/contracts';
import { toPostingBudget } from '@bf/api/ledger';
import { availableOf, generateSeriesOccurrences } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { EventsService, type Ctx, type EventRow } from '../events.service';
import { EventDepthSupport } from './event-depth.support';

type TemplateRow = typeof eventTemplates.$inferSelect;

const DEFAULT_INVITATION = {
  message: '',
  rsvpDeadlineDaysBefore: 4,
  capacity: null as number | null,
  waitlistEnabled: true,
};
const DEFAULT_NEEDS = {
  collectDietary: true,
  collectAccessibility: true,
  collectTravel: false,
  collectPhotoConsent: true,
};

const eventCode = () =>
  `EV-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Event templates, recurring series and clone (45a). None of these reserve or move money: a series
 * creates ordinary draft events, each with its own code, approval and funding, and a clone copies the
 * plan but never funding, contributions, commitments or actuals.
 */
@Injectable()
export class EventTemplatesService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly events: EventsService,
    private readonly posting: PostingSupport,
  ) {}

  /** Publishing a company template is a master-data change; personal templates belong to the organizer. */
  private assertCanPublishCompany(actor: RequestActor): void {
    const resource = { kind: 'tenant' as const, tenantId: actor.tenantId };
    const allowed =
      this.support.policy.can(actor, 'master_data.manage', resource).allowed ||
      this.support.policy.can(actor, 'tenant.settings.manage', resource).allowed;
    if (!allowed)
      throw ApiProblem.forbidden(
        'Only Finance Admin or Organization Admin can publish company templates.',
      );
  }

  private async views(tx: Tx, rows: TemplateRow[]): Promise<EventTemplate[]> {
    if (!rows.length) return [];
    const vendorIds = [...new Set(rows.flatMap((r) => r.preferredVendorIds ?? []))];
    const vendorRows = vendorIds.length
      ? await tx
          .select({ id: vendors.id, name: vendors.name, status: vendors.status })
          .from(vendors)
          .where(inArray(vendors.id, vendorIds))
      : [];
    const owners = await this.support.personNames(
      tx,
      rows.map((r) => r.ownerPersonId),
    );
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'company' | 'personal',
      status: r.status as 'draft' | 'published' | 'archived',
      ownerPersonId: r.ownerPersonId,
      ownerName: r.ownerPersonId ? (owners.get(r.ownerPersonId) ?? null) : null,
      name: r.name,
      category: r.category,
      eventType: r.eventType,
      typicalDuration: r.typicalDuration,
      locationType: r.locationType as 'office' | 'venue' | 'remote',
      estimatePerAttendee: { amountMinor: r.estimatePerAttendeeMinor, currency: r.currency },
      useLocationLimit: r.useLocationLimit,
      toleranceBps: r.toleranceBps,
      costSplitRule: r.costSplitRule as 'location' | 'legal_entity' | 'cost_center',
      checklistTasks: (r.checklistTasks ?? []) as EventTemplate['checklistTasks'],
      agendaItems: (r.agendaItems ?? []) as EventTemplate['agendaItems'],
      invitationDefaults: {
        ...DEFAULT_INVITATION,
        ...((r.invitationDefaults ?? {}) as Partial<EventTemplate['invitationDefaults']>),
      },
      needsConfig: {
        ...DEFAULT_NEEDS,
        ...((r.needsConfig ?? {}) as Partial<EventTemplate['needsConfig']>),
      },
      surveyQuestions: (r.surveyQuestions ?? []) as EventTemplate['surveyQuestions'],
      preferredVendors: (r.preferredVendorIds ?? [])
        .map((id) => vendorRows.find((v) => v.id === id))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map((v) => ({ id: v.id, name: v.name, status: v.status })),
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * Published company templates everyone can use, plus the actor's own personal templates; whoever
   * maintains master data also sees company drafts. Archived templates stay out of the library.
   */
  list(
    actor: RequestActor,
    scope: 'company' | 'personal' | 'all' = 'all',
  ): Promise<EventTemplateList> {
    // Templates carry per-attendee cost estimates: tenant data, so a member's read. A platform operator
    // without a break-glass grant is refused (not found), as everywhere else.
    this.support.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'tenant',
    );
    return this.support.read(actor, async (tx) => {
      const maintainsCompany = this.support.policy.can(actor, 'master_data.manage', {
        kind: 'tenant',
        tenantId: actor.tenantId,
      }).allowed;
      const visible = or(
        maintainsCompany
          ? eq(eventTemplates.scope, 'company')
          : and(eq(eventTemplates.scope, 'company'), eq(eventTemplates.status, 'published')),
        actor.personId
          ? and(
              eq(eventTemplates.scope, 'personal'),
              eq(eventTemplates.ownerPersonId, actor.personId),
            )
          : undefined,
      );
      const rows = await tx
        .select()
        .from(eventTemplates)
        .where(and(visible, scope === 'all' ? undefined : eq(eventTemplates.scope, scope)))
        .orderBy(asc(eventTemplates.scope), asc(eventTemplates.name));
      return {
        items: await this.views(
          tx,
          rows.filter((r) => r.status !== 'archived'),
        ),
      };
    });
  }

  async rowFor(tx: Tx, actor: RequestActor, templateId: string): Promise<TemplateRow> {
    const [row] = await tx.select().from(eventTemplates).where(eq(eventTemplates.id, templateId));
    if (!row) throw ApiProblem.notFound('template');
    const mine = Boolean(actor.personId && row.ownerPersonId === actor.personId);
    if (row.scope === 'personal' && !mine) throw ApiProblem.notFound('template');
    return row;
  }

  get(actor: RequestActor, templateId: string): Promise<EventTemplate> {
    return this.support.read(actor, async (tx) => {
      const row = await this.rowFor(tx, actor, templateId);
      return (await this.views(tx, [row]))[0];
    });
  }

  private valuesOf(actor: RequestActor, body: UpsertEventTemplateBody) {
    return {
      scope: body.scope,
      status: body.status,
      ownerPersonId: body.scope === 'personal' ? actor.personId : null,
      name: body.name,
      category: body.category,
      eventType: body.eventType,
      typicalDuration: body.typicalDuration,
      locationType: body.locationType,
      estimatePerAttendeeMinor: body.estimatePerAttendee.amountMinor,
      currency: body.estimatePerAttendee.currency,
      useLocationLimit: body.useLocationLimit,
      toleranceBps: body.toleranceBps,
      costSplitRule: body.costSplitRule,
      checklistTasks: body.checklistTasks ?? [],
      agendaItems: body.agendaItems ?? [],
      invitationDefaults: { ...DEFAULT_INVITATION, ...(body.invitationDefaults ?? {}) },
      needsConfig: { ...DEFAULT_NEEDS, ...(body.needsConfig ?? {}) },
      surveyQuestions: body.surveyQuestions ?? [],
      preferredVendorIds: body.preferredVendorIds ?? [],
    };
  }

  create(
    actor: RequestActor,
    body: UpsertEventTemplateBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventTemplate>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'events.template.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        if (body.scope === 'company') this.assertCanPublishCompany(actor);
        if (!actor.personId) throw ApiProblem.forbidden('Only people can save templates.');
        const [row] = await tx
          .insert(eventTemplates)
          .values({ tenantId: actor.tenantId, ...this.valuesOf(actor, body) })
          .returning();
        await this.support.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.template_created',
          resourceType: 'event_template',
          resourceId: row.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: row.name },
            scope: { from: null, to: row.scope },
            status: { from: null, to: row.status },
          },
        });
        return (await this.views(tx, [row]))[0];
      },
    );
  }

  update(
    actor: RequestActor,
    templateId: string,
    body: UpsertEventTemplateBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventTemplate>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.template.update:${templateId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const current = await this.rowFor(tx, actor, templateId);
        if (current.scope === 'company' || body.scope === 'company')
          this.assertCanPublishCompany(actor);
        if (current.status === 'archived')
          throw new ApiProblem(409, 'INVALID_TRANSITION', 'An archived template cannot change.');
        const [row] = await tx
          .update(eventTemplates)
          .set({
            ...this.valuesOf(actor, body),
            ownerPersonId:
              current.ownerPersonId ?? (body.scope === 'personal' ? actor.personId : null),
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(eventTemplates.id, templateId))
          .returning();
        await this.support.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.template_updated',
          resourceType: 'event_template',
          resourceId: row.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          changes: {
            status: { from: current.status, to: row.status },
            version: { from: current.version, to: row.version },
          },
        });
        return (await this.views(tx, [row]))[0];
      },
    );
  }

  archive(
    actor: RequestActor,
    templateId: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<EventTemplate>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.template.archive:${templateId}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const current = await this.rowFor(tx, actor, templateId);
        if (current.scope === 'company') this.assertCanPublishCompany(actor);
        const [row] = await tx
          .update(eventTemplates)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(eventTemplates.id, templateId))
          .returning();
        await this.support.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.template_archived',
          resourceType: 'event_template',
          resourceId: row.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: { status: { from: current.status, to: 'archived' } },
        });
        return (await this.views(tx, [row]))[0];
      },
    );
  }

  // Recurring series ------------------------------------------------------------------------------

  private async budgetAvailable(tx: Tx, budgetId: string) {
    const row = await this.posting.budget(tx, budgetId);
    if (!row) throw ApiProblem.notFound('budget');
    const balances = await this.posting.reads.balances(tx, [budgetId]);
    return {
      name: row.name,
      currency: row.currency,
      availableMinor: availableOf(
        balances.get(budgetId)!.budget,
        toPostingBudget(row).control.basis,
      ),
    };
  }

  /**
   * Previews or creates a recurring series (45a): every occurrence becomes its own draft event, up to
   * 12 months ahead. An occurrence whose date falls in a closed accounting period is reported in the
   * preview and refused on create with `EVENT_DATE_IN_CLOSED_PERIOD`.
   */
  async series(
    actor: RequestActor,
    body: RecurringSeriesBody,
    ctx: Ctx,
  ): Promise<CommandResult<RecurringSeriesResult>> {
    if (body.dryRun) {
      const preview = await this.support.read(actor, (tx) => this.previewSeries(tx, actor, body));
      return { status: 200, body: preview, replayed: false };
    }
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'events.series',
        request: body,
        status: 200,
      },
      async (tx) => {
        const preview = await this.previewSeries(tx, actor, body);
        const blocked = preview.occurrences.find((o) => o.blockedReason);
        if (blocked)
          throw new ApiProblem(
            409,
            'EVENT_DATE_IN_CLOSED_PERIOD',
            `${blocked.occurrenceDate} falls in ${blocked.fiscalPeriodLabel ?? 'a closed period'}, which is ${blocked.periodStatus}. Choose dates in an open period.`,
            { occurrenceDate: blocked.occurrenceDate },
          );
        if (!actor.personId) throw ApiProblem.forbidden('Only people can organize events.');
        const [series] = await tx
          .insert(eventSeries)
          .values({
            tenantId: actor.tenantId,
            name: body.name,
            templateId: body.templateId ?? null,
            organizerPersonId: actor.personId,
            frequency: body.frequency,
            firstDate: body.firstDate,
            endCount: body.endCount ?? null,
            endDate: body.endDate ?? null,
            customDates: body.customDates ?? [],
          })
          .returning();
        const template = body.templateId
          ? await this.rowFor(tx, actor, body.templateId)
          : undefined;
        const created: RecurringSeriesResult['occurrences'] = [];
        for (const o of preview.occurrences) {
          const detail = await this.events.createTx(
            tx,
            actor,
            {
              name: `${body.name} — ${o.occurrenceDate}`,
              eventType: body.eventType,
              homeBudgetId: body.homeBudgetId,
              eventCode: o.eventCode,
              startsAt: `${o.occurrenceDate}T09:00:00.000Z`,
              endsAt: `${o.occurrenceDate}T13:00:00.000Z`,
              toleranceBps: body.toleranceBps,
              ownFunds: { amountMinor: 0, currency: body.estimatePerOccurrence.currency },
              estimate: body.estimatePerOccurrence,
              locationOrgUnitIds: body.locationOrgUnitIds,
              ...(body.templateId ? { templateId: body.templateId } : {}),
            },
            { requestId: ctx.requestId, seriesId: series.id },
          );
          if (template) await this.applyTemplatePlan(tx, actor, detail.id, template);
          created.push({ ...o, createdEventId: detail.id });
        }
        await this.support.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.series_created',
          resourceType: 'event_series',
          resourceId: series.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: body.name },
            frequency: { from: null, to: body.frequency },
            occurrences: { from: null, to: created.map((o) => o.occurrenceDate) },
            eventIds: { from: null, to: created.map((o) => o.createdEventId) },
          },
        });
        return { ...preview, seriesId: series.id, dryRun: false, occurrences: created };
      },
    );
  }

  private async previewSeries(
    tx: Tx,
    actor: RequestActor,
    body: RecurringSeriesBody,
  ): Promise<RecurringSeriesResult> {
    const home = await this.posting.budget(tx, body.homeBudgetId);
    if (!home) throw ApiProblem.notFound('budget');
    this.support.policy.assert(
      actor,
      'event.manage',
      {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: home.id,
        path: home.path,
        orgUnitId: home.orgUnitId,
      },
      'budget',
    );
    if (body.estimatePerOccurrence.currency !== home.currency)
      throw new ApiProblem(
        422,
        'CURRENCY_MISMATCH',
        `Series amounts are in the home budget currency (${home.currency}).`,
      );
    const generated = generateSeriesOccurrences({
      frequency: body.frequency,
      firstDate: body.firstDate,
      endCount: body.endCount ?? null,
      endDate: body.endDate ?? null,
      customDates: body.customDates ?? [],
    });
    if (!generated.ok)
      throw new ApiProblem(
        422,
        generated.error.code,
        generated.error.message,
        generated.error.params,
      );
    const dates = generated.value;
    const available = await this.budgetAvailable(tx, home.id);
    const occurrences: RecurringSeriesResult['occurrences'] = [];
    for (const date of dates) {
      const period = await this.support.periodOn(tx, home.legalEntityId, date);
      const closed = period !== null && period.status !== 'open';
      occurrences.push({
        occurrenceDate: date,
        fiscalPeriodLabel: period?.label ?? null,
        periodStatus: period?.status ?? null,
        blockedReason: closed
          ? `${period.label} is ${period.status.replace(/_/g, ' ')}; an event cannot be dated there.`
          : null,
        eventCode: eventCode(),
        estimate: body.estimatePerOccurrence,
        createdEventId: null,
      });
    }
    const totalMinor = body.estimatePerOccurrence.amountMinor * occurrences.length;
    return {
      seriesId: null,
      dryRun: true,
      occurrences,
      totalEstimate: { amountMinor: totalMinor, currency: body.estimatePerOccurrence.currency },
      budgetAvailable: { amountMinor: available.availableMinor, currency: available.currency },
      budgetName: available.name,
      exceedsAvailableToday: totalMinor > available.availableMinor,
      hasBlockedOccurrences: occurrences.some((o) => o.blockedReason !== null),
    };
  }

  /** Copies a template's checklist, agenda, invitation text and survey onto a freshly created event. */
  async applyTemplatePlan(
    tx: Tx,
    actor: RequestActor,
    eventId: string,
    template: TemplateRow,
    startsAt?: Date | null,
  ): Promise<void> {
    const tasks = (template.checklistTasks ?? []) as {
      section: string;
      title: string;
      relativeDueDays: number;
      linkedItemType?: string | null;
      isSystem?: boolean;
    }[];
    if (tasks.length)
      await tx.insert(eventChecklists).values(
        tasks.map((t, i) => ({
          tenantId: actor.tenantId,
          eventId,
          section: t.section,
          title: t.title,
          dueDate: startsAt ? shiftDay(startsAt, t.relativeDueDays) : null,
          linkedItemType: t.linkedItemType ?? null,
          isSystem: Boolean(t.isSystem),
          sortOrder: i,
        })),
      );
    const agenda = (template.agendaItems ?? []) as {
      startTime: string;
      endTime?: string | null;
      title: string;
      locationRoom?: string | null;
      hostName?: string | null;
      notes?: string | null;
      visibleToInvitees?: boolean;
    }[];
    if (agenda.length)
      await tx.insert(eventAgendaItems).values(
        agenda.map((a, i) => ({
          tenantId: actor.tenantId,
          eventId,
          startTime: a.startTime,
          endTime: a.endTime ?? null,
          title: a.title,
          locationRoom: a.locationRoom ?? null,
          hostName: a.hostName ?? null,
          notes: a.notes ?? null,
          visibleToInvitees: a.visibleToInvitees ?? true,
          sortOrder: i,
        })),
      );
    const defaults = {
      ...DEFAULT_INVITATION,
      ...((template.invitationDefaults ?? {}) as Partial<typeof DEFAULT_INVITATION>),
    };
    await tx
      .insert(eventInvitations)
      .values({
        tenantId: actor.tenantId,
        eventId,
        message: defaults.message,
        capacity: defaults.capacity,
        waitlistEnabled: defaults.waitlistEnabled,
        collectTravelNeeds: Boolean(
          (template.needsConfig as { collectTravel?: boolean } | null)?.collectTravel,
        ),
      })
      .onConflictDoNothing();
    const questions = (template.surveyQuestions ?? []) as unknown[];
    if (questions.length)
      await tx
        .insert(eventSurveys)
        .values({ tenantId: actor.tenantId, eventId, questions })
        .onConflictDoNothing();
  }

  // Clone -----------------------------------------------------------------------------------------

  /** Clones an event into a new draft (45a): plans travel with it, money never does. */
  clone(
    actor: RequestActor,
    eventId: string,
    body: CloneEventBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventDetail>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.clone:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const source = await this.support.event(tx, actor, eventId, true);
        const startsAt = new Date(body.startsAt);
        const endsAt = body.endsAt
          ? new Date(body.endsAt)
          : new Date(
              startsAt.getTime() +
                Math.max(0, (source.endsAt?.getTime() ?? 0) - (source.startsAt?.getTime() ?? 0)),
            );
        const sourceLocations = await tx
          .select({ orgUnitId: eventLocations.orgUnitId })
          .from(eventLocations)
          .where(eq(eventLocations.eventId, source.id));
        const costLines = body.copyEstimate
          ? await tx
              .select()
              .from(eventCostLines)
              .where(eq(eventCostLines.eventId, source.id))
              .orderBy(asc(eventCostLines.lineNo))
          : [];
        const participantIds = body.copyParticipants
          ? (await this.support.participants(tx, source.id))
              .map((p) => p.personId)
              .filter((p): p is string => Boolean(p))
          : [];
        const create: CreateEventBody = {
          name: body.name,
          eventType: source.eventType,
          spendType: source.spendType,
          homeBudgetId: source.budgetId!,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          toleranceBps: source.toleranceBps,
          ownFunds: { amountMinor: 0, currency: source.currency },
          locationOrgUnitIds: sourceLocations.map((r) => r.orgUnitId),
          ...(body.copyDetailsAndLocations
            ? {
                ...(source.venue ? { venue: source.venue } : {}),
                ...(source.description ? { description: source.description } : {}),
                ...(source.expectedAttendance
                  ? { expectedAttendance: source.expectedAttendance }
                  : {}),
              }
            : {}),
          ...(body.copyEstimate
            ? {
                estimate: { amountMinor: source.estimateMinor, currency: source.currency },
                costLines: costLines.map((l) => ({
                  category: l.category,
                  description: l.description,
                  quantity: l.quantity,
                  unitCost: { amountMinor: l.unitCostMinor, currency: source.currency },
                })),
              }
            : {}),
          ...(participantIds.length ? { participantPersonIds: participantIds } : {}),
          ...(source.templateId ? { templateId: source.templateId } : {}),
        };
        const detail = await this.events.createTx(tx, actor, create, {
          requestId: ctx.requestId,
        });
        await this.copyPlan(tx, actor, source, detail, body, startsAt);
        await this.support.log(
          tx,
          actor,
          { id: detail.id, legalEntityId: source.legalEntityId },
          'event.cloned',
          ctx,
          {
            clonedFrom: { from: null, to: source.eventCode },
            copied: {
              from: null,
              to: {
                checklist: body.copyChecklist,
                agenda: body.copyAgenda,
                invitationText: body.copyInvitationText,
                survey: body.copySurvey,
                vendorShortlist: body.copyVendorShortlist,
                estimate: body.copyEstimate,
                participants: body.copyParticipants,
              },
            },
          },
        );
        return detail;
      },
    );
  }

  private async copyPlan(
    tx: Tx,
    actor: RequestActor,
    source: EventRow,
    target: EventDetail,
    body: CloneEventBody,
    startsAt: Date,
  ): Promise<void> {
    const fromEventId = source.id;
    const toEventId = target.id;
    if (body.copyChecklist) {
      const tasks = await tx
        .select()
        .from(eventChecklists)
        .where(eq(eventChecklists.eventId, fromEventId))
        .orderBy(asc(eventChecklists.sortOrder));
      if (tasks.length)
        await tx.insert(eventChecklists).values(
          tasks.map((t) => ({
            tenantId: actor.tenantId,
            eventId: toEventId,
            section: t.section,
            title: t.title,
            description: t.description,
            // Due dates keep their distance from the event day rather than their calendar date.
            dueDate:
              t.dueDate && source.startsAt
                ? shiftDay(startsAt, daysBetween(source.startsAt, t.dueDate))
                : null,
            reminder: t.reminder,
            linkedItemType: t.linkedItemType,
            isSystem: t.isSystem,
            sortOrder: t.sortOrder,
          })),
        );
    }
    if (body.copyAgenda) {
      const items = await tx
        .select()
        .from(eventAgendaItems)
        .where(eq(eventAgendaItems.eventId, fromEventId))
        .orderBy(asc(eventAgendaItems.sortOrder));
      if (items.length)
        await tx.insert(eventAgendaItems).values(
          items.map((a) => ({
            tenantId: actor.tenantId,
            eventId: toEventId,
            startTime: a.startTime,
            endTime: a.endTime,
            title: a.title,
            locationRoom: a.locationRoom,
            hostName: a.hostName,
            notes: a.notes,
            visibleToInvitees: a.visibleToInvitees,
            sortOrder: a.sortOrder,
          })),
        );
    }
    if (body.copyInvitationText) {
      const [inv] = await tx
        .select()
        .from(eventInvitations)
        .where(eq(eventInvitations.eventId, fromEventId));
      if (inv)
        await tx
          .insert(eventInvitations)
          .values({
            tenantId: actor.tenantId,
            eventId: toEventId,
            message: inv.message,
            capacity: inv.capacity,
            waitlistEnabled: inv.waitlistEnabled,
            autoPromoteWaitlist: inv.autoPromoteWaitlist,
            attachCalendarInvite: inv.attachCalendarInvite,
            collectTravelNeeds: inv.collectTravelNeeds,
          })
          .onConflictDoNothing();
    }
    if (body.copySurvey) {
      const [survey] = await tx
        .select()
        .from(eventSurveys)
        .where(eq(eventSurveys.eventId, fromEventId));
      if (survey)
        await tx
          .insert(eventSurveys)
          .values({
            tenantId: actor.tenantId,
            eventId: toEventId,
            questions: survey.questions,
            anonymous: survey.anonymous,
          })
          .onConflictDoNothing();
    }
    if (body.copyVendorShortlist) {
      const requests = await tx
        .select()
        .from(eventQuoteRequests)
        .where(eq(eventQuoteRequests.eventId, fromEventId))
        .orderBy(asc(eventQuoteRequests.createdAt));
      for (const r of requests) {
        const vendorIds = (
          await tx
            .selectDistinct({ vendorId: eventQuotes.vendorId })
            .from(eventQuotes)
            .where(eq(eventQuotes.quoteRequestId, r.id))
        ).map((q) => q.vendorId);
        if (!vendorIds.length) continue;
        const [copy] = await tx
          .insert(eventQuoteRequests)
          .values({
            tenantId: actor.tenantId,
            eventId: toEventId,
            title: r.title,
            category: r.category,
            description: r.description,
            quantity: r.quantity,
            includeDietaryCounts: r.includeDietaryCounts,
            emailed: false,
            createdByPersonId: actor.personId,
          })
          .returning();
        // The shortlist travels; prices never do, so each vendor starts at Requested again.
        await tx.insert(eventQuotes).values(
          vendorIds.map((vendorId) => ({
            tenantId: actor.tenantId,
            eventId: toEventId,
            quoteRequestId: copy.id,
            vendorId,
            status: 'requested',
            currency: target.currency,
            budgetCurrency: target.currency,
          })),
        );
      }
    }
  }
}

/** The ISO day `days` away from an event start date (negative counts back from the day). */
function shiftDay(from: Date, days: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from an event start date to an ISO day, negative before the event. */
function daysBetween(from: Date, isoDay: string): number {
  const start = Date.parse(`${from.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDay}T00:00:00Z`) - start) / 86_400_000);
}
