import { ApprovalsService, budgetResourceOf, personNames, type BudgetRow } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import { ContributionsService, IntercompanyService } from '@bf/api/contributions';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { DocumentsService } from '@bf/api/documents';
import {
  budgets,
  commitments,
  contributionRequests,
  costCenters,
  eventCoOrganizers,
  eventCostLines,
  eventLocations,
  eventParticipants,
  events,
  legalEntities,
  orgUnits,
  people,
  requests,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  CommitmentsService,
  FundingSourcesService,
  PostingSupport,
  RequestsService,
  SpendHooks,
  type FundingOutcome,
  type PostCtx,
  type SourceRow,
} from '@bf/api/spend';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  AddParticipantsBody,
  CloseEventResponse,
  CreateEventBody,
  CreateEventCommitmentBody,
  EventCommitment,
  EventDetail,
  EventList,
  EventParticipant,
  EventSummary,
  UpdateEventBody,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  contributionMachine,
  eventFunding,
  eventMachine,
  postContributionTransfer,
  postSpendMovement,
  remainingOf,
  splitEvenly,
  type CurrencyCode,
  type EventStatus,
} from '@bf/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { asFundingSource } from '@bf/api/spend';
import { EventCloseChecks } from './event-close-checks';

type EventRow = typeof events.$inferSelect;
/** `fixedId`: seed only, never exposed through the API. */
type Ctx = { idempotencyKey: string; requestId: string | null; fixedId?: string };

const LIFECYCLE: { status: EventStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'approved', label: 'Approved' },
  { status: 'funded', label: 'Funded' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'completed', label: 'Completed' },
  { status: 'reconciling', label: 'Reconciling' },
  { status: 'closed', label: 'Closed' },
];
const OPEN: EventStatus[] = ['draft', 'submitted', 'approved', 'funded', 'in_progress'];
const COMMITTABLE: EventStatus[] = ['approved', 'funded', 'in_progress'];

/**
 * Cross-location events: lifecycle, participants with employing entity and cost center, cost split
 * by location / entity / cost center, funding cap (own funds + contributions within estimate +
 * tolerance), commitments drawn pro rata from the funding sources, and close with surplus returned
 * to each source.
 */
@Injectable()
export class EventsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly posting: PostingSupport,
    private readonly sources: FundingSourcesService,
    private readonly commitmentsService: CommitmentsService,
    private readonly requests: RequestsService,
    private readonly contributions: ContributionsService,
    private readonly intercompany: IntercompanyService,
    private readonly approvals: ApprovalsService,
    private readonly documents: DocumentsService,
    private readonly analytics: AnalyticsService,
    private readonly hooks: SpendHooks,
    private readonly closeChecks: EventCloseChecks,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      fundingDecided: (tx, actor, eventId, outcome, kind) =>
        this.fundingDecided(tx, actor, eventId, outcome, kind),
    });
    this.closeChecks.register(async (tx, eventId) => {
      const missing = await this.intercompany.missingRecharges(tx, eventId);
      return missing > 0
        ? {
            code: 'EVENT_MISSING_RECHARGE',
            message:
              'Cross-entity contributions need their recharge approved before the event can close.',
            count: missing,
          }
        : null;
    });
    for (const type of ['event', 'commitment'] as const) {
      this.documents.registerOwner({
        type,
        canRead: async (tx, actor, id) => {
          const e = await this.eventFor(tx, type, id);
          return Boolean(e && (await this.canRead(tx, actor, e)));
        },
        canWrite: async (tx, actor, id) => {
          const e = await this.eventFor(tx, type, id);
          return Boolean(e && (await this.canManage(tx, actor, e)));
        },
      });
    }
  }

  private async eventFor(
    tx: Tx,
    type: 'event' | 'commitment',
    id: string,
  ): Promise<EventRow | undefined> {
    if (type === 'event') return this.row(tx, id);
    const [c] = await tx
      .select({ e: commitments.eventId })
      .from(commitments)
      .where(eq(commitments.id, id));
    return c?.e ? this.row(tx, c.e) : undefined;
  }

  private pc(actor: RequestActor, command: string, ctx: Partial<Ctx>): PostCtx {
    return {
      actor,
      command,
      requestId: ctx.requestId ?? null,
      idempotencyKey: ctx.idempotencyKey ?? null,
    };
  }

  private async row(tx: Tx, id: string, lock = false): Promise<EventRow | undefined> {
    const q = tx.select().from(events).where(eq(events.id, id));
    return (lock ? await q.for('update') : await q)[0];
  }

  private async home(tx: Tx, e: EventRow): Promise<BudgetRow | undefined> {
    return e.budgetId ? this.posting.budget(tx, e.budgetId) : undefined;
  }

  private async coOrganizers(tx: Tx, eventId: string): Promise<string[]> {
    return (
      await tx
        .select({ p: eventCoOrganizers.personId })
        .from(eventCoOrganizers)
        .where(eq(eventCoOrganizers.eventId, eventId))
    ).map((r) => r.p);
  }

  async canManage(tx: Tx, actor: RequestActor, e: EventRow): Promise<boolean> {
    if (!actor.personId) return false;
    if (e.organizerPersonId === actor.personId) return true;
    if ((await this.coOrganizers(tx, e.id)).includes(actor.personId)) return true;
    const home = await this.home(tx, e);
    return Boolean(
      home &&
        this.policy.can(actor, 'event.manage', budgetResourceOf(home)).allowed &&
        actor.ownedBudgetPaths.some((p) => home.path.startsWith(p)),
    );
  }

  async canRead(tx: Tx, actor: RequestActor, e: EventRow): Promise<boolean> {
    if (await this.contributions.canSeeEvent(tx, actor, e)) return true;
    if (!actor.personId) return false;
    const [p] = await tx
      .select({ id: eventParticipants.id })
      .from(eventParticipants)
      .where(
        and(eq(eventParticipants.eventId, e.id), eq(eventParticipants.personId, actor.personId)),
      );
    return Boolean(p);
  }

  private async visible(
    tx: Tx,
    actor: RequestActor,
    id: string,
    manage = false,
  ): Promise<EventRow> {
    const e = await this.row(tx, id);
    if (!e || !(await this.canRead(tx, actor, e))) throw ApiProblem.notFound('event');
    if (manage && !(await this.canManage(tx, actor, e)))
      throw ApiProblem.forbidden('Only the event’s organizers can do this.');
    return e;
  }

  // Lifecycle from funding decisions --------------------------------------------------------------

  private async fundedMinor(tx: Tx, eventId: string): Promise<number> {
    return (await this.sources.list(tx, eventId))
      .filter((s) => s.status !== 'cancelled')
      .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
  }

  private async setStatus(
    tx: Tx,
    e: EventRow,
    status: EventStatus,
    extra: Partial<typeof events.$inferInsert> = {},
  ) {
    await tx
      .update(events)
      .set({ status, updatedAt: new Date(), ...extra })
      .where(eq(events.id, e.id));
  }

  /** Spend hook: the own-funds request moves the event (approved, or back to draft); funding reaching the estimate marks it funded. */
  private async fundingDecided(
    tx: Tx,
    _actor: RequestActor,
    eventId: string,
    outcome: FundingOutcome,
    kind: 'budget' | 'additional_fund',
  ) {
    const e = (await this.row(tx, eventId, true))!;
    if (kind === 'budget') {
      if (outcome === 'approved' && e.status === 'submitted') {
        await this.setStatus(tx, e, unwrap(eventMachine.next(e.status, 'approve')));
        e.status = 'approved';
      } else if (outcome !== 'approved' && e.status === 'submitted') {
        await this.setStatus(tx, e, unwrap(eventMachine.next(e.status, 'reject')));
        return;
      }
    }
    if (
      outcome === 'approved' &&
      e.status === 'approved' &&
      (await this.fundedMinor(tx, e.id)) >= e.estimateMinor
    ) {
      await this.setStatus(tx, e, unwrap(eventMachine.next('approved', 'fund')));
    }
  }

  // Commands --------------------------------------------------------------------------------------

  private async validateUnits(tx: Tx, ids: readonly string[]) {
    if (!ids.length) return;
    const found = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(inArray(orgUnits.id, [...ids]));
    if (found.length !== new Set(ids).size)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'A location does not exist.', {
        field: 'locationOrgUnitIds',
      });
  }

  private costLineRows(
    tenantId: string,
    eventId: string,
    currency: string,
    lines: NonNullable<CreateEventBody['costLines']>,
  ): (typeof eventCostLines.$inferInsert)[] {
    return lines.map((l, i) => {
      if (l.unitCost.currency !== currency)
        throw new ApiProblem(
          422,
          'CURRENCY_MISMATCH',
          `Cost lines are in the event currency (${currency}).`,
          { field: `costLines.${i}.unitCost` },
        );
      const amount = l.unitCost.amountMinor * l.quantity;
      if (!Number.isSafeInteger(amount))
        throw new ApiProblem(422, 'AMOUNT_NOT_SAFE_INTEGER', 'A cost line is too large.');
      return {
        tenantId,
        eventId,
        lineNo: i + 1,
        category: l.category,
        description: l.description,
        quantity: l.quantity,
        unitCostMinor: l.unitCost.amountMinor,
        amountMinor: amount,
        currency,
      };
    });
  }

  private async participantRows(
    tx: Tx,
    tenantId: string,
    e: Pick<EventRow, 'id' | 'legalEntityId'>,
    personIds: readonly string[],
  ) {
    if (!personIds.length) return [];
    const ps = await tx
      .select()
      .from(people)
      .where(inArray(people.id, [...personIds]));
    if (ps.length !== new Set(personIds).size)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'A participant does not exist in the directory.',
        { field: 'personIds' },
      );
    for (const p of ps) {
      if (p.employingEntityId && p.employingEntityId !== e.legalEntityId) {
        const policy = await this.intercompany.policyFor(tx, e.legalEntityId, p.employingEntityId);
        if (policy.mode === 'block') {
          throw new ApiProblem(
            409,
            'INTERCOMPANY_BLOCKED',
            `${p.displayName} works for another legal entity and the intercompany policy blocks cross-entity costs.`,
            {
              personId: p.id,
            },
          );
        }
      }
    }
    return ps.map((p) => ({
      tenantId,
      eventId: e.id,
      personId: p.id,
      isEmployee: true,
      employingEntityId: p.employingEntityId,
      costCenterId: p.costCenterId,
      locationOrgUnitId: p.locationOrgUnitId,
    }));
  }

  create(
    actor: RequestActor,
    body: CreateEventBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'events.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden('Only people can organize events.');
        const home = await this.posting.budget(tx, body.homeBudgetId);
        if (!home) throw ApiProblem.notFound('budget');
        this.policy.assert(actor, 'event.manage', budgetResourceOf(home), 'budget');
        if (body.endsAt < body.startsAt)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The event ends before it starts.', {
            field: 'endsAt',
          });
        await this.validateUnits(tx, body.locationOrgUnitIds);
        const currency = home.currency;
        if (
          body.ownFunds.currency !== currency ||
          (body.estimate && body.estimate.currency !== currency)
        ) {
          throw new ApiProblem(
            422,
            'CURRENCY_MISMATCH',
            `Event amounts are in the home budget currency (${currency}).`,
          );
        }
        const id =
          ctx.fixedId ??
          (await tx.execute<{ id: string }>(sql`select gen_random_uuid() as id`)).rows[0].id;
        const lines = this.costLineRows(actor.tenantId, id, currency, body.costLines ?? []);
        const estimate =
          body.estimate?.amountMinor ?? lines.reduce((a, l) => a + (l.amountMinor as number), 0);
        if (estimate <= 0)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Give an estimate or cost lines.', {
            field: 'estimate',
          });
        const ceiling = estimate + Math.floor((estimate * body.toleranceBps) / 10_000);
        if (body.ownFunds.amountMinor < 0 || body.ownFunds.amountMinor > ceiling)
          throw new ApiProblem(
            422,
            'FUNDING_CAP_EXCEEDED',
            'Own funds cannot be more than the estimate plus its tolerance.',
            { field: 'ownFunds', ceilingMinor: ceiling },
          );
        const code =
          body.eventCode ??
          `EV-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const [dup] = await tx
          .select({ id: events.id })
          .from(events)
          .where(eq(events.eventCode, code));
        if (dup)
          throw new ApiProblem(409, 'DUPLICATE_CODE', 'Another event uses this event code.', {
            field: 'eventCode',
          });
        const [e] = await tx
          .insert(events)
          .values({
            id,
            tenantId: actor.tenantId,
            name: body.name,
            eventType: body.eventType,
            spendType: body.spendType ?? 'employee_events',
            organizerPersonId: actor.personId,
            legalEntityId: home.legalEntityId,
            costCenterId: body.costCenterId ?? home.costCenterId,
            eventCode: code,
            budgetId: home.id,
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
            venue: body.venue ?? null,
            description: body.description ?? null,
            expectedAttendance: body.expectedAttendance ?? null,
            estimateMinor: estimate,
            currency,
            toleranceBps: body.toleranceBps,
            ownFundsMinor: body.ownFunds.amountMinor,
            perHeadLimitMinor: body.perHeadLimit?.amountMinor ?? null,
          })
          .returning();
        await tx.insert(eventLocations).values(
          [...new Set(body.locationOrgUnitIds)].map((orgUnitId) => ({
            tenantId: actor.tenantId,
            eventId: id,
            orgUnitId,
          })),
        );
        if (lines.length) await tx.insert(eventCostLines).values(lines);
        const co = [...new Set(body.coOrganizerPersonIds ?? [])].filter(
          (p) => p !== actor.personId,
        );
        if (co.length)
          await tx
            .insert(eventCoOrganizers)
            .values(co.map((personId) => ({ tenantId: actor.tenantId, eventId: id, personId })));
        const parts = await this.participantRows(tx, actor.tenantId, e, [
          ...new Set(body.participantPersonIds ?? []),
        ]);
        if (parts.length) await tx.insert(eventParticipants).values(parts);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.created',
          resourceType: 'event',
          resourceId: id,
          legalEntityId: home.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: body.name },
            eventCode: { from: null, to: code },
            homeBudgetId: { from: null, to: home.id },
            estimate: { from: null, to: { amountMinor: estimate, currency } },
            ownFunds: { from: null, to: body.ownFunds },
            participants: { from: null, to: parts.length },
          },
        });
        return this.detailTx(tx, actor, id);
      },
    );
  }

  update(
    actor: RequestActor,
    id: string,
    body: UpdateEventBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.update:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        if (e.status !== 'draft')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Only draft events can be edited; ask for more funds or contributions instead.',
          );
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const patch: Partial<typeof events.$inferInsert> = {
          version: e.version + 1,
          updatedAt: new Date(),
        };
        for (const k of [
          'name',
          'eventType',
          'venue',
          'description',
          'expectedAttendance',
          'toleranceBps',
        ] as const) {
          if (body[k] !== undefined) {
            (patch as Record<string, unknown>)[k] = body[k];
            changes[k] = { from: e[k], to: body[k] };
          }
        }
        if (body.startsAt) patch.startsAt = new Date(body.startsAt);
        if (body.endsAt) patch.endsAt = new Date(body.endsAt);
        if (body.costLines) {
          await tx.delete(eventCostLines).where(eq(eventCostLines.eventId, e.id));
          const lines = this.costLineRows(actor.tenantId, e.id, e.currency, body.costLines);
          if (lines.length) await tx.insert(eventCostLines).values(lines);
          if (!body.estimate)
            patch.estimateMinor = lines.reduce((a, l) => a + (l.amountMinor as number), 0);
        }
        if (body.estimate) {
          if (body.estimate.currency !== e.currency)
            throw new ApiProblem(422, 'CURRENCY_MISMATCH', `Use ${e.currency}.`);
          patch.estimateMinor = body.estimate.amountMinor;
        }
        if (body.ownFunds) {
          if (body.ownFunds.currency !== e.currency)
            throw new ApiProblem(422, 'CURRENCY_MISMATCH', `Use ${e.currency}.`);
          patch.ownFundsMinor = body.ownFunds.amountMinor;
          changes['ownFunds'] = { from: e.ownFundsMinor, to: body.ownFunds.amountMinor };
        }
        if (patch.estimateMinor !== undefined)
          changes['estimate'] = { from: e.estimateMinor, to: patch.estimateMinor };
        if (body.locationOrgUnitIds) {
          await this.validateUnits(tx, body.locationOrgUnitIds);
          await tx.delete(eventLocations).where(eq(eventLocations.eventId, e.id));
          await tx.insert(eventLocations).values(
            [...new Set(body.locationOrgUnitIds)].map((orgUnitId) => ({
              tenantId: actor.tenantId,
              eventId: e.id,
              orgUnitId,
            })),
          );
          changes['locations'] = { from: null, to: body.locationOrgUnitIds.length };
        }
        await tx.update(events).set(patch).where(eq(events.id, e.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.updated',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          changes,
        });
        return this.detailTx(tx, actor, e.id);
      },
    );
  }

  submit(actor: RequestActor, id: string, ctx: Ctx): Promise<CommandResult<EventDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.submit:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const e = (await this.visible(tx, actor, id, true)) as EventRow;
        const next = unwrap(eventMachine.next(e.status, 'submit'));
        const home = (await this.home(tx, e))!;
        await this.setStatus(tx, e, next, { submittedAt: new Date() });
        let requestId: string | null = null;
        if (e.ownFundsMinor > 0) {
          requestId = await this.requests.createEventBudgetRequest(
            tx,
            actor,
            {
              eventId: e.id,
              budget: home,
              amount: { amountMinor: e.ownFundsMinor, currency: e.currency as CurrencyCode },
              title: `Event budget: ${e.name}`,
              purpose: e.description ?? `Own funds for ${e.name} (${e.eventCode})`,
              spendType: e.spendType,
            },
            ctx,
          );
        } else {
          await this.setStatus(
            tx,
            { ...e, status: next },
            unwrap(eventMachine.next(next, 'approve')),
          );
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.submitted',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            status: { from: e.status, to: next },
            ownFunds: { from: null, to: { amountMinor: e.ownFundsMinor, currency: e.currency } },
            ...(requestId ? { ownFundsRequestId: { from: null, to: requestId } } : {}),
          },
        });
        await this.analytics.track(tx, actor, 'event.submitted', {
          participants: (await this.participantsOf(tx, e.id)).length,
        });
        return this.detailTx(tx, actor, e.id);
      },
    );
  }

  private transition(
    actor: RequestActor,
    id: string,
    verb: 'start' | 'complete' | 'confirm_funding',
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<EventDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.${verb}:${id}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        if (verb === 'start' && e.status === 'approved')
          throw new ApiProblem(
            409,
            'EVENT_NOT_FUNDED',
            'Confirm the funding before the event starts.',
          );
        const next = unwrap(
          eventMachine.next(e.status, verb === 'confirm_funding' ? 'fund' : verb),
        );
        await this.setStatus(tx, e, next);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action:
            verb === 'start'
              ? 'event.started'
              : verb === 'complete'
                ? 'event.completed'
                : 'event.funding_confirmed',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: { status: { from: e.status, to: next } },
        });
        return this.detailTx(tx, actor, e.id);
      },
    );
  }

  start(actor: RequestActor, id: string, reason: string | undefined, ctx: Ctx) {
    return this.transition(actor, id, 'start', reason, ctx);
  }
  complete(actor: RequestActor, id: string, reason: string | undefined, ctx: Ctx) {
    return this.transition(actor, id, 'complete', reason, ctx);
  }
  confirmFunding(actor: RequestActor, id: string, reason: string | undefined, ctx: Ctx) {
    return this.transition(actor, id, 'confirm_funding', reason, ctx);
  }

  /** Releases open commitments to their sources, then returns what each source still holds (in the consumption order: pro rata). */
  private async returnFunding(tx: Tx, actor: RequestActor, e: EventRow, pc: PostCtx) {
    const open = await tx
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(
          eq(commitments.eventId, e.id),
          inArray(commitments.status, ['encumbered', 'partially_consumed']),
          sql`${commitments.requestId} is null`,
        ),
      );
    const journalIds: string[] = [];
    for (const c of open)
      journalIds.push(...(await this.commitmentsService.release(tx, pc, c.id)).journalIds);
    const srcs = await this.sources.list(tx, e.id, { lock: true });
    const locked = await this.posting.lock(tx, [
      ...new Set(srcs.flatMap((s) => [s.budgetId, s.originBudgetId])),
    ]);
    const returns: CloseEventResponse['surplusReturns'] = [];
    for (const s of srcs) {
      const left = remainingOf(asFundingSource(s));
      if (s.status !== 'active') continue;
      if (left > 0) {
        const holder = locked.get(s.budgetId)!;
        const ctx = await this.posting.context(tx, holder, actor.reportingCurrency);
        const prov = {
          eventId: e.id,
          contributionId: s.contributionRequestId,
          requestId: s.requestId,
        };
        const amount = { amountMinor: left, currency: s.currency as CurrencyCode };
        const rel = unwrap(
          postSpendMovement(
            {
              kind: 'release_hold',
              budget: holder,
              amount,
              journalType: 'surplus_return',
              provenance: prov,
              reason: `Surplus returned from ${e.name}`,
            },
            ctx,
          ),
        );
        journalIds.push(...(await this.posting.post(tx, rel.journals, holder.fiscalYearId, pc)));
        if (s.mode === 'transfer' && s.originBudgetId !== s.budgetId) {
          const origin = locked.get(s.originBudgetId)!;
          const back = unwrap(
            postContributionTransfer(
              {
                giver: {
                  ...holder,
                  balances: { ...holder.balances, held: holder.balances.held - left },
                },
                receiver: origin,
                amount,
                provenance: prov,
                reason: `Surplus of ${e.name} returned to the contributor`,
              },
              ctx,
            ),
          );
          journalIds.push(
            ...(await this.posting.post(tx, [back.journal], holder.fiscalYearId, pc)),
          );
        }
        returns.push({
          sourceId: s.id,
          budgetId: s.originBudgetId,
          budgetName: locked.get(s.originBudgetId)!.row.name,
          amount,
        });
      }
      await this.sources.adjust(tx, s.id, { returnedMinor: left, status: 'returned' });
    }
    const settled = await tx
      .select()
      .from(contributionRequests)
      .where(
        and(
          eq(contributionRequests.eventId, e.id),
          inArray(contributionRequests.status, ['earmarked', 'transferred']),
        ),
      );
    for (const c of settled) {
      await tx
        .update(contributionRequests)
        .set({
          status: unwrap(contributionMachine.next(c.status, 'settle')),
          updatedAt: new Date(),
        })
        .where(eq(contributionRequests.id, c.id));
    }
    return { journalIds, returns };
  }

  close(
    actor: RequestActor,
    id: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<CloseEventResponse>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.close:${id}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        let status = e.status;
        if (status === 'completed') status = unwrap(eventMachine.next(status, 'reconcile'));
        const closed = unwrap(eventMachine.next(status, 'close'));
        const block = await this.closeChecks.run(tx, e.id);
        if (block) throw new ApiProblem(409, block.code, block.message, { count: block.count });
        const { journalIds, returns } = await this.returnFunding(
          tx,
          actor,
          e,
          this.pc(actor, 'events.close', ctx),
        );
        await this.setStatus(tx, e, closed, { closedAt: new Date() });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.closed',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: {
            status: { from: e.status, to: closed },
            surplusReturns: {
              from: null,
              to: returns.map((r) => ({
                sourceId: r.sourceId,
                budgetId: r.budgetId,
                amount: r.amount,
              })),
            },
            journalIds: { from: null, to: journalIds },
          },
        });
        return { event: await this.detailTx(tx, actor, e.id), surplusReturns: returns };
      },
    );
  }

  cancel(
    actor: RequestActor,
    id: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<EventDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.cancel:${id}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        const next = unwrap(eventMachine.next(e.status, 'cancel'));
        const pending = await tx
          .select()
          .from(requests)
          .where(
            and(
              eq(requests.eventId, e.id),
              inArray(requests.status, ['submitted', 'pending_approval', 'changes_requested']),
            ),
          );
        const pc = this.pc(actor, 'events.cancel', ctx);
        await this.setStatus(tx, e, next, { cancelReason: reason ?? 'Cancelled by the organizer' });
        if (pending.length)
          await this.requests.cancelWaitingForEvent(tx, actor, e.id, 'event cancelled');
        const waiting = await tx
          .select()
          .from(contributionRequests)
          .where(
            and(
              eq(contributionRequests.eventId, e.id),
              inArray(contributionRequests.status, [
                'submitted',
                'pending_approval',
                'changes_requested',
              ]),
            ),
          );
        for (const c of waiting) {
          await this.approvals.cancelFor(tx, 'contribution', c.id);
          await tx
            .update(contributionRequests)
            .set({ status: 'cancelled', cancelReason: 'Event cancelled', updatedAt: new Date() })
            .where(eq(contributionRequests.id, c.id));
        }
        const { journalIds, returns } = await this.returnFunding(tx, actor, e, pc);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.cancelled',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: {
            status: { from: e.status, to: next },
            returned: { from: null, to: returns.length },
            journalIds: { from: null, to: journalIds },
          },
        });
        return this.detailTx(tx, actor, e.id);
      },
    );
  }

  addParticipants(
    actor: RequestActor,
    id: string,
    body: AddParticipantsBody,
    ctx: Ctx,
  ): Promise<CommandResult<{ items: EventParticipant[] }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.participants:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        if (!OPEN.includes(e.status))
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Participants can change only while the event is open.',
          );
        const existing = new Set((await this.participantsOf(tx, e.id)).map((p) => p.personId));
        const rows = await this.participantRows(
          tx,
          actor.tenantId,
          e,
          [...new Set(body.personIds ?? [])].filter((p) => !existing.has(p)),
        );
        const guests = (body.guests ?? []).map((g) => ({
          tenantId: actor.tenantId,
          eventId: e.id,
          personId: null,
          guestName: g.name,
          isEmployee: false,
          employingEntityId: g.employingEntityId ?? null,
          costCenterId: g.costCenterId ?? null,
          locationOrgUnitId: g.locationOrgUnitId ?? null,
        }));
        if (rows.length + guests.length)
          await tx.insert(eventParticipants).values([...rows, ...guests]);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.participants_added',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          changes: { added: { from: null, to: rows.length + guests.length } },
        });
        return { items: await this.participantViews(tx, e) };
      },
    );
  }

  removeParticipant(
    actor: RequestActor,
    id: string,
    participantId: string,
    ctx: Ctx,
  ): Promise<CommandResult<{ items: EventParticipant[] }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.participant_remove:${participantId}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        if (!OPEN.includes(e.status))
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Participants can change only while the event is open.',
          );
        const [p] = await tx
          .select()
          .from(eventParticipants)
          .where(and(eq(eventParticipants.id, participantId), eq(eventParticipants.eventId, e.id)));
        if (!p) throw ApiProblem.notFound('participant');
        await tx.delete(eventParticipants).where(eq(eventParticipants.id, p.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.participant_removed',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          changes: { participantId: { from: p.id, to: null } },
        });
        return { items: await this.participantViews(tx, e) };
      },
    );
  }

  commit(
    actor: RequestActor,
    id: string,
    body: CreateEventCommitmentBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventCommitment>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.commit:${id}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        if (!COMMITTABLE.includes(e.status))
          throw new ApiProblem(
            409,
            'EVENT_NOT_FUNDED',
            'Commit spend once the event budget is approved.',
          );
        const locked = (await this.row(tx, e.id, true))!;
        const srcs = await this.sources.list(tx, e.id, { lock: true });
        const funding = await this.funding(tx, locked, srcs);
        const res = await this.commitmentsService.createForEvent(
          tx,
          this.pc(actor, 'events.commit', ctx),
          {
            event: {
              id: e.id,
              budgetId: e.budgetId,
              currency: e.currency,
              legalEntityId: e.legalEntityId,
              costCenterId: e.costCenterId,
              eventCode: e.eventCode,
            },
            sources: srcs,
            description: body.description,
            vendorId: body.vendorId ?? null,
            amount: {
              amountMinor: body.amount.amountMinor,
              currency: body.amount.currency as CurrencyCode,
            },
            serviceStart: body.serviceStart ?? null,
            serviceEnd: body.serviceEnd ?? null,
          },
        );
        if (funding.committedMinor + res.budgetAmount.amountMinor > funding.capMinor) {
          throw new ApiProblem(
            409,
            'FUNDING_CAP_EXCEEDED',
            'This would take the event above its funding cap.',
            {
              capMinor: funding.capMinor,
              committedMinor: funding.committedMinor,
              requestedMinor: res.budgetAmount.amountMinor,
            },
          );
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.commitment_created',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            commitmentId: { from: null, to: res.commitmentId },
            amount: { from: null, to: body.amount },
            budgetAmount: { from: null, to: res.budgetAmount },
            journalIds: { from: null, to: res.journalIds },
          },
        });
        const [view] = await this.commitmentsService.views(tx, [
          (await this.commitmentsService.row(tx, res.commitmentId))!,
        ]);
        return view;
      },
    );
  }

  releaseCommitment(
    actor: RequestActor,
    id: string,
    commitmentId: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<EventCommitment>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.release:${commitmentId}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const e = await this.visible(tx, actor, id, true);
        const c = await this.commitmentsService.row(tx, commitmentId);
        if (!c || c.eventId !== e.id) throw ApiProblem.notFound('commitment');
        await this.sources.list(tx, e.id, { lock: true });
        const res = await this.commitmentsService.release(
          tx,
          this.pc(actor, 'events.release', ctx),
          commitmentId,
        );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.commitment_released',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: {
            commitmentId: { from: null, to: commitmentId },
            released: { from: null, to: res.releasedBudgetMinor },
            journalIds: { from: null, to: res.journalIds },
          },
        });
        const [view] = await this.commitmentsService.views(tx, [
          (await this.commitmentsService.row(tx, commitmentId))!,
        ]);
        return view;
      },
    );
  }

  // Reads -----------------------------------------------------------------------------------------

  private async participantsOf(tx: Tx, eventId: string) {
    return tx
      .select()
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))
      .orderBy(asc(eventParticipants.createdAt));
  }

  private async funding(tx: Tx, e: EventRow, srcs?: SourceRow[]) {
    const sources = srcs ?? (await this.sources.list(tx, e.id));
    const own = sources
      .filter((s) => s.kind === 'own' && s.status !== 'cancelled')
      .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
    const contrib = sources
      .filter((s) => s.kind === 'contribution' && s.status !== 'cancelled')
      .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
    const committed = sources
      .filter((s) => s.status === 'active')
      .reduce((a, s) => a + s.consumedMinor, 0);
    const pending =
      (await this.requests.pendingFunding(tx, e.id)) +
      (await this.contributions.pendingContributions(tx, e.id));
    return eventFunding({
      estimateMinor: e.estimateMinor,
      toleranceBps: e.toleranceBps,
      ownFundsMinor: own,
      contributionsMinor: contrib,
      pendingMinor: pending,
      committedMinor: committed,
    });
  }

  private async participantViews(tx: Tx, e: EventRow): Promise<EventParticipant[]> {
    const parts = await this.participantsOf(tx, e.id);
    const funding = await this.funding(tx, e);
    const base = funding.capMinor > 0 ? funding.capMinor : e.estimateMinor;
    const shares = parts.length ? unwrap(splitEvenly(base, parts.length)) : [];
    const ps = parts.filter((p) => p.personId).length
      ? await tx
          .select()
          .from(people)
          .where(
            inArray(
              people.id,
              parts.map((p) => p.personId).filter((x): x is string => Boolean(x)),
            ),
          )
      : [];
    const entities = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (x) => [x.id, x.name],
      ),
    );
    const ccIds = parts.map((p) => p.costCenterId).filter((x): x is string => Boolean(x));
    const ccs = ccIds.length
      ? new Map(
          (
            await tx
              .select({ id: costCenters.id, code: costCenters.code })
              .from(costCenters)
              .where(inArray(costCenters.id, ccIds))
          ).map((c) => [c.id, c.code]),
        )
      : new Map<string, string>();
    const unitIds = parts.map((p) => p.locationOrgUnitId).filter((x): x is string => Boolean(x));
    const units = unitIds.length
      ? new Map(
          (
            await tx
              .select({ id: orgUnits.id, name: orgUnits.name })
              .from(orgUnits)
              .where(inArray(orgUnits.id, unitIds))
          ).map((u) => [u.id, u.name]),
        )
      : new Map<string, string>();
    return parts.map((p, i) => {
      const person = ps.find((x) => x.id === p.personId);
      return {
        id: p.id,
        personId: p.personId,
        name: person?.displayName ?? p.guestName ?? 'Guest',
        jobTitle: person?.jobTitle ?? null,
        isEmployee: p.isEmployee,
        employingEntityId: p.employingEntityId,
        employingEntityName: p.employingEntityId
          ? (entities.get(p.employingEntityId) ?? null)
          : null,
        costCenterId: p.costCenterId,
        costCenterCode: p.costCenterId ? (ccs.get(p.costCenterId) ?? null) : null,
        locationOrgUnitId: p.locationOrgUnitId,
        locationName: p.locationOrgUnitId ? (units.get(p.locationOrgUnitId) ?? null) : null,
        rsvpStatus: p.rsvpStatus,
        attendanceStatus: p.attendanceStatus,
        costShare: { amountMinor: shares[i] ?? 0, currency: e.currency },
        intercompany: Boolean(p.employingEntityId && p.employingEntityId !== e.legalEntityId),
        missingCostCenter: !p.costCenterId,
      };
    });
  }

  participants(actor: RequestActor, id: string): Promise<{ items: EventParticipant[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const e = await this.visible(tx, actor, id);
      return { items: await this.participantViews(tx, e) };
    });
  }

  private split(
    participants: EventParticipant[],
    dimension: 'location' | 'legal_entity' | 'cost_center',
    currency: string,
    eventEntity: string,
  ) {
    const groups = new Map<
      string,
      { id: string | null; name: string; n: number; amount: number; intercompany: boolean }
    >();
    for (const p of participants) {
      const [id, name] =
        dimension === 'location'
          ? [p.locationOrgUnitId, p.locationName ?? 'No location']
          : dimension === 'legal_entity'
            ? [p.employingEntityId, p.employingEntityName ?? 'No entity']
            : [p.costCenterId, p.costCenterCode ?? 'Missing cost center'];
      const key = id ?? 'none';
      const g = groups.get(key) ?? {
        id,
        name,
        n: 0,
        amount: 0,
        intercompany: dimension === 'legal_entity' && Boolean(id && id !== eventEntity),
      };
      g.n += 1;
      g.amount += p.costShare.amountMinor;
      groups.set(key, g);
    }
    const total = participants.length;
    return [...groups.values()].map((g) => ({
      dimension,
      id: g.id,
      name: g.name,
      participants: g.n,
      shareBps: total ? Math.round((g.n * 10_000) / total) : 0,
      amount: { amountMinor: g.amount, currency },
      intercompany: g.intercompany,
    }));
  }

  private async summariesOf(tx: Tx, rows: EventRow[]): Promise<EventSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const homes = await tx
      .select({ id: budgets.id, name: budgets.name })
      .from(budgets)
      .where(inArray(budgets.id, rows.map((r) => r.budgetId!).filter(Boolean)));
    const names = await personNames(
      tx,
      rows.map((r) => r.organizerPersonId),
    );
    const counts = await tx
      .select({ e: eventParticipants.eventId, n: sql<number>`count(*)` })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, ids))
      .groupBy(eventParticipants.eventId);
    const locs = await tx
      .select({ e: eventLocations.eventId, name: orgUnits.name })
      .from(eventLocations)
      .innerJoin(orgUnits, eq(orgUnits.id, eventLocations.orgUnitId))
      .where(inArray(eventLocations.eventId, ids));
    const pend = await tx
      .select({ e: contributionRequests.eventId, n: sql<number>`count(*)` })
      .from(contributionRequests)
      .where(
        and(
          inArray(contributionRequests.eventId, ids),
          inArray(contributionRequests.status, ['submitted', 'pending_approval']),
        ),
      )
      .groupBy(contributionRequests.eventId);
    const out: EventSummary[] = [];
    for (const e of rows) {
      const f = await this.funding(tx, e);
      const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
      out.push({
        id: e.id,
        name: e.name,
        eventCode: e.eventCode,
        eventType: e.eventType,
        status: e.status,
        startsAt: e.startsAt?.toISOString() ?? null,
        endsAt: e.endsAt?.toISOString() ?? null,
        venue: e.venue,
        organizerPersonId: e.organizerPersonId,
        organizerName: names.get(e.organizerPersonId) ?? '',
        homeBudgetId: e.budgetId!,
        homeBudgetName: homes.find((h) => h.id === e.budgetId)?.name ?? '',
        legalEntityId: e.legalEntityId,
        currency: e.currency,
        estimate: m(e.estimateMinor),
        cap: m(f.capMinor),
        funded: m(f.ownFundsMinor + f.contributionsMinor),
        committed: m(f.committedMinor),
        pendingContributions: Number(pend.find((p) => p.e === e.id)?.n ?? 0),
        participantCount: Number(counts.find((c) => c.e === e.id)?.n ?? 0),
        locationNames: locs.filter((l) => l.e === e.id).map((l) => l.name),
        fullyFunded: f.fullyFunded,
      });
    }
    return out;
  }

  /** Events the viewer organizes, attends, funds, or may see through budget scope. */
  private async visibleRows(
    tx: Tx,
    actor: RequestActor,
    filters: SQL[] = [],
    limit = 100,
  ): Promise<EventRow[]> {
    const tenantWide = this.policy.can(actor, 'budget.read', {
      kind: 'budget',
      tenantId: actor.tenantId,
      id: '',
      path: '/',
    }).allowed;
    const scope: SQL[] = [];
    if (!tenantWide) {
      if (actor.personId) {
        scope.push(eq(events.organizerPersonId, actor.personId));
        scope.push(
          inArray(
            events.id,
            tx
              .select({ e: eventCoOrganizers.eventId })
              .from(eventCoOrganizers)
              .where(eq(eventCoOrganizers.personId, actor.personId)),
          ),
        );
        scope.push(
          inArray(
            events.id,
            tx
              .select({ e: eventParticipants.eventId })
              .from(eventParticipants)
              .where(eq(eventParticipants.personId, actor.personId)),
          ),
        );
      }
      if (actor.ownedBudgetPaths.length) {
        const owned = tx
          .select({ id: budgets.id })
          .from(budgets)
          .where(or(...actor.ownedBudgetPaths.map((p) => like(budgets.path, `${p}%`))));
        scope.push(inArray(events.budgetId, owned));
        scope.push(
          inArray(
            events.id,
            tx
              .select({ e: contributionRequests.eventId })
              .from(contributionRequests)
              .where(inArray(contributionRequests.giverBudgetId, owned)),
          ),
        );
      }
      if (!scope.length) return [];
    }
    const where = [...filters, ...(scope.length ? [or(...scope)!] : [])];
    return tx
      .select()
      .from(events)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(events.startsAt), desc(events.createdAt))
      .limit(limit);
  }

  list(
    actor: RequestActor,
    q: { status?: EventStatus; q?: string; cofunded?: 'true' | 'false'; limit?: number },
  ): Promise<EventList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const filters: SQL[] = [];
      if (q.status) filters.push(eq(events.status, q.status));
      if (q.q)
        filters.push(
          or(like(events.name, `%${q.q}%`), like(events.eventCode, `%${q.q.toUpperCase()}%`))!,
        );
      if (q.cofunded === 'true')
        filters.push(
          inArray(
            events.id,
            tx.select({ e: contributionRequests.eventId }).from(contributionRequests),
          ),
        );
      const rows = await this.visibleRows(tx, actor, filters, q.limit ?? 100);
      return { items: await this.summariesOf(tx, rows), nextCursor: null };
    });
  }

  get(actor: RequestActor, id: string): Promise<EventDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detailTx(tx, actor, id),
    );
  }

  async detailTx(tx: Tx, actor: RequestActor, id: string): Promise<EventDetail> {
    const e = await this.visible(tx, actor, id);
    const [summary] = await this.summariesOf(tx, [e]);
    const srcs = await this.sources.list(tx, e.id);
    const f = await this.funding(tx, e, srcs);
    const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
    const budgetsById = new Map(
      (srcs.length
        ? await tx
            .select()
            .from(budgets)
            .where(
              inArray(budgets.id, [
                ...new Set(srcs.flatMap((s) => [s.budgetId, s.originBudgetId])),
              ]),
            )
        : []
      ).map((b) => [b.id, b]),
    );
    const owners = await personNames(
      tx,
      [...budgetsById.values()].map((b) => b.ownerPersonId),
    );
    const contribRows = await this.contributions.forEvents(tx, [e.id]);
    const givers = await this.contributions.giverInfo(tx, contribRows);
    const reqRefs = srcs.filter((s) => s.requestId).length
      ? await tx
          .select({ id: requests.id, ref: requests.ref })
          .from(requests)
          .where(
            inArray(
              requests.id,
              srcs.map((s) => s.requestId).filter((x): x is string => Boolean(x)),
            ),
          )
      : [];
    const totalFunded = srcs.reduce((a, s) => a + s.fundedMinor, 0);
    const participants = await this.participantViews(tx, e);
    const [ownReq] = await tx
      .select({ id: requests.id, ref: requests.ref, status: requests.status })
      .from(requests)
      .where(and(eq(requests.eventId, e.id), eq(requests.kind, 'budget')))
      .orderBy(desc(requests.createdAt))
      .limit(1);
    const co = await this.coOrganizers(tx, e.id);
    const coNames = await personNames(tx, co);
    const locs = await tx
      .select({ id: orgUnits.id, name: orgUnits.name, le: orgUnits.legalEntityId })
      .from(eventLocations)
      .innerJoin(orgUnits, eq(orgUnits.id, eventLocations.orgUnitId))
      .where(eq(eventLocations.eventId, e.id));
    const entities = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (x) => [x.id, x.name],
      ),
    );
    const lines = await tx
      .select()
      .from(eventCostLines)
      .where(eq(eventCostLines.eventId, e.id))
      .orderBy(asc(eventCostLines.lineNo));
    const crossEntities = new Set([
      ...participants.filter((p) => p.intercompany).map((p) => p.employingEntityId!),
      ...contribRows
        .map((c) => budgetsById.get(c.giverBudgetId)?.legalEntityId)
        .filter((x): x is string => Boolean(x && x !== e.legalEntityId)),
    ]);
    let intercompany: EventDetail['intercompany'] = null;
    if (crossEntities.size) {
      const policy = await this.intercompany.policyFor(tx, e.legalEntityId, [...crossEntities][0]);
      intercompany = {
        crossEntity: true,
        mode: policy.mode,
        message:
          policy.mode === 'block'
            ? 'Some costs cross legal entities and the intercompany policy blocks them.'
            : `Costs cross legal entities: they are recharged ${policy.mode === 'recharge_with_markup' ? `with a ${policy.markupBps / 100}% markup` : 'at cost'} per the intercompany policy.`,
      };
    }
    const home = await this.home(tx, e);
    const homeBlock = home ? acceptsNewActivity(home.status) : null;
    const manage = await this.canManage(tx, actor, e);
    const allowed: EventDetail['allowedActions'] = [];
    if (manage) {
      if (e.status === 'draft') allowed.push('edit', 'submit');
      if (OPEN.includes(e.status))
        allowed.push('add_participants', 'request_contribution', 'upload');
      if (['approved', 'funded', 'in_progress'].includes(e.status))
        allowed.push('request_funds', 'commit');
      if (e.status === 'approved') allowed.push('confirm_funding');
      if (e.status === 'funded') allowed.push('start');
      if (e.status === 'in_progress') allowed.push('complete');
      if (e.status === 'completed' || e.status === 'reconciling') allowed.push('close');
      if (OPEN.includes(e.status)) allowed.push('cancel');
    }
    const curIndex = LIFECYCLE.findIndex((l) => l.status === e.status);
    return {
      ...summary,
      description: e.description,
      spendType: e.spendType,
      toleranceBps: e.toleranceBps,
      expectedAttendance: e.expectedAttendance,
      costCenterId: e.costCenterId,
      ownFundsRequested: m(e.ownFundsMinor),
      coOrganizers: co.map((p) => ({ personId: p, name: coNames.get(p) ?? '' })),
      locations: locs.map((l) => ({
        orgUnitId: l.id,
        name: l.name,
        legalEntityName: l.le ? (entities.get(l.le) ?? null) : null,
        participants: participants.filter((p) => p.locationOrgUnitId === l.id).length,
      })),
      costLines: lines.map((l) => ({
        lineNo: l.lineNo,
        category: l.category,
        description: l.description,
        quantity: l.quantity,
        unitCost: m(l.unitCostMinor),
        amount: m(l.amountMinor),
      })),
      funding: {
        estimate: m(f.estimateMinor),
        tolerance: m(f.toleranceMinor),
        ceiling: m(f.ceilingMinor),
        ownFunds: m(f.ownFundsMinor),
        contributions: m(f.contributionsMinor),
        pending: m(f.pendingMinor),
        cap: m(f.capMinor),
        committed: m(f.committedMinor),
        actual: m(0),
        available: m(Math.max(f.capMinor - f.committedMinor, 0)),
        gap: m(f.gapMinor),
        fullyFunded: f.fullyFunded,
        perHead: participants.length
          ? m(Math.floor((f.capMinor || e.estimateMinor) / participants.length))
          : null,
        perHeadLimit: e.perHeadLimitMinor !== null ? m(e.perHeadLimitMinor) : null,
      },
      sources: srcs.map((s) => {
        const b = budgetsById.get(s.budgetId);
        const origin = budgetsById.get(s.originBudgetId);
        const contrib = contribRows.find((c) => c.id === s.contributionRequestId);
        return {
          id: s.id,
          kind: s.kind as 'own' | 'contribution',
          budgetId: s.budgetId,
          budgetName: b?.name ?? '',
          originBudgetId: s.originBudgetId,
          originBudgetName: origin?.name ?? '',
          ownerName: origin?.ownerPersonId ? (owners.get(origin.ownerPersonId) ?? null) : null,
          mode: s.mode,
          funded: { amountMinor: s.fundedMinor, currency: s.currency },
          consumed: { amountMinor: s.consumedMinor, currency: s.currency },
          returned: { amountMinor: s.returnedMinor, currency: s.currency },
          remaining: { amountMinor: remainingOf(asFundingSource(s)), currency: s.currency },
          sharePct: totalFunded ? Math.round((s.fundedMinor * 10_000) / totalFunded) : 0,
          status: s.status as 'active' | 'returned' | 'cancelled',
          requestId: s.requestId,
          requestRef: reqRefs.find((r) => r.id === s.requestId)?.ref ?? null,
          contributionId: s.contributionRequestId,
          contributionRef: contrib?.ref ?? null,
        };
      }),
      contributions: contribRows.map((c) => ({
        id: c.id,
        ref: c.ref,
        giverBudgetName: givers.get(c.giverBudgetId)?.name ?? '',
        giverOwnerName: givers.get(c.giverBudgetId)?.ownerName ?? null,
        requested: { amountMinor: c.requestedMinor, currency: c.currency },
        approved:
          c.approvedMinor !== null ? { amountMinor: c.approvedMinor, currency: c.currency } : null,
        mode: c.mode,
        status: c.status,
        updatedAt: c.updatedAt.toISOString(),
      })),
      splits: {
        byLocation: this.split(participants, 'location', e.currency, e.legalEntityId),
        byEntity: this.split(participants, 'legal_entity', e.currency, e.legalEntityId),
        byCostCenter: this.split(participants, 'cost_center', e.currency, e.legalEntityId),
      },
      lifecycle: LIFECYCLE.map((l, i) => ({
        status: l.status,
        label: l.label,
        reached: e.status !== 'cancelled' && i <= curIndex,
        current: l.status === e.status,
      })),
      intercompany,
      ownFundsRequest: ownReq ? { id: ownReq.id, ref: ownReq.ref, status: ownReq.status } : null,
      commitments: await this.commitmentsService.listForEvent(tx, e.id),
      recharges: await this.intercompany.views(
        tx,
        actor,
        await this.intercompany.list(tx, actor, e.id),
      ),
      documents: await this.documents.listTx(tx, 'event', e.id, actor.personId),
      blockedReason: homeBlock && !homeBlock.ok ? homeBlock.error.message : null,
      allowedActions: allowed,
    };
  }

  activity(actor: RequestActor, id: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const e = await this.visible(tx, actor, id);
      const reqs = await tx
        .select({ id: requests.id })
        .from(requests)
        .where(eq(requests.eventId, e.id));
      const contribs = await tx
        .select({ id: contributionRequests.id })
        .from(contributionRequests)
        .where(eq(contributionRequests.eventId, e.id));
      return {
        items: await this.approvals.activity(tx, [
          { type: 'event', id: e.id },
          ...reqs.map((r) => ({ type: 'request', id: r.id })),
          ...contribs.map((c) => ({ type: 'contribution', id: c.id })),
        ]),
      };
    });
  }
}
