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
  contributionRequests,
  eventCoOrganizers,
  eventParticipants,
  events,
  legalEntities,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { toPostingBudget } from '@bf/api/ledger';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import {
  FundingSourcesService,
  PostingSupport,
  RequestsService,
  SpendHooks,
  type PostCtx,
} from '@bf/api/spend';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  BudgetImpact,
  CandidateGivingBudget,
  ContributionDetail,
  ContributionSummary,
  CreateContributionBody,
  DecisionRequest,
  DecisionResponse,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  availableOf,
  checkFundingCeiling,
  contributionMachine,
  postContributionTransfer,
  postSpendMovement,
  type ContributionStatus,
  type CurrencyCode,
} from '@bf/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { IntercompanyService } from './intercompany.service';

type ContributionRow = typeof contributionRequests.$inferSelect;
type EventRow = typeof events.$inferSelect;
/** `fixedId`: seed only, never exposed through the API. */
type Ctx = { idempotencyKey: string; requestId: string | null; fixedId?: string };

const PENDING: ContributionStatus[] = ['submitted', 'pending_approval'];
const WAITING: ContributionStatus[] = ['submitted', 'pending_approval', 'changes_requested'];
const OPEN_EVENT = ['draft', 'submitted', 'approved', 'funded', 'in_progress'];

/**
 * Inter-Director Budget Contribution Request: a controlled, approved and audited contribution from
 * another director's budget to an event, never free-form sharing. The giving director (within DoA)
 * contributes in full, in part, declines or asks for changes; approved money is earmarked on the
 * giving budget (default) or transferred, with per-contributor attribution and intercompany
 * handling when the legal entities differ.
 */
@Injectable()
export class ContributionsService implements ApprovalSubjectHandler, OnModuleInit {
  readonly type = 'contribution' as const;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly posting: PostingSupport,
    private readonly sources: FundingSourcesService,
    private readonly requests: RequestsService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly routing: RoutingService,
    private readonly impacts: BudgetImpactService,
    private readonly intercompany: IntercompanyService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly documents: DocumentsService,
    private readonly hooks: SpendHooks,
  ) {}

  onModuleInit(): void {
    this.handlers.register(this);
    this.documents.registerOwner({
      type: 'contribution',
      canRead: async (tx, actor, id) => {
        const s = await this.load(tx, id);
        return Boolean(s && (await this.canView(tx, actor, s)));
      },
      canWrite: async (tx, actor, id) => {
        const [r] = await tx
          .select()
          .from(contributionRequests)
          .where(eq(contributionRequests.id, id));
        return Boolean(r && r.requesterPersonId === actor.personId);
      },
    });
  }

  private pc(
    actor: RequestActor,
    command: string,
    ctx: { requestId?: string | null; idempotencyKey?: string | null },
  ): PostCtx {
    return {
      actor,
      command,
      requestId: ctx.requestId ?? null,
      idempotencyKey: ctx.idempotencyKey ?? null,
    };
  }

  private async event(tx: Tx, id: string | null): Promise<EventRow | undefined> {
    if (!id) return undefined;
    return (await tx.select().from(events).where(eq(events.id, id)))[0];
  }

  private async row(tx: Tx, id: string, lock = false): Promise<ContributionRow | undefined> {
    const q = tx.select().from(contributionRequests).where(eq(contributionRequests.id, id));
    return (lock ? await q.for('update') : await q)[0];
  }

  // ApprovalSubjectHandler ------------------------------------------------------------------------

  async load(tx: Tx, id: string, opts: { lock?: boolean } = {}): Promise<ApprovalSubject | null> {
    const c = await this.row(tx, id, opts.lock);
    if (!c) return null;
    const budget = (await this.posting.budget(tx, c.giverBudgetId))!;
    const e = await this.event(tx, c.eventId);
    const attendees = e
      ? (
          await tx
            .select({ p: eventParticipants.personId })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, e.id))
        )
          .map((p) => p.p)
          .filter((p): p is string => Boolean(p))
      : [];
    const co = e
      ? (
          await tx
            .select({ p: eventCoOrganizers.personId })
            .from(eventCoOrganizers)
            .where(eq(eventCoOrganizers.eventId, e.id))
        ).map((x) => x.p)
      : [];
    const names = await personNames(tx, [c.requesterPersonId]);
    const receiver = c.receiverBudgetId
      ? await this.posting.budget(tx, c.receiverBudgetId)
      : undefined;
    return {
      type: 'contribution',
      id: c.id,
      ref: c.ref,
      title: e ? `Co-fund ${e.name}` : 'Inter-Director Budget Contribution',
      kindLabel: 'Inter-Director Budget Contribution Request',
      status: c.status,
      version: c.version,
      requesterId: c.requesterPersonId,
      requesterName: names.get(c.requesterPersonId) ?? '',
      beneficiaryIds: [
        ...new Set([c.requesterPersonId, ...(e ? [e.organizerPersonId] : []), ...co]),
      ],
      attendeeIds: attendees,
      budget,
      eventId: c.eventId,
      eventName: e?.name ?? null,
      purpose: c.purpose,
      spendType: e?.spendType ?? 'employee_events',
      neededBy: c.neededBy,
      amount: { amountMinor: c.requestedMinor, currency: c.currency as CurrencyCode },
      budgetAmount: { amountMinor: c.requestedMinor, currency: budget.currency as CurrencyCode },
      onHold: Boolean(c.heldAt),
      holdReason: c.holdReason,
      pending: PENDING.includes(c.status),
      contributionMode: c.mode,
      transferAllowed: Boolean(receiver && receiver.legalEntityId === budget.legalEntityId),
      detailsPath: `/contributions/${c.id}`,
    };
  }

  async canView(tx: Tx, actor: RequestActor, s: ApprovalSubject): Promise<boolean> {
    if (s.requesterId === actor.personId) return true;
    if (this.policy.can(actor, 'contribution.decide', budgetResourceOf(s.budget)).allowed)
      return true;
    if (this.policy.can(actor, 'budget.read', budgetResourceOf(s.budget)).allowed) return true;
    const c = (await this.row(tx, s.id))!;
    if (c.receiverBudgetId) {
      const r = await this.posting.budget(tx, c.receiverBudgetId);
      if (r && this.policy.can(actor, 'budget.read', budgetResourceOf(r)).allowed) return true;
    }
    const e = await this.event(tx, c.eventId);
    if (e && e.organizerPersonId === actor.personId) return true;
    return Boolean(await this.approvals.myTask(tx, actor, 'contribution', s.id));
  }

  impact(tx: Tx, s: ApprovalSubject): Promise<BudgetImpact> {
    return this.impacts.impact(tx, s.budget, s.budgetAmount.amountMinor, {
      pendingIncludesThis: false,
    });
  }

  private async ceiling(
    tx: Tx,
    e: EventRow,
    requestedMinor: number,
    exclude: string | null,
    includePending: boolean,
  ) {
    const srcs = await this.sources.list(tx, e.id);
    const approved = srcs
      .filter((s) => s.status !== 'cancelled')
      .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
    const pending = includePending
      ? (await this.requests.pendingFunding(tx, e.id)) +
        (await this.pendingContributions(tx, e.id, exclude))
      : 0;
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

  async pendingContributions(
    tx: Tx,
    eventId: string,
    exclude: string | null = null,
  ): Promise<number> {
    const rows = await tx
      .select({ id: contributionRequests.id, a: contributionRequests.requestedMinor })
      .from(contributionRequests)
      .where(
        and(
          eq(contributionRequests.eventId, eventId),
          inArray(contributionRequests.status, PENDING),
        ),
      );
    return rows.filter((r) => r.id !== exclude).reduce((a, r) => a + r.a, 0);
  }

  async approve(
    tx: Tx,
    s: ApprovalSubject,
    approvedMinor: number,
    ctx: DecisionContext,
    opts: { mode?: 'earmark' | 'transfer' },
  ): Promise<HandlerOutcome> {
    const c = (await this.row(tx, s.id, true))!;
    const e = (await this.event(tx, c.eventId))!;
    const mode = opts.mode ?? c.mode;
    const receiverId = c.receiverBudgetId ?? e.budgetId!;
    const locked = await this.posting.lock(
      tx,
      mode === 'transfer' ? [c.giverBudgetId, receiverId] : [c.giverBudgetId],
    );
    const giver = locked.get(c.giverBudgetId)!;
    unwrap(acceptsNewActivity(giver.status));
    await this.ceiling(tx, e, approvedMinor, c.id, false);
    const pc = this.pc(ctx.actor, 'contributions.approve', ctx);
    const pctx = await this.posting.context(tx, giver, ctx.actor.reportingCurrency);
    const amount = { amountMinor: approvedMinor, currency: c.currency as CurrencyCode };
    const changes: Record<string, unknown> = { mode };
    const cross = giver.legalEntityId !== e.legalEntityId;
    let rechargeId: string | null = null;
    if (cross) {
      const { policy, result } = await this.intercompany.treatment(
        tx,
        giver.legalEntityId,
        e.legalEntityId,
        approvedMinor,
      );
      const treatment = unwrap(result);
      if (treatment.kind === 'recharge') {
        const recharge = await this.intercompany.scheduleRecharge(tx, pc, {
          contributionId: c.id,
          eventId: e.id,
          fromEntityId: giver.legalEntityId,
          toEntityId: e.legalEntityId,
          policy,
          treatment,
          amount,
        });
        rechargeId = recharge.id;
        changes['recharge'] = {
          id: recharge.id,
          status: recharge.status,
          markupMinor: recharge.markupMinor,
        };
      }
    }
    if (mode === 'transfer' && cross) {
      throw new ApiProblem(
        422,
        'TRANSFER_NOT_ALLOWED',
        'Transfers are only possible within one legal entity; earmark instead.',
      );
    }
    const prov = { contributionId: c.id, eventId: e.id };
    const journalIds: string[] = [];
    let holder = giver;
    if (mode === 'transfer') {
      const receiver = locked.get(receiverId)!;
      const moved = unwrap(
        postContributionTransfer(
          {
            giver,
            receiver,
            amount,
            provenance: prov,
            reason: `Inter-Director Budget Contribution ${c.ref}`,
          },
          pctx,
        ),
      );
      journalIds.push(...(await this.posting.post(tx, [moved.journal], giver.fiscalYearId, pc)));
      holder = {
        ...receiver,
        balances: {
          ...receiver.balances,
          authorized: receiver.balances.authorized + moved.receiverAmount.amountMinor,
        },
      };
    }
    const held = unwrap(
      postSpendMovement(
        {
          kind: 'hold',
          budget: holder,
          amount,
          journalType: 'contribution',
          provenance: prov,
          reason: `Earmark for ${e.name} (${c.ref})`,
        },
        pctx,
      ),
    );
    journalIds.push(...(await this.posting.post(tx, held.journals, holder.fiscalYearId, pc)));
    const source = await this.sources.add(tx, {
      tenantId: ctx.actor.tenantId,
      eventId: e.id,
      kind: 'contribution',
      budgetId: holder.id,
      originBudgetId: giver.id,
      contributionRequestId: c.id,
      mode,
      fundedMinor: held.budgetAmount.amountMinor,
      currency: holder.currency,
    });
    const decided = unwrap(
      contributionMachine.next(
        c.status,
        approvedMinor < c.requestedMinor ? 'approve_partial' : 'approve_full',
      ),
    );
    const status = unwrap(
      contributionMachine.next(decided, mode === 'transfer' ? 'transfer' : 'earmark'),
    );
    await tx
      .update(contributionRequests)
      .set({
        status,
        approvedMinor,
        mode,
        decidedByPersonId: ctx.actor.personId,
        decidedAt: new Date(),
        reasonCode: ctx.reasonCode,
        message: ctx.reason,
        decisionReason: ctx.reason,
        fundingSourceId: source.id,
        rechargeScheduleId: rechargeId,
        intercompanyMode: cross ? c.intercompanyMode : null,
        updatedAt: new Date(),
      })
      .where(eq(contributionRequests.id, c.id));
    await this.hooks.fundingDecided(tx, ctx.actor, e.id, 'approved', 'additional_fund');
    changes['journalIds'] = journalIds;
    changes['fundingSourceId'] = source.id;
    changes['earmarked'] = held.budgetAmount;
    return { status, changes };
  }

  private async decideWithout(
    tx: Tx,
    s: ApprovalSubject,
    ctx: DecisionContext,
    event: 'reject' | 'request_changes',
  ): Promise<HandlerOutcome> {
    const c = (await this.row(tx, s.id, true))!;
    const status = unwrap(contributionMachine.next(c.status, event));
    await tx
      .update(contributionRequests)
      .set({
        status,
        decidedByPersonId: ctx.actor.personId,
        decidedAt: new Date(),
        reasonCode: ctx.reasonCode,
        message: ctx.reason,
        decisionReason: ctx.reason,
        updatedAt: new Date(),
      })
      .where(eq(contributionRequests.id, c.id));
    return { status, changes: {} };
  }

  reject(tx: Tx, s: ApprovalSubject, ctx: DecisionContext): Promise<HandlerOutcome> {
    return this.decideWithout(tx, s, ctx, 'reject');
  }

  requestChanges(tx: Tx, s: ApprovalSubject, ctx: DecisionContext): Promise<HandlerOutcome> {
    return this.decideWithout(tx, s, ctx, 'request_changes');
  }

  // Commands --------------------------------------------------------------------------------------

  private async canAskFor(tx: Tx, actor: RequestActor, e: EventRow): Promise<boolean> {
    if (e.organizerPersonId === actor.personId) return true;
    const co = await tx
      .select({ p: eventCoOrganizers.personId })
      .from(eventCoOrganizers)
      .where(eq(eventCoOrganizers.eventId, e.id));
    if (co.some((x) => x.p === actor.personId)) return true;
    const home = e.budgetId ? await this.posting.budget(tx, e.budgetId) : undefined;
    return Boolean(
      home && this.policy.can(actor, 'contribution.request', budgetResourceOf(home)).allowed,
    );
  }

  create(
    actor: RequestActor,
    body: CreateContributionBody,
    ctx: Ctx,
  ): Promise<CommandResult<ContributionDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'contributions.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const e = await this.event(tx, body.eventId);
        if (!e) throw ApiProblem.notFound('event');
        if (!(await this.canAskFor(tx, actor, e)))
          throw ApiProblem.forbidden('Only the event’s organizers can ask for contributions.');
        if (!OPEN_EVENT.includes(e.status))
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Contributions can only be asked for events that are still open.',
          );
        const giver = await this.posting.budget(tx, body.giverBudgetId);
        if (!giver) throw ApiProblem.notFound('giving budget');
        if (giver.id === e.budgetId)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Ask another director’s budget; the home budget funds the event directly.',
            { field: 'giverBudgetId' },
          );
        if (giver.currency !== e.currency || body.amount.currency !== giver.currency) {
          throw new ApiProblem(
            422,
            'CURRENCY_MISMATCH',
            `Contributions are in the event currency (${e.currency}).`,
          );
        }
        unwrap(acceptsNewActivity(giver.status));
        const cross = giver.legalEntityId !== e.legalEntityId;
        const mode = body.mode ?? 'earmark';
        if (mode === 'transfer' && cross)
          throw new ApiProblem(
            422,
            'TRANSFER_NOT_ALLOWED',
            'Transfers are only possible within one legal entity; earmark instead.',
          );
        let intercompanyMode: ContributionRow['intercompanyMode'] = null;
        if (cross) {
          const { policy, result } = await this.intercompany.treatment(
            tx,
            giver.legalEntityId,
            e.legalEntityId,
            body.amount.amountMinor,
          );
          unwrap(result);
          intercompanyMode = policy.mode;
        }
        await this.ceiling(tx, e, body.amount.amountMinor, null, true);
        const [c] = await tx
          .insert(contributionRequests)
          .values({
            ...(ctx.fixedId ? { id: ctx.fixedId } : {}),
            tenantId: actor.tenantId,
            eventId: e.id,
            requesterPersonId: actor.personId,
            giverBudgetId: giver.id,
            receiverBudgetId: e.budgetId,
            requestedMinor: body.amount.amountMinor,
            currency: body.amount.currency,
            mode,
            status: unwrap(
              contributionMachine.next(
                unwrap(contributionMachine.next('draft', 'submit')),
                'route',
              ),
            ),
            purpose: body.purpose,
            neededBy: body.neededBy ?? null,
            intercompanyMode,
            submittedAt: new Date(),
          })
          .returning();
        const subject = (await this.load(tx, c.id))!;
        const { route, limitAmount } = await this.routing.plan(tx, {
          subject: 'contribution',
          requesterId: actor.personId,
          beneficiaryIds: subject.beneficiaryIds,
          attendeeIds: subject.attendeeIds,
          budget: giver,
          budgetAmount: subject.budgetAmount,
          spendType: subject.spendType,
          reportingCurrency: actor.reportingCurrency,
          remainingPctAfter: null,
          action: 'contribution.decide',
        });
        await this.approvals.start(tx, actor, subject, route, limitAmount.currency);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'contribution.submitted',
          resourceType: 'contribution',
          resourceId: c.id,
          legalEntityId: giver.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            status: { from: null, to: c.status },
            eventId: { from: null, to: e.id },
            giverBudgetId: { from: null, to: giver.id },
            requested: { from: null, to: body.amount },
            mode: { from: null, to: mode },
            ...(cross ? { intercompanyMode: { from: null, to: intercompanyMode } } : {}),
          },
        });
        await this.analytics.track(tx, actor, 'contribution.requested', {
          crossEntity: cross,
          mode,
        });
        return this.detailTx(tx, actor, c.id);
      },
    );
  }

  decide(
    actor: RequestActor,
    id: string,
    req: DecisionRequest,
    ctx: Ctx,
  ): Promise<CommandResult<DecisionResponse>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `contributions.decide:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const s = await this.load(tx, id);
        if (!s || !(await this.canView(tx, actor, s))) throw ApiProblem.notFound('contribution');
        const taskId = await this.approvals.myTask(tx, actor, 'contribution', id);
        if (!taskId) {
          if (!s.pending)
            throw new ApiProblem(
              409,
              'APPROVAL_NOT_PENDING',
              'This contribution request was already decided.',
            );
          throw new ApiProblem(
            403,
            'APPROVAL_NOT_ASSIGNED',
            'The giving director decides this contribution request.',
          );
        }
        return this.approvals.decideTx(tx, actor, taskId, req, {
          channel: 'web',
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
        });
      },
    );
  }

  withdraw(actor: RequestActor, id: string, ctx: Ctx): Promise<CommandResult<ContributionDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `contributions.withdraw:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const c = await this.row(tx, id, true);
        if (!c) throw ApiProblem.notFound('contribution');
        if (c.requesterPersonId !== actor.personId)
          throw ApiProblem.forbidden('Only the requester can withdraw.');
        const status = unwrap(contributionMachine.next(c.status, 'withdraw'));
        await this.approvals.cancelFor(tx, 'contribution', c.id);
        await tx
          .update(contributionRequests)
          .set({ status, updatedAt: new Date() })
          .where(eq(contributionRequests.id, c.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'contribution.withdrawn',
          resourceType: 'contribution',
          resourceId: c.id,
          requestId: ctx.requestId,
          changes: { status: { from: c.status, to: status } },
        });
        return this.detailTx(tx, actor, id);
      },
    );
  }

  // Budget controls (worker) ----------------------------------------------------------------------

  async cancelWaitingForBudget(
    tx: Tx,
    actor: RequestActor,
    budgetId: string,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(contributionRequests)
      .where(
        and(
          eq(contributionRequests.giverBudgetId, budgetId),
          inArray(contributionRequests.status, WAITING),
        ),
      )
      .for('update');
    for (const c of rows) {
      await this.approvals.cancelFor(tx, 'contribution', c.id);
      const status = unwrap(contributionMachine.next(c.status, 'cancel'));
      await tx
        .update(contributionRequests)
        .set({
          status,
          cancelReason: reason,
          heldAt: null,
          holdReason: null,
          updatedAt: new Date(),
        })
        .where(eq(contributionRequests.id, c.id));
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: null,
        actorSubject: actor.subject,
        action: 'contribution.cancelled',
        resourceType: 'contribution',
        resourceId: c.id,
        reason,
        changes: { status: { from: c.status, to: status } },
      });
      const recipient = await this.notifications.personEmail(tx, c.requesterPersonId);
      if (recipient) {
        await this.notifications.queueEmail(
          tx,
          actor.tenantId,
          recipient,
          noticeEmail({
            firstName: recipient.firstName,
            subject: `Co-funding request ${c.ref} was cancelled: budget set to zero`,
            headline: `Your Inter-Director Budget Contribution Request ${c.ref} was cancelled because the giving budget was set to zero.`,
            lines: [
              ['Request', c.ref],
              ['Requested', formatMoney({ amountMinor: c.requestedMinor, currency: c.currency })],
              ['Reason', reason],
            ],
            detailsUrl: `${this.notifications.webBaseUrl}/contributions/${c.id}`,
          }),
          'contribution.cancelled',
        );
      }
    }
    return rows.length;
  }

  async holdWaitingForBudget(
    tx: Tx,
    actor: RequestActor,
    budgetId: string,
    hold: boolean,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .select()
      .from(contributionRequests)
      .where(
        and(
          eq(contributionRequests.giverBudgetId, budgetId),
          inArray(contributionRequests.status, WAITING),
          hold
            ? sql`${contributionRequests.heldAt} is null`
            : isNotNull(contributionRequests.heldAt),
        ),
      )
      .for('update');
    for (const c of rows) {
      await tx
        .update(contributionRequests)
        .set(hold ? { heldAt: new Date(), holdReason: reason } : { heldAt: null, holdReason: null })
        .where(eq(contributionRequests.id, c.id));
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: null,
        actorSubject: actor.subject,
        action: hold ? 'contribution.held' : 'contribution.released',
        resourceType: 'contribution',
        resourceId: c.id,
        reason,
        changes: { onHold: { from: !hold, to: hold } },
      });
    }
    return rows.length;
  }

  // Reads -----------------------------------------------------------------------------------------

  async summaries(
    tx: Tx,
    rows: ContributionRow[],
    viewer: RequestActor,
  ): Promise<ContributionSummary[]> {
    if (!rows.length) return [];
    const budgetIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.giverBudgetId, r.receiverBudgetId].filter((x): x is string => Boolean(x)),
        ),
      ),
    ];
    const bs = await tx.select().from(budgets).where(inArray(budgets.id, budgetIds));
    const bmap = new Map(bs.map((b) => [b.id, b]));
    const evIds = [...new Set(rows.map((r) => r.eventId).filter((x): x is string => Boolean(x)))];
    const evs = evIds.length ? await tx.select().from(events).where(inArray(events.id, evIds)) : [];
    const entities = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (e) => [e.id, e.name],
      ),
    );
    const names = await personNames(tx, [
      ...rows.map((r) => r.requesterPersonId),
      ...rows.map((r) => r.decidedByPersonId),
      ...bs.map((b) => b.ownerPersonId),
    ]);
    const out: ContributionSummary[] = [];
    for (const r of rows) {
      const giver = bmap.get(r.giverBudgetId)!;
      const receiver = r.receiverBudgetId ? bmap.get(r.receiverBudgetId) : undefined;
      const e = evs.find((x) => x.id === r.eventId);
      const receiverEntity = e?.legalEntityId ?? receiver?.legalEntityId ?? giver.legalEntityId;
      const cross = giver.legalEntityId !== receiverEntity;
      let intercompany: ContributionSummary['intercompany'] = null;
      if (cross) {
        const policy = await this.intercompany.policyFor(tx, giver.legalEntityId, receiverEntity);
        const recharge = r.rechargeScheduleId
          ? ((
              await this.intercompany.views(
                tx,
                viewer,
                await this.intercompany.byIds(tx, [r.rechargeScheduleId]),
              )
            )[0] ?? null)
          : null;
        const mode = r.intercompanyMode ?? policy.mode;
        intercompany = {
          crossEntity: true,
          giverEntityName: entities.get(giver.legalEntityId) ?? '',
          receiverEntityName: entities.get(receiverEntity) ?? '',
          mode,
          markupBps: policy.markupBps,
          rechargeId: recharge?.id ?? null,
          rechargeStatus: recharge?.status ?? null,
          taxApproverName:
            recharge?.taxApproverName ??
            (policy.taxApproverPersonId
              ? ((await personNames(tx, [policy.taxApproverPersonId])).get(
                  policy.taxApproverPersonId,
                ) ?? null)
              : null),
          message:
            mode === 'block'
              ? 'Contributions between these legal entities are blocked by the intercompany policy.'
              : mode === 'recharge_with_markup'
                ? `Cross-entity: recharged with a ${policy.markupBps / 100}% markup${policy.taxApproverPersonId ? ' after tax approval' : ''}.`
                : `Cross-entity: recharged at cost${policy.taxApproverPersonId ? ' after tax approval' : ''}.`,
        };
      }
      out.push({
        id: r.id,
        ref: r.ref,
        status: r.status,
        eventId: r.eventId,
        eventName: e?.name ?? null,
        eventCode: e?.eventCode ?? null,
        requesterPersonId: r.requesterPersonId,
        requesterName: names.get(r.requesterPersonId) ?? '',
        giverBudgetId: giver.id,
        giverBudgetName: giver.name,
        giverOwnerName: giver.ownerPersonId ? (names.get(giver.ownerPersonId) ?? null) : null,
        receiverBudgetId: r.receiverBudgetId,
        receiverBudgetName: receiver?.name ?? null,
        requested: { amountMinor: r.requestedMinor, currency: r.currency },
        approved:
          r.approvedMinor !== null ? { amountMinor: r.approvedMinor, currency: r.currency } : null,
        mode: r.mode,
        purpose: r.purpose,
        neededBy: r.neededBy,
        reasonCode: r.reasonCode,
        decisionReason: r.decisionReason,
        message: r.message,
        decidedByName: r.decidedByPersonId ? (names.get(r.decidedByPersonId) ?? null) : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        onHold: Boolean(r.heldAt),
        holdReason: r.holdReason,
        cancelReason: r.cancelReason,
        intercompany,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      });
    }
    return out;
  }

  list(
    actor: RequestActor,
    q: { eventId?: string; role?: 'giver' | 'requester' | 'all' },
  ): Promise<{ items: ContributionSummary[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const role = q.role ?? 'all';
      const conds: SQL[] = [];
      const tenantWide = this.policy.can(actor, 'budget.read', {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: '',
        path: '/',
      }).allowed;
      const giverCond = actor.ownedBudgetPaths.length
        ? inArray(
            contributionRequests.giverBudgetId,
            tx
              .select({ id: budgets.id })
              .from(budgets)
              .where(or(...actor.ownedBudgetPaths.map((p) => like(budgets.path, `${p}%`)))),
          )
        : undefined;
      const requesterCond = actor.personId
        ? eq(contributionRequests.requesterPersonId, actor.personId)
        : undefined;
      if (role === 'giver') {
        if (!giverCond) return { items: [] };
        conds.push(giverCond);
      } else if (role === 'requester') {
        if (!requesterCond) return { items: [] };
        conds.push(requesterCond);
      } else if (!tenantWide) {
        const eventCond = q.eventId ? eq(contributionRequests.eventId, q.eventId) : undefined;
        const any = [giverCond, requesterCond].filter((x): x is SQL => Boolean(x));
        if (q.eventId) {
          const e = await this.event(tx, q.eventId);
          if (e && (await this.canSeeEvent(tx, actor, e))) any.push(eventCond!);
        }
        if (!any.length) return { items: [] };
        conds.push(or(...any)!);
      }
      if (q.eventId) conds.push(eq(contributionRequests.eventId, q.eventId));
      const rows = await tx
        .select()
        .from(contributionRequests)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(contributionRequests.createdAt))
        .limit(200);
      return { items: await this.summaries(tx, rows, actor) };
    });
  }

  /** Event visibility used for its contributions list (organizers, contributors, readers of the home budget). */
  async canSeeEvent(tx: Tx, actor: RequestActor, e: EventRow): Promise<boolean> {
    if (e.organizerPersonId === actor.personId) return true;
    const co = await tx
      .select({ p: eventCoOrganizers.personId })
      .from(eventCoOrganizers)
      .where(eq(eventCoOrganizers.eventId, e.id));
    if (co.some((x) => x.p === actor.personId)) return true;
    const home = e.budgetId ? await this.posting.budget(tx, e.budgetId) : undefined;
    if (home && this.policy.can(actor, 'budget.read', budgetResourceOf(home)).allowed) return true;
    const givers = await tx
      .select({ g: contributionRequests.giverBudgetId })
      .from(contributionRequests)
      .where(eq(contributionRequests.eventId, e.id));
    for (const g of givers) {
      const b = await this.posting.budget(tx, g.g);
      if (b && this.policy.can(actor, 'contribution.decide', budgetResourceOf(b)).allowed)
        return true;
    }
    return false;
  }

  get(actor: RequestActor, id: string): Promise<ContributionDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detailTx(tx, actor, id),
    );
  }

  async detailTx(tx: Tx, actor: RequestActor, id: string): Promise<ContributionDetail> {
    const s = await this.load(tx, id);
    if (!s || !(await this.canView(tx, actor, s))) throw ApiProblem.notFound('contribution');
    const c = (await this.row(tx, id))!;
    const [summary] = await this.summaries(tx, [c], actor);
    const myTaskId = await this.approvals.myTask(tx, actor, 'contribution', id);
    const giverVisible =
      Boolean(myTaskId) ||
      this.policy.can(actor, 'contribution.decide', budgetResourceOf(s.budget)).allowed ||
      this.policy.can(actor, 'budget.read', budgetResourceOf(s.budget)).allowed;
    let giverPosition: ContributionDetail['giverPosition'] = null;
    if (giverVisible) {
      const bal = (await this.posting.reads.balances(tx, [s.budget.id])).get(s.budget.id)!.budget;
      const posting = toPostingBudget(s.budget);
      const available = availableOf(bal, posting.control.basis);
      const after = available - c.requestedMinor;
      const m = (amountMinor: number) => ({ amountMinor, currency: s.budget.currency });
      giverPosition = {
        authorized: m(bal.authorized),
        held: m(bal.held),
        available: m(available),
        availableAfterFull: m(after),
        lowAfterFull: bal.authorized > 0 && after * 10 < bal.authorized,
      };
    }
    const e = await this.event(tx, c.eventId);
    let cofunding: ContributionDetail['cofunding'] = null;
    if (e) {
      const srcs = await this.sources.list(tx, e.id);
      const funded = srcs.reduce((a, x) => a + x.fundedMinor - x.returnedMinor, 0);
      const pending =
        (await this.requests.pendingFunding(tx, e.id)) +
        (await this.pendingContributions(tx, e.id));
      const tol = Math.floor((e.estimateMinor * e.toleranceBps) / 10_000);
      const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
      cofunding = {
        estimate: m(e.estimateMinor),
        cap: m(Math.min(funded, e.estimateMinor + tol)),
        funded: m(funded),
        pending: m(pending),
        gap: m(Math.max(e.estimateMinor - funded, 0)),
      };
    }
    const allowed: ContributionDetail['allowedActions'] = [];
    if (myTaskId) allowed.push('decide');
    if (c.requesterPersonId === actor.personId && WAITING.includes(c.status))
      allowed.push('withdraw');
    if (c.requesterPersonId === actor.personId) allowed.push('upload');
    return {
      ...summary,
      route: await this.approvals.routeView(tx, 'contribution', id),
      giverPosition,
      cofunding,
      transferAllowed: s.transferAllowed,
      allowedActions: allowed,
      myTaskId,
      activity: await this.approvals.activity(tx, [{ type: 'contribution', id }]),
      documents: await this.documents.listTx(tx, 'contribution', id, actor.personId),
    };
  }

  /** Budgets a contribution can be asked from: names, owners and the intercompany treatment, never balances. */
  candidates(actor: RequestActor, eventId: string): Promise<{ items: CandidateGivingBudget[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const e = await this.event(tx, eventId);
      if (!e || !(await this.canSeeEvent(tx, actor, e))) throw ApiProblem.notFound('event');
      const rows = await tx
        .select()
        .from(budgets)
        .where(
          and(
            ne(budgets.status, 'cancelled'),
            eq(budgets.currency, e.currency),
            e.budgetId ? ne(budgets.id, e.budgetId) : undefined,
          ),
        )
        .orderBy(asc(budgets.depth), asc(budgets.name))
        .limit(200);
      const entities = new Map(
        (
          await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)
        ).map((x) => [x.id, x.name]),
      );
      const owners = await personNames(
        tx,
        rows.map((r) => r.ownerPersonId),
      );
      const out: CandidateGivingBudget[] = [];
      for (const b of rows.filter((r) => r.ownerPersonId && r.ownerPersonId !== actor.personId)) {
        const cross = b.legalEntityId !== e.legalEntityId;
        const policy = cross
          ? await this.intercompany.policyFor(tx, b.legalEntityId, e.legalEntityId)
          : null;
        const status = acceptsNewActivity(b.status);
        out.push({
          budgetId: b.id,
          name: b.name,
          code: b.code,
          ownerName: owners.get(b.ownerPersonId!) ?? null,
          legalEntityId: b.legalEntityId,
          legalEntityName: entities.get(b.legalEntityId) ?? '',
          currency: b.currency,
          crossEntity: cross,
          intercompanyMode: policy?.mode ?? null,
          blockedReason: !status.ok
            ? status.error.message
            : policy?.mode === 'block'
              ? 'Blocked by the intercompany policy.'
              : null,
        });
      }
      return { items: out };
    });
  }

  /** Contributions of an event for the event detail and the co-funding board (amounts only). */
  async forEvents(tx: Tx, eventIds: readonly string[]): Promise<ContributionRow[]> {
    if (!eventIds.length) return [];
    return tx
      .select()
      .from(contributionRequests)
      .where(inArray(contributionRequests.eventId, [...eventIds]))
      .orderBy(asc(contributionRequests.createdAt));
  }

  async giverInfo(
    tx: Tx,
    rows: ContributionRow[],
  ): Promise<Map<string, { name: string; ownerName: string | null }>> {
    const ids = [...new Set(rows.map((r) => r.giverBudgetId))];
    if (!ids.length) return new Map();
    const bs = await tx.select().from(budgets).where(inArray(budgets.id, ids));
    const owners = await personNames(
      tx,
      bs.map((b) => b.ownerPersonId),
    );
    return new Map(
      bs.map((b) => [
        b.id,
        { name: b.name, ownerName: b.ownerPersonId ? (owners.get(b.ownerPersonId) ?? null) : null },
      ]),
    );
  }

  rechargeList(actor: RequestActor, eventId?: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const tenantWide = this.policy.can(actor, 'budget.read', {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: '',
        path: '/',
      }).allowed;
      if (eventId) {
        const e = await this.event(tx, eventId);
        if (!e || !(await this.canSeeEvent(tx, actor, e))) throw ApiProblem.notFound('event');
      } else if (!tenantWide && !actor.personId) {
        throw ApiProblem.forbidden();
      }
      return {
        items: await this.intercompany.views(
          tx,
          actor,
          await this.intercompany.list(tx, actor, eventId),
        ),
      };
    });
  }

  approveRecharge(actor: RequestActor, id: string, ctx: Ctx) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `recharges.approve:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const row = await this.intercompany.approve(
          tx,
          { ...this.pc(actor, 'recharges.approve', ctx), actor },
          id,
        );
        return (await this.intercompany.views(tx, actor, [row]))[0];
      },
    );
  }

  policies(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (
        !this.policy.can(actor, 'budget.read', {
          kind: 'budget',
          tenantId: actor.tenantId,
          id: '',
          path: '/',
        }).allowed &&
        !actor.ownedBudgetPaths.length
      ) {
        throw ApiProblem.forbidden();
      }
      return { items: await this.intercompany.policies(tx) };
    });
  }
}

export type { BudgetRow };
