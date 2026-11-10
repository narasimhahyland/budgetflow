import {
  ApprovalHandlers,
  ApprovalsService,
  BudgetImpactService,
  budgetResourceOf,
  personNames,
  RoutingService,
  type ApprovalSubject,
  type ApprovalSubjectHandler,
  type BudgetRow,
  type DecisionContext,
  type HandlerOutcome,
} from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import { PlanningService } from '@bf/api/budgets';
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
  eventCoOrganizers,
  eventParticipants,
  events,
  requests,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { toPostingBudget } from '@bf/api/ledger';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  BudgetImpact,
  CreateRequestBody,
  RequestableBudget,
  RequestDetail,
  RequestList,
  RequestSummary,
  RequestVersion,
  ResubmitRequestBody,
  RoutePreview,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  availableOf,
  buildTriplet,
  checkSpend,
  checkFundingCeiling,
  err,
  postSpendMovement,
  requestMachine,
  type CurrencyCode,
  type Money,
  type RequestStatus,
} from '@bf/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, like, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { CommitmentsService } from './commitments.service';
import { FundingSourcesService } from './funding-sources.service';
import { PostingSupport, type PostCtx } from './posting-support';
import { SpendHooks } from './spend-hooks';

type RequestRow = typeof requests.$inferSelect;
/** `fixedId`: seed only, never exposed through the API. */
type Ctx = { idempotencyKey: string; requestId: string | null; fixedId?: string };
type LooseCtx = { idempotencyKey?: string | null; requestId?: string | null };

const KIND_LABEL: Record<RequestRow['kind'], string> = {
  budget: 'Event budget',
  additional_fund: 'Additional funds',
  spending: 'Spending request',
  over_budget: 'Over-budget request',
  exception: 'Exception request',
};
const PENDING: RequestStatus[] = ['submitted', 'pending_approval'];
const WAITING: RequestStatus[] = ['submitted', 'pending_approval', 'changes_requested'];
const isEventFunding = (r: Pick<RequestRow, 'kind'>) =>
  r.kind === 'budget' || r.kind === 'additional_fund';

const TAB_STATUSES: Record<string, RequestStatus[] | null> = {
  all: null,
  drafts: ['draft'],
  pending: ['submitted', 'pending_approval', 'changes_requested'],
  approved: ['approved', 'partially_approved'],
  rejected: ['rejected', 'withdrawn', 'cancelled'],
};

/**
 * Requests (event budget, additional funds, spending, over budget): submitting pre-encumbers the
 * amount on the budget and routes it by hierarchy and DoA; approval encumbers a spending commitment
 * or turns event funding into an earmark (a funding source); rejection, withdrawal and budget
 * controls release the pre-encumbrance exactly. Also the approval handler for subject `request`.
 */
@Injectable()
export class RequestsService implements ApprovalSubjectHandler, OnModuleInit {
  readonly type = 'request' as const;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly posting: PostingSupport,
    private readonly commitments: CommitmentsService,
    private readonly sources: FundingSourcesService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly routing: RoutingService,
    private readonly impacts: BudgetImpactService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly documents: DocumentsService,
    private readonly hooks: SpendHooks,
    private readonly planning: PlanningService,
  ) {}

  onModuleInit(): void {
    this.handlers.register(this);
    this.documents.registerOwner({
      type: 'request',
      canRead: async (tx, actor, id) => {
        const s = await this.load(tx, id);
        return Boolean(s && (await this.canView(tx, actor, s)));
      },
      canWrite: async (tx, actor, id) => {
        const [r] = await tx.select().from(requests).where(eq(requests.id, id));
        return Boolean(r && r.requesterPersonId === actor.personId);
      },
    });
  }

  private postCtx(actor: RequestActor, command: string, ctx: LooseCtx): PostCtx {
    return {
      actor,
      command,
      requestId: ctx.requestId ?? null,
      idempotencyKey: ctx.idempotencyKey ?? null,
    };
  }

  // ApprovalSubjectHandler ------------------------------------------------------------------------

  async load(tx: Tx, id: string, opts: { lock?: boolean } = {}): Promise<ApprovalSubject | null> {
    const q = tx.select().from(requests).where(eq(requests.id, id));
    const [r] = opts.lock ? await q.for('update') : await q;
    if (!r || !r.budgetId) return null;
    const budget = (await this.posting.budget(tx, r.budgetId))!;
    let eventName: string | null = null;
    let beneficiaries = [r.requesterPersonId];
    let attendees: string[] = [];
    if (r.eventId) {
      const [e] = await tx.select().from(events).where(eq(events.id, r.eventId));
      eventName = e?.name ?? null;
      if (e) {
        const co = await tx
          .select({ p: eventCoOrganizers.personId })
          .from(eventCoOrganizers)
          .where(eq(eventCoOrganizers.eventId, e.id));
        beneficiaries = [
          ...new Set([r.requesterPersonId, e.organizerPersonId, ...co.map((c) => c.p)]),
        ];
        attendees = (
          await tx
            .select({ p: eventParticipants.personId })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, e.id))
        )
          .map((p) => p.p)
          .filter((p): p is string => Boolean(p));
      }
    }
    const names = await personNames(tx, [r.requesterPersonId]);
    const budgetAmount: Money = {
      amountMinor: r.budgetAmountMinor ?? r.amountMinor,
      currency: (r.budgetCurrency ?? budget.currency) as CurrencyCode,
    };
    return {
      type: 'request',
      id: r.id,
      ref: r.ref,
      title: r.title,
      kindLabel: KIND_LABEL[r.kind],
      status: r.status,
      version: r.version,
      requesterId: r.requesterPersonId,
      requesterName: names.get(r.requesterPersonId) ?? '',
      beneficiaryIds: beneficiaries,
      attendeeIds: attendees,
      budget,
      eventId: r.eventId,
      eventName,
      purpose: r.purpose,
      spendType: r.spendType,
      neededBy: r.neededBy,
      amount: { amountMinor: r.amountMinor, currency: r.currency as CurrencyCode },
      budgetAmount,
      onHold: Boolean(r.heldAt),
      holdReason: r.holdReason,
      pending: PENDING.includes(r.status),
      contributionMode: null,
      transferAllowed: false,
      detailsPath: `/requests/${r.id}`,
    };
  }

  async canView(tx: Tx, actor: RequestActor, s: ApprovalSubject): Promise<boolean> {
    if (s.requesterId === actor.personId) return true;
    if (this.policy.can(actor, 'budget.read', budgetResourceOf(s.budget)).allowed) return true;
    if (s.eventId && actor.personId) {
      const [e] = await tx
        .select({ o: events.organizerPersonId })
        .from(events)
        .where(eq(events.id, s.eventId));
      if (e?.o === actor.personId) return true;
    }
    return Boolean(await this.approvals.myTask(tx, actor, 'request', s.id));
  }

  impact(tx: Tx, s: ApprovalSubject): Promise<BudgetImpact> {
    return this.impacts.impact(tx, s.budget, s.budgetAmount.amountMinor, {
      pendingIncludesThis: s.pending,
    });
  }

  private async decided(
    tx: Tx,
    r: RequestRow,
    patch: Partial<typeof requests.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(requests)
      .set({ ...patch, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(requests.id, r.id));
  }

  private async row(tx: Tx, id: string): Promise<RequestRow> {
    return (await tx.select().from(requests).where(eq(requests.id, id)))[0];
  }

  async approve(
    tx: Tx,
    s: ApprovalSubject,
    approvedMinor: number,
    ctx: DecisionContext,
  ): Promise<HandlerOutcome> {
    const r = await this.row(tx, s.id);
    const status = unwrap(
      requestMachine.next(r.status, approvedMinor < r.amountMinor ? 'approve_partial' : 'approve'),
    );
    const pc = this.postCtx(ctx.actor, 'requests.approve', ctx);
    const changes: Record<string, unknown> = {};
    if (isEventFunding(r)) {
      const locked = (await this.posting.lock(tx, [r.budgetId!])).get(r.budgetId!)!;
      const pctx = await this.posting.context(tx, locked, ctx.actor.reportingCurrency);
      const remaining = await this.posting.requestRemaining(tx, r.id, locked.id);
      const prov = { requestId: r.id, eventId: r.eventId };
      const held = unwrap(
        postSpendMovement(
          {
            kind: 'hold_from_pre_encumbrance',
            budget: locked,
            amount: { amountMinor: approvedMinor, currency: r.currency as CurrencyCode },
            journalType: 'commitment',
            provenance: prov,
            remaining,
            reason: 'Event funding approved: held for the event',
          },
          pctx,
        ),
      );
      const ids = await this.posting.post(tx, held.journals, locked.fiscalYearId, pc);
      const rest = remaining.transactionMinor - approvedMinor;
      if (rest > 0) {
        const left = await this.posting.requestRemaining(tx, r.id, locked.id);
        const rel = unwrap(
          postSpendMovement(
            {
              kind: 'release_pre_encumbrance',
              budget: locked,
              amount: { amountMinor: rest, currency: r.currency as CurrencyCode },
              journalType: 'commitment',
              provenance: prov,
              remaining: left,
            },
            pctx,
          ),
        );
        ids.push(...(await this.posting.post(tx, rel.journals, locked.fiscalYearId, pc)));
      }
      const source = await this.sources.add(tx, {
        tenantId: ctx.actor.tenantId,
        eventId: r.eventId!,
        kind: 'own',
        budgetId: locked.id,
        originBudgetId: locked.id,
        requestId: r.id,
        mode: 'earmark',
        fundedMinor: held.budgetAmount.amountMinor,
        currency: locked.currency,
      });
      changes['fundingSourceId'] = source.id;
      changes['journalIds'] = ids;
      await this.decided(tx, r, {
        status,
        approvedMinor,
        reasonCode: ctx.reasonCode,
        decisionReason: ctx.reason,
      });
      await this.hooks.fundingDecided(
        tx,
        ctx.actor,
        r.eventId!,
        'approved',
        r.kind as 'budget' | 'additional_fund',
      );
    } else {
      const res = await this.commitments.encumberApproved(tx, pc, r.commitmentId!, approvedMinor);
      changes['commitmentId'] = r.commitmentId;
      changes['journalIds'] = res.journalIds;
      await this.decided(tx, r, {
        status,
        approvedMinor,
        reasonCode: ctx.reasonCode,
        decisionReason: ctx.reason,
      });
    }
    return { status, changes };
  }

  /** Releases a pending request's pre-encumbrance exactly (event funding or spending commitment). */
  private async releasePending(tx: Tx, r: RequestRow, pc: PostCtx): Promise<string[]> {
    if (!PENDING.includes(r.status)) return [];
    if (!isEventFunding(r)) {
      return r.commitmentId
        ? (await this.commitments.releasePreEncumbrance(tx, pc, r.commitmentId)).journalIds
        : [];
    }
    const locked = (await this.posting.lock(tx, [r.budgetId!])).get(r.budgetId!)!;
    const remaining = await this.posting.requestRemaining(tx, r.id, locked.id);
    if (remaining.transactionMinor <= 0) return [];
    const rel = unwrap(
      postSpendMovement(
        {
          kind: 'release_pre_encumbrance',
          budget: locked,
          amount: { amountMinor: remaining.transactionMinor, currency: r.currency as CurrencyCode },
          journalType: 'commitment',
          provenance: { requestId: r.id, eventId: r.eventId },
          remaining,
        },
        await this.posting.context(tx, locked, pc.actor.reportingCurrency),
      ),
    );
    return this.posting.post(tx, rel.journals, locked.fiscalYearId, pc);
  }

  async reject(tx: Tx, s: ApprovalSubject, ctx: DecisionContext): Promise<HandlerOutcome> {
    const r = await this.row(tx, s.id);
    const journalIds = await this.releasePending(
      tx,
      r,
      this.postCtx(ctx.actor, 'requests.reject', ctx),
    );
    const status = unwrap(requestMachine.next(r.status, 'reject'));
    await this.decided(tx, r, { status, reasonCode: ctx.reasonCode, decisionReason: ctx.reason });
    if (isEventFunding(r) && r.eventId)
      await this.hooks.fundingDecided(tx, ctx.actor, r.eventId, 'rejected', r.kind as 'budget');
    return { status, changes: { journalIds } };
  }

  async requestChanges(
    tx: Tx,
    s: ApprovalSubject,
    ctx: DecisionContext,
    counterOffer?: Money | null,
  ): Promise<HandlerOutcome> {
    const r = await this.row(tx, s.id);
    if (
      counterOffer &&
      (counterOffer.currency !== r.currency ||
        counterOffer.amountMinor <= 0 ||
        counterOffer.amountMinor >= r.amountMinor)
    ) {
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        `A counter-offer must be in ${r.currency}, greater than zero and less than the requested amount.`,
        { field: 'counterOfferAmount' },
      );
    }
    const journalIds = await this.releasePending(
      tx,
      r,
      this.postCtx(ctx.actor, 'requests.request_changes', ctx),
    );
    const status = unwrap(requestMachine.next(r.status, 'request_changes'));
    const now = new Date();
    await this.decided(tx, r, {
      status,
      reasonCode: ctx.reasonCode,
      decisionReason: ctx.reason,
      ...(counterOffer
        ? {
            counterOfferMinor: counterOffer.amountMinor,
            counterOfferCurrency: counterOffer.currency,
            counterOfferedBy: ctx.actor.personId,
            counterOfferedAt: now,
            counterOfferExpiresAt: new Date(now.getTime() + 7 * 86_400_000),
          }
        : {
            counterOfferMinor: null,
            counterOfferCurrency: null,
            counterOfferedBy: null,
            counterOfferedAt: null,
            counterOfferExpiresAt: null,
          }),
    });
    if (isEventFunding(r) && r.eventId)
      await this.hooks.fundingDecided(
        tx,
        ctx.actor,
        r.eventId,
        'changes_requested',
        r.kind as 'budget',
      );
    return {
      status,
      changes: {
        journalIds,
        ...(counterOffer ? { counterOffer } : {}),
      },
    };
  }

  // Commands --------------------------------------------------------------------------------------

  private async assertRequestable(
    tx: Tx,
    actor: RequestActor,
    budget: BudgetRow | undefined,
  ): Promise<BudgetRow> {
    if (!budget) throw ApiProblem.notFound('budget');
    this.policy.assert(actor, 'request.create', budgetResourceOf(budget), 'budget');
    return budget;
  }

  create(
    actor: RequestActor,
    body: CreateRequestBody,
    ctx: Ctx,
  ): Promise<CommandResult<RequestDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'requests.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden('Only people can raise requests.');
        const budget = await this.assertRequestable(
          tx,
          actor,
          await this.posting.budget(tx, body.budgetId),
        );
        if (body.kind === 'additional_fund') {
          if (!body.eventId)
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              'Choose the event that needs more funds.',
              { field: 'eventId' },
            );
          await this.assertEventFundable(tx, body.eventId, budget, body.amount, actor);
        } else if (body.eventId) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Spending for an event is committed on the event; use additional funds to raise more.',
            { field: 'eventId' },
          );
        }
        const [r] = await tx
          .insert(requests)
          .values({
            ...(ctx.fixedId ? { id: ctx.fixedId } : {}),
            tenantId: actor.tenantId,
            kind: body.kind,
            status: 'draft',
            requesterPersonId: actor.personId,
            budgetId: budget.id,
            eventId: body.eventId ?? null,
            amountMinor: body.amount.amountMinor,
            currency: body.amount.currency,
            spendType: body.spendType,
            title: body.title,
            purpose: body.purpose,
            category: body.category ?? null,
            neededBy: body.neededBy ?? null,
          })
          .returning();
        if (body.submit === false) {
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'request.created',
            resourceType: 'request',
            resourceId: r.id,
            legalEntityId: budget.legalEntityId,
            requestId: ctx.requestId,
            changes: {
              status: { from: null, to: 'draft' },
              amount: { from: null, to: body.amount },
            },
          });
        } else {
          await this.submitTx(tx, actor, r.id, ctx, 'request.submitted');
        }
        return this.detailTx(tx, actor, r.id);
      },
    );
  }

  /** Additional funds and event budgets: the event's currency, its lifecycle, and estimate + tolerance. */
  private async assertEventFundable(
    tx: Tx,
    eventId: string,
    budget: BudgetRow,
    amount: { amountMinor: number; currency: string },
    actor: RequestActor,
  ) {
    const [e] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!e) throw ApiProblem.notFound('event');
    const organizer = e.organizerPersonId === actor.personId;
    const co = await tx
      .select({ p: eventCoOrganizers.personId })
      .from(eventCoOrganizers)
      .where(eq(eventCoOrganizers.eventId, e.id));
    if (
      !organizer &&
      !co.some((c) => c.p === actor.personId) &&
      !this.policy.can(actor, 'event.manage', budgetResourceOf(budget)).allowed
    ) {
      throw ApiProblem.forbidden('Only the event’s organizers can ask for more funds.');
    }
    if (!['approved', 'funded', 'in_progress'].includes(e.status)) {
      throw new ApiProblem(
        409,
        'INVALID_TRANSITION',
        'Ask for more funds once the event budget is approved.',
      );
    }
    if (amount.currency !== e.currency || budget.currency !== e.currency) {
      throw new ApiProblem(
        422,
        'CURRENCY_MISMATCH',
        `Event funding is in the event currency (${e.currency}).`,
      );
    }
    await this.checkCeiling(tx, e, amount.amountMinor);
  }

  private async checkCeiling(
    tx: Tx,
    e: typeof events.$inferSelect,
    requestedMinor: number,
    excludeRequestId?: string,
  ) {
    const srcs = await this.sources.list(tx, e.id);
    const approved = srcs
      .filter((s) => s.status !== 'cancelled')
      .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
    const pending = await this.pendingFunding(tx, e.id, excludeRequestId);
    unwrap(
      checkFundingCeiling({
        estimateMinor: e.estimateMinor,
        toleranceBps: e.toleranceBps,
        approvedMinor: approved,
        pendingMinor: pending,
        requestedMinor,
      }),
    );
  }

  /** Own funds and additional funds still waiting for a decision on an event (contributions add theirs). */
  async pendingFunding(tx: Tx, eventId: string, excludeRequestId?: string): Promise<number> {
    const rows = await tx
      .select({ a: requests.amountMinor, id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.eventId, eventId),
          inArray(requests.kind, ['budget', 'additional_fund']),
          inArray(requests.status, ['submitted', 'pending_approval']),
        ),
      );
    return rows.filter((r) => r.id !== excludeRequestId).reduce((a, r) => a + r.a, 0);
  }

  /** Event submission (P5 events module): the own-funds request against the home budget. */
  async createEventBudgetRequest(
    tx: Tx,
    actor: RequestActor,
    input: {
      eventId: string;
      budget: BudgetRow;
      amount: Money;
      title: string;
      purpose: string;
      spendType: string;
    },
    ctx: Ctx,
  ): Promise<string> {
    if (!actor.personId) throw ApiProblem.forbidden();
    const [r] = await tx
      .insert(requests)
      .values({
        tenantId: actor.tenantId,
        kind: 'budget',
        status: 'draft',
        requesterPersonId: actor.personId,
        budgetId: input.budget.id,
        eventId: input.eventId,
        amountMinor: input.amount.amountMinor,
        currency: input.amount.currency,
        spendType: input.spendType,
        title: input.title,
        purpose: input.purpose,
      })
      .returning();
    await this.submitTx(tx, actor, r.id, ctx, null);
    return r.id;
  }

  /** Budget-currency amount other live requests on the same budget and spend type hold. */
  private async categoryCommittedMinor(tx: Tx, r: RequestRow): Promise<number> {
    const [row] = await tx
      .select({ v: sql<string>`coalesce(sum(${requests.budgetAmountMinor}), 0)` })
      .from(requests)
      .where(
        and(
          eq(requests.budgetId, r.budgetId!),
          eq(requests.spendType, r.spendType),
          ne(requests.id, r.id),
          inArray(requests.status, ['pending_approval', 'approved', 'partially_approved']),
        ),
      );
    return Number(row.v);
  }

  /**
   * Submit: blocks frozen and zeroed budgets, runs the budget spend check (control mode, tolerance and
   * limits; a warning flags the request for finance review), pre-encumbers, routes and notifies.
   */
  private async submitTx(
    tx: Tx,
    actor: RequestActor,
    id: string,
    ctx: LooseCtx,
    auditAction: string | null,
  ) {
    const r = await this.row(tx, id);
    const locked = (await this.posting.lock(tx, [r.budgetId!])).get(r.budgetId!)!;
    unwrap(acceptsNewActivity(locked.status));
    const pc = this.postCtx(actor, 'requests.submit', ctx);
    const pctx = await this.posting.context(tx, locked, actor.reportingCurrency);
    const check = await this.planning.spendCheckInTx(tx, locked.row, {
      amountMinor: unwrap(
        buildTriplet(
          { amountMinor: r.amountMinor, currency: r.currency as CurrencyCode },
          {
            budgetCurrency: locked.currency,
            reportingCurrency: actor.reportingCurrency,
            rates: pctx.rates,
          },
        ),
      ).budget.amountMinor,
      categoryCode: r.spendType,
      categoryCommittedMinor: await this.categoryCommittedMinor(tx, r),
    });
    if (check.outcome === 'blocked') {
      const limit = check.limits.find((f) => f.outcome === 'blocked');
      unwrap(
        limit
          ? err('LIMIT_EXCEEDED', limit.message)
          : err('INSUFFICIENT_AVAILABLE', check.reasons[0]?.message ?? 'Not enough available.'),
      );
    }
    let budgetAmount: Money;
    let commitmentId: string | null = null;
    if (isEventFunding(r)) {
      const [e] = await tx.select().from(events).where(eq(events.id, r.eventId!));
      await this.checkCeiling(tx, e, r.amountMinor, r.id);
      const moved = unwrap(
        postSpendMovement(
          {
            kind: 'pre_encumber',
            budget: locked,
            amount: { amountMinor: r.amountMinor, currency: r.currency as CurrencyCode },
            journalType: 'commitment',
            provenance: { requestId: r.id, eventId: r.eventId },
          },
          pctx,
        ),
      );
      budgetAmount = moved.budgetAmount;
      await this.posting.post(tx, moved.journals, locked.fiscalYearId, pc);
    } else {
      const res = await this.commitments.preEncumberForRequest(tx, pc, {
        budget: locked,
        requestId: r.id,
        eventId: null,
        description: r.title,
        amount: { amountMinor: r.amountMinor, currency: r.currency as CurrencyCode },
      });
      budgetAmount = res.budgetAmount;
      commitmentId = res.commitmentId;
    }
    const overBudget = check.outcome === 'warning' || r.kind === 'over_budget';
    const after = check.availableMinor - budgetAmount.amountMinor;
    const submitted = unwrap(
      requestMachine.next(r.status, r.status === 'changes_requested' ? 'resubmit' : 'submit'),
    );
    const status = unwrap(requestMachine.next(submitted, 'route'));
    await tx
      .update(requests)
      .set({
        status,
        budgetAmountMinor: budgetAmount.amountMinor,
        budgetCurrency: budgetAmount.currency,
        commitmentId,
        overBudget,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(requests.id, r.id));
    const subject = (await this.load(tx, r.id))!;
    const { route, limitAmount } = await this.routing.plan(tx, {
      subject: 'request',
      requesterId: subject.requesterId,
      beneficiaryIds: subject.beneficiaryIds,
      attendeeIds: subject.attendeeIds,
      budget: locked.row,
      budgetAmount,
      spendType: r.spendType,
      reportingCurrency: actor.reportingCurrency,
      remainingPctAfter:
        locked.balances.authorized > 0
          ? Math.floor((after * 100) / locked.balances.authorized)
          : null,
      forceFinanceReview: overBudget,
      action: 'request.approve',
    });
    await this.approvals.start(tx, actor, subject, route, limitAmount.currency);
    if (auditAction) {
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: auditAction,
        resourceType: 'request',
        resourceId: r.id,
        legalEntityId: locked.legalEntityId,
        requestId: ctx.requestId ?? null,
        changes: {
          status: { from: r.status, to: status },
          amount: { from: null, to: { amountMinor: r.amountMinor, currency: r.currency } },
          version: {
            from: null,
            to: { version: r.version, title: r.title, purpose: r.purpose, neededBy: r.neededBy },
          },
          budgetAmount: { from: null, to: budgetAmount },
          preEncumbered: { from: null, to: budgetAmount },
          ...(commitmentId ? { commitmentId: { from: null, to: commitmentId } } : {}),
          route: {
            from: null,
            to: route.steps.map((s) => ({
              stepNo: s.stepNo,
              personId: s.personId,
              resolver: s.resolver,
            })),
          },
          ...(overBudget ? { overBudget: { from: null, to: true } } : {}),
        },
      });
    }
    await this.analytics.track(tx, actor, 'request.submitted', {
      kind: r.kind,
      overBudget,
      steps: route.steps.length,
      resubmitted: r.status === 'changes_requested',
    });
  }

  submit(actor: RequestActor, id: string, ctx: Ctx): Promise<CommandResult<RequestDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `requests.submit:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const r = await this.mine(tx, actor, id);
        if (r.status !== 'draft') unwrap(requestMachine.next(r.status, 'submit'));
        await this.submitTx(tx, actor, id, ctx, 'request.submitted');
        return this.detailTx(tx, actor, id);
      },
    );
  }

  private async mine(tx: Tx, actor: RequestActor, id: string): Promise<RequestRow> {
    const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
    if (!r) throw ApiProblem.notFound('request');
    if (r.requesterPersonId !== actor.personId) {
      const s = await this.load(tx, id);
      if (s && (await this.canView(tx, actor, s)))
        throw ApiProblem.forbidden('Only the requester can do this.');
      throw ApiProblem.notFound('request');
    }
    return r;
  }

  withdraw(
    actor: RequestActor,
    id: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<RequestDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `requests.withdraw:${id}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const r = await this.mine(tx, actor, id);
        const status = unwrap(requestMachine.next(r.status, 'withdraw'));
        const journalIds = await this.releasePending(
          tx,
          r,
          this.postCtx(actor, 'requests.withdraw', ctx),
        );
        await this.approvals.cancelFor(tx, 'request', r.id);
        await tx
          .update(requests)
          .set({ status, cancelReason: reason ?? null, updatedAt: new Date() })
          .where(eq(requests.id, r.id));
        if (isEventFunding(r) && r.eventId)
          await this.hooks.fundingDecided(tx, actor, r.eventId, 'withdrawn', r.kind as 'budget');
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'request.withdrawn',
          resourceType: 'request',
          resourceId: r.id,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: {
            status: { from: r.status, to: status },
            journalIds: { from: null, to: journalIds },
          },
        });
        return this.detailTx(tx, actor, id);
      },
    );
  }

  resubmit(
    actor: RequestActor,
    id: string,
    body: ResubmitRequestBody,
    ctx: Ctx,
  ): Promise<CommandResult<RequestDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `requests.resubmit:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const r = await this.mine(tx, actor, id);
        if (r.status !== 'changes_requested') unwrap(requestMachine.next(r.status, 'resubmit'));
        if (body.amount && body.amount.currency !== r.currency) {
          throw new ApiProblem(422, 'CURRENCY_MISMATCH', `Keep the request in ${r.currency}.`);
        }
        await tx
          .update(requests)
          .set({
            amountMinor: body.amount?.amountMinor ?? r.amountMinor,
            title: body.title ?? r.title,
            purpose: body.purpose ?? r.purpose,
            neededBy: body.neededBy ?? r.neededBy,
            counterOfferMinor: null,
            counterOfferCurrency: null,
            counterOfferedBy: null,
            counterOfferedAt: null,
            counterOfferExpiresAt: null,
            version: r.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(requests.id, r.id));
        await this.submitTx(tx, actor, id, ctx, 'request.resubmitted');
        return this.detailTx(tx, actor, id);
      },
    );
  }

  /** Screen 065: accept an approver counter-offer to approve the request at the offered amount in one step. */
  acceptCounterOffer(
    actor: RequestActor,
    id: string,
    ctx: Ctx,
  ): Promise<CommandResult<RequestDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `requests.accept_offer:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const r = await this.mine(tx, actor, id);
        if (r.status !== 'changes_requested' || r.counterOfferMinor === null) {
          throw new ApiProblem(
            409,
            'NO_COUNTER_OFFER',
            'There is no active counter-offer on this request.',
          );
        }
        if (r.counterOfferExpiresAt && r.counterOfferExpiresAt.getTime() < Date.now()) {
          throw new ApiProblem(
            409,
            'COUNTER_OFFER_EXPIRED',
            'This counter-offer has expired; edit and resubmit the request instead.',
          );
        }
        const offeredMinor = r.counterOfferMinor;
        const locked = (await this.posting.lock(tx, [r.budgetId!])).get(r.budgetId!)!;
        unwrap(acceptsNewActivity(locked.status));
        const pc = this.postCtx(actor, 'requests.accept_offer', ctx);
        const pctx = await this.posting.context(tx, locked, actor.reportingCurrency);
        const journalIds: string[] = [];
        let commitmentId = r.commitmentId;

        if (isEventFunding(r)) {
          const pre = unwrap(
            postSpendMovement(
              {
                kind: 'pre_encumber',
                budget: locked,
                amount: { amountMinor: offeredMinor, currency: r.currency as CurrencyCode },
                journalType: 'commitment',
                provenance: { requestId: r.id, eventId: r.eventId },
              },
              pctx,
            ),
          );
          journalIds.push(...(await this.posting.post(tx, pre.journals, locked.fiscalYearId, pc)));
          const remaining = await this.posting.requestRemaining(tx, r.id, locked.id);
          const held = unwrap(
            postSpendMovement(
              {
                kind: 'hold_from_pre_encumbrance',
                budget: locked,
                amount: { amountMinor: offeredMinor, currency: r.currency as CurrencyCode },
                journalType: 'commitment',
                provenance: { requestId: r.id, eventId: r.eventId },
                remaining,
                reason: 'Counter-offer accepted: held for the event',
              },
              pctx,
            ),
          );
          journalIds.push(...(await this.posting.post(tx, held.journals, locked.fiscalYearId, pc)));
          await this.sources.add(tx, {
            tenantId: actor.tenantId,
            eventId: r.eventId!,
            kind: 'own',
            budgetId: locked.id,
            originBudgetId: locked.id,
            requestId: r.id,
            mode: 'earmark',
            fundedMinor: held.budgetAmount.amountMinor,
            currency: locked.currency,
          });
        } else {
          const pre = await this.commitments.preEncumberForRequest(tx, pc, {
            budget: locked,
            requestId: r.id,
            eventId: null,
            description: r.title,
            amount: { amountMinor: offeredMinor, currency: r.currency as CurrencyCode },
          });
          commitmentId = pre.commitmentId;
          const enc = await this.commitments.encumberApproved(tx, pc, commitmentId, offeredMinor);
          journalIds.push(...enc.journalIds);
        }

        await tx
          .update(requests)
          .set({
            status: 'partially_approved',
            approvedMinor: offeredMinor,
            commitmentId,
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(requests.id, r.id));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'request.counter_offer_accepted',
          resourceType: 'request',
          resourceId: r.id,
          legalEntityId: locked.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            status: { from: r.status, to: 'partially_approved' },
            approvedAmount: {
              from: null,
              to: { amountMinor: offeredMinor, currency: r.currency },
            },
            journalIds: { from: null, to: journalIds },
          },
        });
        return this.detailTx(tx, actor, id);
      },
    );
  }

  // Budget controls (worker) ----------------------------------------------------------------------

  /** Set to zero: cancels requests still waiting on the budget, releases them and tells the requesters. */
  async cancelWaitingForBudget(
    tx: Tx,
    actor: RequestActor,
    budgetId: string,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.budgetId, budgetId), inArray(requests.status, WAITING)))
      .for('update');
    return this.cancelRows(tx, actor, rows, reason);
  }

  /** A reduction returns the waiting requests that no longer fit (`unfitRequestIds` on the control event). */
  async cancelUnfitForBudget(
    tx: Tx,
    actor: RequestActor,
    budgetId: string,
    requestIds: readonly string[],
    reason: string,
  ): Promise<number> {
    if (!requestIds.length) return 0;
    const rows = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.budgetId, budgetId),
          inArray(requests.id, [...requestIds]),
          inArray(requests.status, WAITING),
        ),
      )
      .for('update');
    return this.cancelRows(tx, actor, rows, reason);
  }

  /** A cancelled event cancels its own funding requests still waiting for a decision. */
  async cancelWaitingForEvent(
    tx: Tx,
    actor: RequestActor,
    eventId: string,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.eventId, eventId), inArray(requests.status, WAITING)))
      .for('update');
    return this.cancelRows(tx, actor, rows, reason, false);
  }

  private async cancelRows(
    tx: Tx,
    actor: RequestActor,
    rows: RequestRow[],
    reason: string,
    notifyEvent = true,
  ): Promise<number> {
    for (const r of rows) {
      const journalIds = await this.releasePending(
        tx,
        r,
        this.postCtx(actor, 'requests.cancel_by_control', {}),
      );
      await this.approvals.cancelFor(tx, 'request', r.id);
      const status = unwrap(requestMachine.next(r.status, 'cancel'));
      await tx
        .update(requests)
        .set({
          status,
          cancelReason: reason,
          heldAt: null,
          holdReason: null,
          updatedAt: new Date(),
        })
        .where(eq(requests.id, r.id));
      if (notifyEvent && isEventFunding(r) && r.eventId)
        await this.hooks.fundingDecided(tx, actor, r.eventId, 'cancelled', r.kind as 'budget');
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'request.cancelled',
        resourceType: 'request',
        resourceId: r.id,
        reason,
        changes: {
          status: { from: r.status, to: status },
          journalIds: { from: null, to: journalIds },
        },
      });
      const recipient = await this.notifications.personEmail(tx, r.requesterPersonId);
      if (recipient) {
        await this.notifications.queueEmail(
          tx,
          actor.tenantId,
          recipient,
          noticeEmail({
            firstName: recipient.firstName,
            subject: `Your request ${r.ref} was cancelled: ${reason}`,
            headline: `Your request ${r.ref} was cancelled (${reason}). Nothing was charged.`,
            lines: [
              ['Request', `${r.ref} · ${r.title}`],
              ['Amount', formatMoney({ amountMinor: r.amountMinor, currency: r.currency })],
              ['Reason', reason],
            ],
            detailsUrl: `${this.notifications.webBaseUrl}/requests/${r.id}`,
          }),
          'request.cancelled',
        );
      }
    }
    return rows.length;
  }

  /** Freeze holds waiting requests (decisions wait); unfreeze releases the hold. */
  async holdWaitingForBudget(
    tx: Tx,
    actor: RequestActor,
    budgetId: string,
    hold: boolean,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.budgetId, budgetId),
          inArray(requests.status, WAITING),
          hold ? sql`${requests.heldAt} is null` : sql`${requests.heldAt} is not null`,
        ),
      )
      .for('update');
    for (const r of rows) {
      await tx
        .update(requests)
        .set(hold ? { heldAt: new Date(), holdReason: reason } : { heldAt: null, holdReason: null })
        .where(eq(requests.id, r.id));
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: null,
        actorSubject: actor.subject,
        action: hold ? 'request.held' : 'request.released',
        resourceType: 'request',
        resourceId: r.id,
        reason,
        changes: { onHold: { from: !hold, to: hold } },
      });
    }
    return rows.length;
  }

  // Reads -----------------------------------------------------------------------------------------

  private async summaries(tx: Tx, rows: RequestRow[]): Promise<RequestSummary[]> {
    const budgetRows = rows.length
      ? await tx
          .select({ id: budgets.id, name: budgets.name })
          .from(budgets)
          .where(inArray(budgets.id, [...new Set(rows.map((r) => r.budgetId!))]))
      : [];
    const eventIds = [
      ...new Set(rows.map((r) => r.eventId).filter((e): e is string => Boolean(e))),
    ];
    const eventRows = eventIds.length
      ? await tx
          .select({ id: events.id, name: events.name })
          .from(events)
          .where(inArray(events.id, eventIds))
      : [];
    const names = await personNames(
      tx,
      rows.map((r) => r.requesterPersonId),
    );
    const steps = await this.approvals.currentSteps(
      tx,
      'request',
      rows.map((r) => r.id),
    );
    const commitmentIds = rows.map((r) => r.commitmentId).filter((c): c is string => Boolean(c));
    const commitmentRows = commitmentIds.length
      ? await tx.select().from(commitments).where(inArray(commitments.id, commitmentIds))
      : [];
    const cm = new Map(commitmentRows.map((c) => [c.id, c]));
    const bn = new Map(budgetRows.map((b) => [b.id, b.name]));
    const en = new Map(eventRows.map((e) => [e.id, e.name]));
    const spendOf = (id: string | null): RequestSummary['spend'] => {
      const c = id ? cm.get(id) : undefined;
      if (!c) return null;
      const m = (amountMinor: number) => ({ amountMinor, currency: c.currency });
      return {
        committed: m(c.amountMinor),
        used: m(c.consumedMinor),
        released: m(c.releasedMinor),
      };
    };
    return rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      kind: r.kind,
      status: r.status,
      title: r.title,
      amount: { amountMinor: r.amountMinor, currency: r.currency },
      approvedAmount:
        r.approvedMinor !== null ? { amountMinor: r.approvedMinor, currency: r.currency } : null,
      budgetAmount:
        r.budgetAmountMinor !== null && r.budgetCurrency
          ? { amountMinor: r.budgetAmountMinor, currency: r.budgetCurrency }
          : null,
      budgetId: r.budgetId!,
      budgetName: bn.get(r.budgetId!) ?? '',
      eventId: r.eventId,
      eventName: r.eventId ? (en.get(r.eventId) ?? null) : null,
      spend: spendOf(r.commitmentId),
      requesterPersonId: r.requesterPersonId,
      requesterName: names.get(r.requesterPersonId) ?? '',
      currentStep: steps.get(r.id) ?? null,
      onHold: Boolean(r.heldAt),
      holdReason: r.holdReason,
      cancelReason: r.cancelReason,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  list(
    actor: RequestActor,
    q: {
      scope?: 'mine' | 'visible';
      tab?: string;
      kind?: string;
      budgetId?: string;
      eventId?: string;
      q?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<RequestList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const base: SQL[] = [];
      if ((q.scope ?? 'mine') === 'mine') {
        if (!actor.personId)
          return {
            items: [],
            nextCursor: null,
            counts: { all: 0, drafts: 0, pending: 0, approved: 0, rejected: 0 },
          };
        base.push(eq(requests.requesterPersonId, actor.personId));
      } else if (
        !this.policy.can(actor, 'budget.read', {
          kind: 'budget',
          tenantId: actor.tenantId,
          id: '',
          path: '/',
        }).allowed
      ) {
        const owned = actor.ownedBudgetPaths;
        const mine = actor.personId ? [eq(requests.requesterPersonId, actor.personId)] : [];
        const scoped = owned.length
          ? [
              inArray(
                requests.budgetId,
                tx
                  .select({ id: budgets.id })
                  .from(budgets)
                  .where(or(...owned.map((p) => like(budgets.path, `${p}%`)))),
              ),
            ]
          : [];
        if (!mine.length && !scoped.length)
          return {
            items: [],
            nextCursor: null,
            counts: { all: 0, drafts: 0, pending: 0, approved: 0, rejected: 0 },
          };
        base.push(or(...mine, ...scoped)!);
      }
      if (q.kind) base.push(eq(requests.kind, q.kind as RequestRow['kind']));
      if (q.budgetId) base.push(eq(requests.budgetId, q.budgetId));
      if (q.eventId) base.push(eq(requests.eventId, q.eventId));
      if (q.q)
        base.push(
          or(like(requests.title, `%${q.q}%`), like(requests.ref, `%${q.q.toUpperCase()}%`))!,
        );
      const countRows = await tx
        .select({ status: requests.status, n: sql<number>`count(*)` })
        .from(requests)
        .where(base.length ? and(...base) : undefined)
        .groupBy(requests.status);
      const count = (sts: RequestStatus[] | null) =>
        countRows
          .filter((c) => !sts || sts.includes(c.status))
          .reduce((a, c) => a + Number(c.n), 0);
      const tabStatuses = TAB_STATUSES[q.tab ?? 'all'] ?? null;
      const where = [...base, ...(tabStatuses ? [inArray(requests.status, tabStatuses)] : [])];
      const limit = q.limit ?? 50;
      const offset = q.cursor
        ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0
        : 0;
      const rows = await tx
        .select()
        .from(requests)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(requests.createdAt), desc(requests.id))
        .limit(limit + 1)
        .offset(offset);
      return {
        items: await this.summaries(tx, rows.slice(0, limit)),
        nextCursor:
          rows.length > limit ? Buffer.from(String(offset + limit)).toString('base64url') : null,
        counts: {
          all: count(null),
          drafts: count(TAB_STATUSES['drafts']),
          pending: count(TAB_STATUSES['pending']),
          approved: count(TAB_STATUSES['approved']),
          rejected: count(TAB_STATUSES['rejected']),
        },
      };
    });
  }

  get(actor: RequestActor, id: string): Promise<RequestDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detailTx(tx, actor, id),
    );
  }

  async detailTx(tx: Tx, actor: RequestActor, id: string): Promise<RequestDetail> {
    const s = await this.load(tx, id);
    if (!s || !(await this.canView(tx, actor, s))) throw ApiProblem.notFound('request');
    const r = await this.row(tx, id);
    const [summary] = await this.summaries(tx, [r]);
    const myTaskId = await this.approvals.myTask(tx, actor, 'request', id);
    const mine = r.requesterPersonId === actor.personId;
    const allowed: RequestDetail['allowedActions'] = [];
    if (mine && r.status === 'draft') allowed.push('submit');
    if (mine && WAITING.includes(r.status)) allowed.push('withdraw');
    if (mine && r.status === 'changes_requested') {
      allowed.push('resubmit');
      if (
        r.counterOfferMinor !== null &&
        (!r.counterOfferExpiresAt || r.counterOfferExpiresAt.getTime() >= Date.now())
      ) {
        allowed.push('accept_offer');
      }
    }
    if (myTaskId) allowed.push('decide');
    if (mine) allowed.push('upload');
    const showImpact =
      mine ||
      Boolean(myTaskId) ||
      this.policy.can(actor, 'budget.read', budgetResourceOf(s.budget)).allowed;
    let counterOffer: RequestDetail['counterOffer'] = null;
    if (r.counterOfferMinor !== null && r.counterOfferCurrency) {
      const offerNames = await personNames(tx, [r.counterOfferedBy]);
      const pctx = await this.posting.context(tx, s.budget, actor.reportingCurrency);
      const trip = buildTriplet(
        { amountMinor: r.counterOfferMinor, currency: r.counterOfferCurrency as CurrencyCode },
        {
          budgetCurrency: s.budget.currency as CurrencyCode,
          reportingCurrency: actor.reportingCurrency,
          rates: pctx.rates,
        },
      );
      const offeredAt = r.counterOfferedAt ?? r.updatedAt;
      const expiresAt = r.counterOfferExpiresAt ?? new Date(offeredAt.getTime() + 7 * 86_400_000);
      counterOffer = {
        amount: { amountMinor: r.counterOfferMinor, currency: r.counterOfferCurrency },
        budgetAmount: trip.ok ? trip.value.budget : null,
        offeredByName: r.counterOfferedBy
          ? (offerNames.get(r.counterOfferedBy) ?? 'Approver')
          : 'Approver',
        offeredAt: offeredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expired: expiresAt.getTime() < Date.now(),
        comment: r.decisionReason,
      };
    }
    return {
      ...summary,
      purpose: r.purpose,
      spendType: r.spendType,
      category: r.category,
      neededBy: r.neededBy,
      overBudget: r.overBudget,
      commitmentId: r.commitmentId,
      counterOffer,
      route: await this.approvals.routeView(tx, 'request', id),
      impact: showImpact ? await this.impact(tx, s) : null,
      activity: await this.approvals.activity(tx, [{ type: 'request', id }]),
      versions: await this.versions(tx, id),
      documents: await this.documents.listTx(tx, 'request', id, actor.personId),
      allowedActions: allowed,
      myTaskId,
    };
  }

  /** Each submission as recorded in its audit entry, oldest first (entries before snapshots carry the amount only). */
  private async versions(tx: Tx, id: string): Promise<RequestVersion[]> {
    const rows = (await this.audit.forResources(tx, [{ type: 'request', id }]))
      .filter((a) => a.action === 'request.submitted' || a.action === 'request.resubmitted')
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return rows.map((a, i) => {
      const changes = a.changes as Record<string, { to?: unknown } | undefined>;
      const amount = changes['amount']?.to as RequestVersion['amount'];
      const snap = (changes['version']?.to ?? {}) as Partial<
        Pick<RequestVersion, 'version' | 'title' | 'purpose' | 'neededBy'>
      >;
      return {
        version: snap.version ?? i + 1,
        submittedAt: a.occurredAt.toISOString(),
        amount,
        title: snap.title ?? null,
        purpose: snap.purpose ?? null,
        neededBy: snap.neededBy ?? null,
      };
    });
  }

  /** Budgets the viewer may request from (their location or team, budgets they own), with blocks and what they already asked. */
  requestable(actor: RequestActor): Promise<{ items: RequestableBudget[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const home = actor.homeOrgUnitIds ?? [];
      const conds: SQL[] = [];
      if (home.length) conds.push(inArray(budgets.orgUnitId, home));
      for (const p of actor.ownedBudgetPaths) conds.push(like(budgets.path, `${p}%`));
      if (!conds.length) return { items: [] };
      const rows = (
        await tx
          .select()
          .from(budgets)
          .where(and(or(...conds), ne(budgets.status, 'cancelled')))
          .orderBy(desc(budgets.createdAt))
          .limit(100)
      )
        .filter((b) => this.policy.can(actor, 'request.create', budgetResourceOf(b)).allowed)
        .sort((a, b) => a.path.localeCompare(b.path));
      if (!rows.length) return { items: [] };
      const asked = actor.personId
        ? await tx
            .select({
              b: requests.budgetId,
              status: requests.status,
              amount: sql<number>`coalesce(${requests.budgetAmountMinor}, ${requests.amountMinor})`,
            })
            .from(requests)
            .where(
              and(
                eq(requests.requesterPersonId, actor.personId),
                inArray(
                  requests.budgetId,
                  rows.map((r) => r.id),
                ),
                notInArray(requests.status, ['rejected', 'withdrawn', 'cancelled', 'draft']),
              ),
            )
        : [];
      const owners = await personNames(
        tx,
        rows.map((r) => r.ownerPersonId),
      );
      const balances = await this.posting.reads.balances(
        tx,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((b) => {
          const status = acceptsNewActivity(b.status);
          const mine = asked.filter((a) => a.b === b.id);
          const readable = this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed;
          const bal = balances.get(b.id)!.budget;
          const { control } = toPostingBudget(b);
          // Exhausted: hard control would refuse even one minor unit, so a request can only fail at
          // submit with INSUFFICIENT_AVAILABLE. Say so here instead of offering the form.
          const exhausted = status.ok && checkSpend(bal, control, 1).outcome === 'blocked';
          const blocked = status.ok
            ? exhausted
              ? {
                  code: 'INSUFFICIENT_AVAILABLE',
                  message:
                    'Nothing left to request: this budget has no money available. Ask its owner for an increase.',
                }
              : null
            : status.error;
          const ownsIt = Boolean(actor.personId) && b.ownerPersonId === actor.personId;
          return {
            budgetId: b.id,
            name: b.name,
            code: b.code,
            status: b.status,
            currency: b.currency,
            blockedCode: blocked?.code ?? null,
            blockedReason: blocked?.message ?? null,
            requestedThisYear: {
              amountMinor: mine.reduce((a, m) => a + Number(m.amount), 0),
              currency: b.currency,
            },
            pendingCount: mine.filter((m) => PENDING.includes(m.status)).length,
            // Nobody approves their own request: for the owner, routing skips them and goes up.
            approverHint: !b.ownerPersonId
              ? null
              : ownsIt
                ? 'You own this budget, so the next owner up approves your requests, within delegation of authority'
                : `${owners.get(b.ownerPersonId) ?? 'The budget owner'} approves, within delegation of authority`,
            available: readable
              ? {
                  // Under the budget's own rules, the figure its submit check uses.
                  amountMinor: availableOf(bal, control.basis),
                  currency: b.currency,
                }
              : null,
          };
        }),
      };
    });
  }

  previewRoute(
    actor: RequestActor,
    q: {
      budgetId: string;
      amountMinor: number;
      currency: string;
      spendType: string;
      eventId?: string;
    },
  ): Promise<RoutePreview> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const budget = await this.assertRequestable(
        tx,
        actor,
        await this.posting.budget(tx, q.budgetId),
      );
      const ctx = await this.posting.context(tx, budget, actor.reportingCurrency);
      const moved = postSpendMovement(
        {
          kind: 'pre_encumber',
          budget: await this.lockFree(tx, budget),
          amount: { amountMinor: q.amountMinor, currency: q.currency as CurrencyCode },
          journalType: 'commitment',
        },
        ctx,
      );
      const budgetMinor = moved.ok ? moved.value.budgetAmount.amountMinor : q.amountMinor;
      const impact = await this.impacts.impact(tx, budget, budgetMinor, {
        pendingIncludesThis: false,
      });
      if (!actor.personId)
        return {
          route: null,
          impact,
          blockedCode: 'FORBIDDEN',
          blockedReason: 'Only people can raise requests.',
        };
      try {
        const { route } = await this.routing.plan(tx, {
          subject: 'request',
          requesterId: actor.personId,
          beneficiaryIds: [actor.personId],
          attendeeIds: [],
          budget,
          budgetAmount: { amountMinor: budgetMinor, currency: budget.currency },
          spendType: q.spendType,
          reportingCurrency: actor.reportingCurrency,
          remainingPctAfter:
            impact.authorized.amountMinor > 0
              ? Math.floor(
                  (impact.availableAfter.amountMinor * 100) / impact.authorized.amountMinor,
                )
              : null,
          forceFinanceReview: impact.warning?.startsWith('This goes over') ?? false,
          action: 'request.approve',
        });
        const names = await personNames(tx, [
          ...route.steps.map((s) => s.personId),
          ...route.skipped.map((s) => s.personId),
        ]);
        return {
          route: {
            steps: route.steps.map((s) => ({
              stepNo: s.stepNo,
              taskId: null,
              personId: s.personId,
              personName: names.get(s.personId) ?? '',
              resolver: s.resolver,
              reason: s.reason,
              limit: { amountMinor: s.limitMinor, currency: 'USD' },
              status: 'waiting',
              decidedAt: null,
              actedByName: null,
              onBehalfOfName: null,
              comment: null,
              channel: null,
              dueAt: null,
            })),
            skipped: route.skipped.map((s) => ({
              personName: names.get(s.personId) ?? '',
              reason: s.reason,
              detail: s.detail,
            })),
            explanation: route.explanation,
          },
          impact,
          blockedCode: impact.blockedCode,
          blockedReason: impact.blocked,
        };
      } catch (e) {
        if (e instanceof ApiProblem)
          return { route: null, impact, blockedCode: e.code, blockedReason: e.detail };
        throw e;
      }
    });
  }

  /** Posting budget with balances without taking a lock (simulation only). */
  private async lockFree(tx: Tx, budget: BudgetRow) {
    const bal = (await this.posting.reads.balances(tx, [budget.id])).get(budget.id)!;
    return { ...toPostingBudget(budget), balances: bal.budget, row: budget };
  }
}
