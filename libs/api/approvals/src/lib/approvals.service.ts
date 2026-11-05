import {
  ActorResolver,
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  approvalActions,
  approvalActionTokens,
  approvalDelegations,
  approvalInstances,
  approvalTasks,
  memberships,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  approvalRequestEmail,
  formatMoney,
  noticeEmail,
  NotificationsService,
} from '@bf/api/notifications';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  ActivityEntry,
  ApprovalInbox,
  ApprovalRouteView,
  ApprovalTaskDetail,
  ApprovalTaskSummary,
  CreateDelegationRequest,
  DecisionRequest,
  DecisionResponse,
  DelegationView,
  EmailActionPreview,
  EmailActionRequest,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  can,
  checkApprovalHygiene,
  checkAuthority,
  checkDecisionAuthority,
  type Action,
  type ApprovalRoute,
  type Delegation,
  type Resource,
  type RouteStep,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { ApprovalLinks } from './approval-links';
import {
  ApprovalHandlers,
  type ApprovalSubject,
  type BudgetRow,
  type DecisionContext,
  type Money,
  type SubjectType,
} from './approval-handlers';
import { RoutingService, todayUtc } from './routing.service';

type TaskRow = typeof approvalTasks.$inferSelect;
type InstanceRow = typeof approvalInstances.$inferSelect;

/** Planned route stored on the instance (`explanation`): steps are created as tasks when reached. */
interface PlanJson {
  steps: RouteStep[];
  skipped: { personId: string; reason: string; detail: string }[];
  explanation: string[];
  /** Amount still asked (transaction currency): lowered by a partial approval at an earlier step. */
  approvedMinor: number;
  currency: string;
}

export const budgetResourceOf = (b: BudgetRow): Resource => ({
  kind: 'budget',
  tenantId: b.tenantId,
  id: b.id,
  path: b.path,
  orgUnitId: b.orgUnitId,
});

export const DECIDE_ACTION: Record<SubjectType, Action> = {
  request: 'request.approve',
  contribution: 'contribution.decide',
};

const SLA_HOURS = 48;
const VERB: Record<string, string> = {
  approve: 'approved',
  approve_partial: 'approved_partial',
  reject: 'rejected',
  request_changes: 'changes_requested',
  escalate: 'escalated',
};

export async function personNames(tx: Tx, ids: readonly (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (!list.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(inArray(people.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** System actor for worker-driven changes (budget controls); audited as `system:worker`. */
export const systemActor = (tenantId: string): RequestActor => ({
  tenantId,
  personId: null,
  roles: [],
  ownedBudgetPaths: [],
  subject: 'system:worker',
  displayName: 'BudgetFlow',
  tenantName: '',
  reportingCurrency: 'USD',
  memberships: [],
});

/**
 * The approval engine: plans routes (hierarchy + DoA), creates tasks step by step, re-checks
 * authority, hygiene, holds and budget status at every decision under lock, writes one audit entry
 * per decision, notifies by email with signed single-use links, and hands money to the subject's
 * handler. Decisions from the web and from email go through the same `decideTx`.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly actors: ActorResolver,
    private readonly audit: AuditService,
    private readonly handlers: ApprovalHandlers,
    private readonly routing: RoutingService,
    private readonly links: ApprovalLinks,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Starts the route planned for a submitted subject: the instance, the first task and its email. */
  async start(
    tx: Tx,
    actor: RequestActor,
    subject: ApprovalSubject,
    route: ApprovalRoute,
    limitCurrency: string,
  ): Promise<{ instanceId: string; taskId: string }> {
    const plan: PlanJson = {
      steps: route.steps,
      skipped: route.skipped,
      explanation: route.explanation,
      approvedMinor: subject.amount.amountMinor,
      currency: subject.amount.currency,
    };
    const [instance] = await tx
      .insert(approvalInstances)
      .values({
        tenantId: actor.tenantId,
        subjectType: subject.type,
        subjectId: subject.id,
        status: 'pending',
        explanation: plan,
        subjectVersion: subject.version,
        currentStep: 1,
      })
      .returning();
    const task = await this.createTask(tx, instance, route.steps[0], limitCurrency, null);
    await this.notifyApprover(tx, actor, subject, task, plan.approvedMinor);
    return { instanceId: instance.id, taskId: task.id };
  }

  private async createTask(
    tx: Tx,
    instance: InstanceRow,
    step: RouteStep,
    limitCurrency: string,
    escalatedFrom: string | null,
  ): Promise<TaskRow> {
    const [task] = await tx
      .insert(approvalTasks)
      .values({
        tenantId: instance.tenantId,
        instanceId: instance.id,
        stepNo: step.stepNo,
        assigneePersonId: step.personId,
        resolver: step.resolver,
        status: 'pending',
        dueAt: new Date(Date.now() + SLA_HOURS * 3600_000),
        escalatedFromTaskId: escalatedFrom,
        reason: step.reason,
        doaLimitMinor: step.limitMinor,
        doaCurrency: limitCurrency,
      })
      .returning();
    return task;
  }

  /** Email to the approver with signed, single-use, expiring Approve and Reject links (061a). */
  private async notifyApprover(
    tx: Tx,
    actor: RequestActor,
    subject: ApprovalSubject,
    task: TaskRow,
    askedMinor: number,
  ): Promise<void> {
    const recipient = await this.notifications.personEmail(tx, task.assigneePersonId);
    if (!recipient) return;
    const expiresAt = new Date(Date.now() + this.links.ttlHours * 3600_000);
    const tokens = await tx
      .insert(approvalActionTokens)
      .values(
        (['approve', 'reject'] as const).map((action) => ({
          tenantId: task.tenantId,
          taskId: task.id,
          approverPersonId: task.assigneePersonId,
          action,
          subjectVersion: subject.version,
          expiresAt,
        })),
      )
      .returning();
    const link = (action: string) => {
      const t = tokens.find((x) => x.action === action)!;
      return `${this.notifications.webBaseUrl}/email-action?token=${encodeURIComponent(this.links.token(task.tenantId, t.id))}`;
    };
    const handler = this.handlers.get(subject.type);
    const impact = await handler.impact(tx, subject, actor).catch(() => null);
    const amount = { amountMinor: askedMinor, currency: subject.amount.currency };
    const limit =
      task.doaLimitMinor !== null && task.doaCurrency
        ? formatMoney({ amountMinor: task.doaLimitMinor, currency: task.doaCurrency })
        : null;
    const email = approvalRequestEmail({
      approverFirstName: recipient.firstName,
      subjectLabel: subject.type === 'contribution' ? 'Co-funding request' : 'Request',
      ref: subject.ref,
      title: subject.title,
      amount,
      requesterName: subject.requesterName,
      chargeTo: subject.budget.name,
      neededBy: subject.neededBy,
      purpose: subject.purpose,
      whyYou: `You approve this step (${task.reason ?? 'approval route'})${limit ? ` within your delegation-of-authority limit of ${limit}` : ''}. By approving you confirm you have no conflict of interest.`,
      availableBefore: impact?.availableBefore ?? null,
      availableAfter: impact?.availableAfter ?? null,
      warning: impact?.warning ?? null,
      approveUrl: link('approve'),
      rejectUrl: link('reject'),
      detailsUrl: `${this.notifications.webBaseUrl}/approvals?task=${task.id}`,
      expiresAt,
    });
    await this.notifications.queueEmail(tx, task.tenantId, recipient, email, 'approval.requested');
  }

  /** Cancels the open route of a subject (withdrawn, cancelled by a budget control, resubmitted). */
  async cancelFor(tx: Tx, subjectType: SubjectType, subjectId: string): Promise<void> {
    const open = await tx
      .select({ id: approvalInstances.id })
      .from(approvalInstances)
      .where(
        and(
          eq(approvalInstances.subjectType, subjectType),
          eq(approvalInstances.subjectId, subjectId),
          eq(approvalInstances.status, 'pending'),
        ),
      );
    if (!open.length) return;
    const ids = open.map((o) => o.id);
    await tx
      .update(approvalInstances)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(inArray(approvalInstances.id, ids));
    await tx
      .update(approvalTasks)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(inArray(approvalTasks.instanceId, ids), eq(approvalTasks.status, 'pending')));
  }

  decide(
    actor: RequestActor,
    taskId: string,
    req: DecisionRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<DecisionResponse>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `approvals.decide:${taskId}`,
        request: req,
        status: 200,
      },
      (tx) =>
        this.decideTx(tx, actor, taskId, req, {
          channel: 'web',
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
        }),
    );
  }

  /** The active delegation from `delegatorId` to `delegateId` on a date, for a spend type. */
  private async delegation(
    tx: Tx,
    delegatorId: string,
    delegateId: string,
    spendType: string,
    date: string,
  ): Promise<(Delegation & { id: string }) | null> {
    const [d] = await tx
      .select()
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.delegatorPersonId, delegatorId),
          eq(approvalDelegations.delegatePersonId, delegateId),
          lte(approvalDelegations.validFrom, date),
          or(isNull(approvalDelegations.validTo), gte(approvalDelegations.validTo, date)),
          or(isNull(approvalDelegations.spendType), eq(approvalDelegations.spendType, spendType)),
        ),
      )
      .orderBy(desc(approvalDelegations.createdAt))
      .limit(1);
    return d
      ? {
          id: d.id,
          delegatorPersonId: d.delegatorPersonId,
          delegatePersonId: d.delegatePersonId,
          limitMinor: d.limitMinor,
          currency: d.currency ?? 'USD',
          validFrom: d.validFrom,
          validTo: d.validTo ?? '9999-12-31',
        }
      : null;
  }

  async decideTx(
    tx: Tx,
    actor: RequestActor,
    taskId: string,
    req: DecisionRequest,
    opts: { channel: 'web' | 'email'; requestId: string | null; idempotencyKey: string | null },
  ): Promise<DecisionResponse> {
    const [task] = await tx
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.id, taskId))
      .for('update');
    if (!task) throw ApiProblem.notFound('approval');
    const [instance] = await tx
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.id, task.instanceId))
      .for('update');
    const handler = this.handlers.get(instance.subjectType);
    const subject = await handler.load(tx, instance.subjectId, { lock: true });
    if (!subject) throw ApiProblem.notFound('approval');
    const date = todayUtc();
    const delegation =
      actor.personId && actor.personId !== task.assigneePersonId
        ? await this.delegation(tx, task.assigneePersonId, actor.personId, subject.spendType, date)
        : null;
    const isAssignee = actor.personId === task.assigneePersonId;
    if (!isAssignee && !delegation) {
      if (await handler.canView(tx, actor, subject))
        throw new ApiProblem(
          403,
          'APPROVAL_NOT_ASSIGNED',
          'This approval is assigned to someone else.',
        );
      throw ApiProblem.notFound('approval');
    }
    if (isAssignee) {
      this.policy.assert(
        actor,
        DECIDE_ACTION[subject.type],
        budgetResourceOf(subject.budget),
        'approval',
      );
    }
    if (task.status !== 'pending' || instance.status !== 'pending' || !subject.pending) {
      throw new ApiProblem(409, 'APPROVAL_NOT_PENDING', 'This approval was already decided.', {
        status: task.status,
      });
    }
    if (subject.onHold) {
      throw new ApiProblem(
        409,
        'REQUEST_ON_HOLD',
        subject.holdReason ?? 'This request is on hold while its budget is frozen.',
      );
    }
    const plan = instance.explanation as unknown as PlanJson;
    const ctx: DecisionContext = {
      actor,
      onBehalfOfPersonId: delegation ? task.assigneePersonId : null,
      channel: opts.channel,
      taskId: task.id,
      requestId: opts.requestId,
      idempotencyKey: opts.idempotencyKey,
      reasonCode: req.reasonCode ?? null,
      reason: req.comment ?? null,
    };
    const statusBefore = subject.status;
    let approvedMinor: number | null = null;
    let taskStatus: TaskRow['status'];
    let outcome: { status: string; changes: Record<string, unknown> } = {
      status: subject.status,
      changes: {},
    };
    let nextApprover: string | null = null;
    let doaLimit: number | null = null;
    const limits = await this.routing.limits(tx, date);
    const assigneeRoles = await this.actors.rolesForPerson(tx, task.assigneePersonId, date);
    const hygieneInput = {
      requesterId: subject.requesterId,
      beneficiaryIds: subject.beneficiaryIds,
      attendeeIds: subject.attendeeIds,
    };

    if (req.decision === 'approve' || req.decision === 'approve_partial') {
      if (!req.noConflictAttested) {
        throw new ApiProblem(
          422,
          'CONFLICT_ATTESTATION_REQUIRED',
          'Confirm you have no conflict of interest before approving.',
        );
      }
      unwrap(acceptsNewActivity(subject.budget.status));
      approvedMinor = plan.approvedMinor;
      if (req.decision === 'approve_partial') {
        const a = req.approvedAmount;
        if (
          !a ||
          a.currency !== plan.currency ||
          a.amountMinor <= 0 ||
          a.amountMinor >= plan.approvedMinor
        ) {
          throw new ApiProblem(
            422,
            'CONTRIBUTION_AMOUNT_INVALID',
            `A partial approval is more than zero and less than ${formatMoney({ amountMinor: plan.approvedMinor, currency: plan.currency })}.`,
            { requestedMinor: plan.approvedMinor },
          );
        }
        if (!req.reasonCode)
          throw new ApiProblem(
            422,
            'REASON_REQUIRED',
            'Choose a reason code for a partial approval.',
          );
        approvedMinor = a.amountMinor;
      }
      const limitAmount = await this.routing.toLimitCurrency(
        tx,
        subject.budget,
        { amountMinor: approvedMinor, currency: plan.currency },
        limits,
        actor.reportingCurrency,
      );
      const auth = unwrap(
        checkDecisionAuthority({
          actor: { personId: actor.personId!, roles: actor.roles },
          assignee: { personId: task.assigneePersonId, roles: assigneeRoles },
          delegation,
          ...hygieneInput,
          amountMinor: limitAmount.amountMinor,
          currency: limitAmount.currency,
          spendType: subject.spendType,
          legalEntityId: subject.budget.legalEntityId,
          date,
          limits,
        }),
      );
      doaLimit = auth.effectiveLimitMinor;
      taskStatus = req.decision === 'approve' ? 'approved' : 'partially_approved';
      const next = plan.steps.find((s) => s.stepNo > task.stepNo && s.personId !== actor.personId);
      if (next) {
        plan.approvedMinor = approvedMinor;
        await tx
          .update(approvalInstances)
          .set({
            explanation: plan as unknown as Record<string, unknown>,
            currentStep: next.stepNo,
          })
          .where(eq(approvalInstances.id, instance.id));
        const nextTask = await this.createTask(
          tx,
          { ...instance, explanation: plan as unknown as Record<string, unknown> },
          next,
          limitAmount.currency,
          null,
        );
        await this.notifyApprover(tx, actor, subject, nextTask, approvedMinor);
        nextApprover = (await personNames(tx, [next.personId])).get(next.personId) ?? null;
        outcome = { status: subject.status, changes: { nextStep: next.stepNo } };
      } else {
        outcome = await handler.approve(tx, subject, approvedMinor, ctx, { mode: req.mode });
        await tx
          .update(approvalInstances)
          .set({
            status: approvedMinor < subject.amount.amountMinor ? 'partially_approved' : 'approved',
            completedAt: new Date(),
          })
          .where(eq(approvalInstances.id, instance.id));
      }
    } else if (req.decision === 'reject' || req.decision === 'request_changes') {
      if (!(req.comment?.trim() || req.reasonCode)) {
        throw new ApiProblem(
          422,
          'REASON_REQUIRED',
          req.decision === 'reject'
            ? 'Give a reason so the requester knows why.'
            : 'Say what should change.',
        );
      }
      unwrap(
        checkApprovalHygiene({
          approverId: actor.personId!,
          onBehalfOfId: delegation ? task.assigneePersonId : null,
          ...hygieneInput,
        }),
      );
      taskStatus = req.decision === 'reject' ? 'rejected' : 'changes_requested';
      outcome =
        req.decision === 'reject'
          ? await handler.reject(tx, subject, ctx)
          : await handler.requestChanges(tx, subject, ctx);
      await tx
        .update(approvalInstances)
        .set({ status: taskStatus, completedAt: new Date() })
        .where(eq(approvalInstances.id, instance.id));
    } else {
      // escalate: hand the step to the next authority above the current approver
      const { route } = await this.routing.plan(tx, {
        subject: subject.type,
        requesterId: subject.requesterId,
        beneficiaryIds: subject.beneficiaryIds,
        attendeeIds: subject.attendeeIds,
        budget: subject.budget,
        budgetAmount: subject.budgetAmount,
        spendType: subject.spendType,
        reportingCurrency: actor.reportingCurrency,
        remainingPctAfter: null,
        above: task.assigneePersonId,
        action: DECIDE_ACTION[subject.type],
      });
      const target = {
        ...route.steps[0],
        stepNo: task.stepNo,
        reason: `Escalated by ${actor.displayName}`,
      };
      taskStatus = 'escalated';
      const nextTask = await this.createTask(
        tx,
        instance,
        target,
        task.doaCurrency ?? 'USD',
        task.id,
      );
      await this.notifyApprover(tx, actor, subject, nextTask, plan.approvedMinor);
      nextApprover = (await personNames(tx, [target.personId])).get(target.personId) ?? null;
      outcome = { status: subject.status, changes: { escalatedTo: target.personId } };
    }

    await tx
      .update(approvalTasks)
      .set({ status: taskStatus, decidedAt: new Date() })
      .where(eq(approvalTasks.id, task.id));
    await tx.insert(approvalActions).values({
      tenantId: actor.tenantId,
      taskId: task.id,
      actorPersonId: actor.personId!,
      onBehalfOfPersonId: ctx.onBehalfOfPersonId,
      action: req.decision,
      approvedMinor,
      reason: req.comment ?? null,
      reasonCode: req.reasonCode ?? null,
      noConflictAttested: req.noConflictAttested,
      channel: opts.channel,
    });
    const finalStep = !nextApprover && req.decision !== 'escalate';
    const verb = finalStep
      ? VERB[req.decision]
      : req.decision === 'escalate'
        ? 'escalated'
        : 'step_approved';
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      onBehalfOfPersonId: ctx.onBehalfOfPersonId,
      action: `${subject.type}.${verb}`,
      resourceType: subject.type,
      resourceId: subject.id,
      legalEntityId: subject.budget.legalEntityId,
      requestId: opts.requestId,
      reason: req.comment ?? null,
      changes: {
        status: { from: statusBefore, to: outcome.status },
        decision: { from: null, to: req.decision },
        stepNo: { from: null, to: task.stepNo },
        channel: { from: null, to: opts.channel },
        ...(approvedMinor !== null
          ? {
              approvedAmount: {
                from: null,
                to: { amountMinor: approvedMinor, currency: plan.currency },
              },
            }
          : {}),
        ...(doaLimit !== null ? { doaLimitMinor: { from: null, to: doaLimit } } : {}),
        ...(req.reasonCode ? { reasonCode: { from: null, to: req.reasonCode } } : {}),
        noConflictAttested: { from: null, to: req.noConflictAttested },
        ...Object.fromEntries(
          Object.entries(outcome.changes).map(([k, v]) => [k, { from: null, to: v }]),
        ),
      },
    });
    await this.analytics.track(tx, actor, 'approval.decided', {
      decision: req.decision,
      channel: opts.channel,
      stepNo: task.stepNo,
      delegated: Boolean(ctx.onBehalfOfPersonId),
      subjectType: subject.type,
      final: finalStep,
    });
    if (subject.type === 'contribution' && finalStep) {
      await this.analytics.track(tx, actor, 'contribution.decided', { decision: req.decision });
    }
    if (finalStep)
      await this.notifyRequester(tx, subject, req, approvedMinor, plan.currency, outcome.status);
    const approved =
      approvedMinor !== null ? { amountMinor: approvedMinor, currency: plan.currency } : null;
    return {
      taskId: task.id,
      decision: req.decision,
      subjectType: subject.type,
      subjectId: subject.id,
      ref: subject.ref,
      subjectStatus: outcome.status,
      approvedAmount: approved,
      nextApproverName: nextApprover,
      message:
        req.decision === 'escalate'
          ? `Escalated ${subject.ref} to ${nextApprover}`
          : nextApprover
            ? `Approved ${subject.ref}; it moves to ${nextApprover}`
            : req.decision === 'reject'
              ? `Rejected ${subject.ref}`
              : req.decision === 'request_changes'
                ? `Asked for changes on ${subject.ref}`
                : `Approved ${formatMoney(approved!)} for ${subject.ref}`,
    };
  }

  private async notifyRequester(
    tx: Tx,
    subject: ApprovalSubject,
    req: DecisionRequest,
    approvedMinor: number | null,
    currency: string,
    status: string,
  ): Promise<void> {
    const recipient = await this.notifications.personEmail(tx, subject.requesterId);
    if (!recipient) return;
    const label = subject.type === 'contribution' ? 'co-funding request' : 'request';
    const headline =
      req.decision === 'reject'
        ? `Your ${label} ${subject.ref} was declined.`
        : req.decision === 'request_changes'
          ? `Changes were requested on your ${label} ${subject.ref}.`
          : approvedMinor !== null && approvedMinor < subject.amount.amountMinor
            ? `Your ${label} ${subject.ref} was approved in part.`
            : `Your ${label} ${subject.ref} was approved.`;
    const lines: [string, string][] = [
      ['Request', `${subject.ref} · ${subject.title}`],
      ['Requested', formatMoney(subject.amount)],
    ];
    if (approvedMinor !== null)
      lines.push(['Approved', formatMoney({ amountMinor: approvedMinor, currency })]);
    if (req.comment) lines.push(['Comment', req.comment]);
    lines.push(['Status', status.replace(/_/g, ' ')]);
    await this.notifications.queueEmail(
      tx,
      subject.budget.tenantId,
      recipient,
      noticeEmail({
        firstName: recipient.firstName,
        subject: headline,
        headline,
        lines,
        detailsUrl: `${this.notifications.webBaseUrl}${subject.detailsPath}`,
      }),
      'approval.decided',
    );
  }

  // Email links --------------------------------------------------------------------------------

  private async tokenContext(tx: Tx, tokenId: string, lock: boolean) {
    const q = tx.select().from(approvalActionTokens).where(eq(approvalActionTokens.id, tokenId));
    const [token] = lock ? await q.for('update') : await q;
    if (!token) return null;
    const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, token.taskId));
    const [instance] = await tx
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.id, task.instanceId));
    const subject = await this.handlers.get(instance.subjectType).load(tx, instance.subjectId);
    if (!subject) return null;
    const state: EmailActionPreview['state'] = token.usedAt
      ? 'used'
      : token.expiresAt.getTime() < Date.now()
        ? 'expired'
        : task.status !== 'pending' || !subject.pending
          ? 'decided'
          : token.subjectVersion !== subject.version || instance.subjectVersion !== subject.version
            ? 'stale'
            : subject.onHold
              ? 'held'
              : 'valid';
    return { token, task, instance, subject, state };
  }

  private async actorForPerson(tx: Tx, tenantId: string, personId: string): Promise<RequestActor> {
    const [m] = await tx
      .select({ subject: memberships.idpSubject })
      .from(memberships)
      .where(and(eq(memberships.personId, personId), eq(memberships.status, 'active')));
    if (!m) throw new ApiProblem(404, 'APPROVAL_LINK_INVALID', 'This link is not valid.');
    return this.actors.resolve(m.subject, tenantId, undefined);
  }

  previewEmail(token: string): Promise<EmailActionPreview> {
    const v = this.links.verify(token);
    if (!v) throw new ApiProblem(404, 'APPROVAL_LINK_INVALID', 'This link is not valid.');
    return withTenant(this.db, { tenantId: v.tenantId, subject: 'email-link' }, async (tx) => {
      const c = await this.tokenContext(tx, v.tokenId, false);
      if (!c) throw new ApiProblem(404, 'APPROVAL_LINK_INVALID', 'This link is not valid.');
      const plan = c.instance.explanation as unknown as PlanJson;
      const actor = systemActor(v.tenantId);
      const impact = await this.handlers
        .get(c.subject.type)
        .impact(tx, c.subject, actor)
        .catch(() => null);
      const names = await personNames(tx, [c.token.approverPersonId]);
      const amount = { amountMinor: plan.approvedMinor, currency: plan.currency };
      const message: Record<EmailActionPreview['state'], string> = {
        valid:
          c.token.action === 'approve'
            ? `Approve ${formatMoney(amount)} for ${c.subject.ref}.`
            : `Reject ${c.subject.ref}: give a reason.`,
        used: 'This link was already used. Open the request in BudgetFlow to see the decision.',
        expired: 'This link has expired. Decide in BudgetFlow instead.',
        decided: 'This request was already decided or is no longer waiting for you.',
        stale:
          'The request changed since this email was sent. Review the new amount in BudgetFlow.',
        held: c.subject.holdReason ?? 'This request is on hold while its budget is frozen.',
      };
      return {
        state: c.state,
        action: c.token.action as 'approve' | 'reject',
        subjectType: c.subject.type,
        subjectId: c.subject.id,
        ref: c.subject.ref,
        title: c.subject.title,
        amount,
        requesterName: c.subject.requesterName,
        budgetName: c.subject.budget.name,
        approverName: names.get(c.token.approverPersonId) ?? '',
        availableBefore: impact?.availableBefore ?? null,
        availableAfter: impact?.availableAfter ?? null,
        warning: impact?.warning ?? null,
        expiresAt: c.token.expiresAt.toISOString(),
        message: message[c.state],
      };
    });
  }

  executeEmail(req: EmailActionRequest, requestId: string | null): Promise<DecisionResponse> {
    const v = this.links.verify(req.token);
    if (!v) throw new ApiProblem(404, 'APPROVAL_LINK_INVALID', 'This link is not valid.');
    return withTenant(this.db, { tenantId: v.tenantId, subject: 'email-link' }, async (tx) => {
      const c = await this.tokenContext(tx, v.tokenId, true);
      if (!c) throw new ApiProblem(404, 'APPROVAL_LINK_INVALID', 'This link is not valid.');
      if (c.state === 'used')
        throw new ApiProblem(409, 'APPROVAL_LINK_USED', 'This link was already used.');
      if (c.state === 'expired')
        throw new ApiProblem(
          410,
          'APPROVAL_LINK_EXPIRED',
          'This link has expired. Decide in BudgetFlow instead.',
        );
      if (c.state === 'decided')
        throw new ApiProblem(409, 'APPROVAL_NOT_PENDING', 'This request was already decided.');
      if (c.state === 'stale')
        throw new ApiProblem(
          409,
          'APPROVAL_LINK_STALE',
          'The request changed since this email was sent. Review it in BudgetFlow.',
        );
      if (c.token.action === 'reject' && !(req.reason?.trim() || req.reasonCode)) {
        throw new ApiProblem(422, 'REASON_REQUIRED', 'Give a reason so the requester knows why.');
      }
      await tx
        .update(approvalActionTokens)
        .set({ usedAt: new Date() })
        .where(eq(approvalActionTokens.id, c.token.id));
      const actor = await this.actorForPerson(tx, v.tenantId, c.token.approverPersonId);
      return this.decideTx(
        tx,
        actor,
        c.task.id,
        {
          decision: c.token.action === 'approve' ? 'approve' : 'reject',
          noConflictAttested: c.token.action === 'approve',
          ...(req.reasonCode ? { reasonCode: req.reasonCode } : {}),
          ...(req.reason ? { comment: req.reason } : {}),
        },
        { channel: 'email', requestId, idempotencyKey: null },
      );
    });
  }

  // Reads ---------------------------------------------------------------------------------------

  /** The route of a subject's latest approval instance, with each step's state. */
  async routeView(
    tx: Tx,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<ApprovalRouteView | null> {
    const [instance] = await tx
      .select()
      .from(approvalInstances)
      .where(
        and(
          eq(approvalInstances.subjectType, subjectType),
          eq(approvalInstances.subjectId, subjectId),
        ),
      )
      .orderBy(desc(approvalInstances.createdAt))
      .limit(1);
    if (!instance) return null;
    const plan = instance.explanation as unknown as PlanJson;
    const tasks = await tx
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.instanceId, instance.id))
      .orderBy(asc(approvalTasks.createdAt));
    const actions = tasks.length
      ? await tx
          .select()
          .from(approvalActions)
          .where(
            inArray(
              approvalActions.taskId,
              tasks.map((t) => t.id),
            ),
          )
      : [];
    const names = await personNames(tx, [
      ...plan.steps.map((s) => s.personId),
      ...plan.skipped.map((s) => s.personId),
      ...tasks.map((t) => t.assigneePersonId),
      ...actions.flatMap((a) => [a.actorPersonId, a.onBehalfOfPersonId]),
    ]);
    const steps: ApprovalRouteView['steps'] = [];
    for (const t of tasks) {
      const a = actions.find((x) => x.taskId === t.id);
      const planned = plan.steps.find((s) => s.stepNo === t.stepNo);
      steps.push({
        stepNo: t.stepNo,
        taskId: t.id,
        personId: t.assigneePersonId,
        personName: names.get(t.assigneePersonId) ?? '',
        resolver: t.resolver as RouteStep['resolver'],
        reason: t.reason ?? planned?.reason ?? '',
        limit:
          t.doaLimitMinor !== null && t.doaCurrency
            ? { amountMinor: t.doaLimitMinor, currency: t.doaCurrency }
            : null,
        status: t.status,
        decidedAt: t.decidedAt?.toISOString() ?? null,
        actedByName: a ? (names.get(a.actorPersonId) ?? null) : null,
        onBehalfOfName: a?.onBehalfOfPersonId ? (names.get(a.onBehalfOfPersonId) ?? null) : null,
        comment: a?.reason ?? null,
        channel: a?.channel ?? null,
        dueAt: t.dueAt?.toISOString() ?? null,
      });
    }
    if (instance.status === 'pending') {
      for (const s of plan.steps.filter((x) => !tasks.some((t) => t.stepNo === x.stepNo))) {
        steps.push({
          stepNo: s.stepNo,
          taskId: null,
          personId: s.personId,
          personName: names.get(s.personId) ?? '',
          resolver: s.resolver,
          reason: s.reason,
          limit: { amountMinor: s.limitMinor, currency: tasks[0]?.doaCurrency ?? 'USD' },
          status: 'waiting',
          decidedAt: null,
          actedByName: null,
          onBehalfOfName: null,
          comment: null,
          channel: null,
          dueAt: null,
        });
      }
    }
    return {
      steps,
      skipped: plan.skipped.map((s) => ({
        personName: names.get(s.personId) ?? '',
        reason: s.reason as ApprovalRouteView['skipped'][number]['reason'],
        detail: s.detail,
      })),
      explanation: plan.explanation,
    };
  }

  /** Current pending step per subject (approver and due time) for list views. */
  async currentSteps(
    tx: Tx,
    subjectType: SubjectType,
    subjectIds: readonly string[],
  ): Promise<Map<string, { approverName: string; dueAt: string | null; stepNo: number }>> {
    if (!subjectIds.length) return new Map();
    const rows = await tx
      .select({
        subjectId: approvalInstances.subjectId,
        assignee: approvalTasks.assigneePersonId,
        dueAt: approvalTasks.dueAt,
        stepNo: approvalTasks.stepNo,
      })
      .from(approvalTasks)
      .innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId))
      .where(
        and(
          eq(approvalInstances.subjectType, subjectType),
          inArray(approvalInstances.subjectId, [...subjectIds]),
          eq(approvalTasks.status, 'pending'),
        ),
      );
    const names = await personNames(
      tx,
      rows.map((r) => r.assignee),
    );
    return new Map(
      rows.map((r) => [
        r.subjectId,
        {
          approverName: names.get(r.assignee) ?? '',
          dueAt: r.dueAt?.toISOString() ?? null,
          stepNo: r.stepNo,
        },
      ]),
    );
  }

  /** The viewer's pending task on a subject (as approver, or as an active delegate for that spend type), if any. */
  async myTask(
    tx: Tx,
    actor: RequestActor,
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<string | null> {
    if (!actor.personId) return null;
    const rows = await tx
      .select({ id: approvalTasks.id, assignee: approvalTasks.assigneePersonId })
      .from(approvalTasks)
      .innerJoin(approvalInstances, eq(approvalInstances.id, approvalTasks.instanceId))
      .where(
        and(
          eq(approvalInstances.subjectType, subjectType),
          eq(approvalInstances.subjectId, subjectId),
          eq(approvalTasks.status, 'pending'),
        ),
      );
    for (const r of rows) if (r.assignee === actor.personId) return r.id;
    if (!rows.length) return null;
    const subject = await this.handlers.get(subjectType).load(tx, subjectId);
    if (!subject) return null;
    for (const r of rows) {
      if (await this.delegation(tx, r.assignee, actor.personId, subject.spendType, todayUtc()))
        return r.id;
    }
    return null;
  }

  private async delegatorsOf(tx: Tx, personId: string, date = todayUtc()): Promise<string[]> {
    const rows = await tx
      .select({ delegator: approvalDelegations.delegatorPersonId })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.delegatePersonId, personId),
          lte(approvalDelegations.validFrom, date),
          or(isNull(approvalDelegations.validTo), gte(approvalDelegations.validTo, date)),
        ),
      );
    return [...new Set(rows.map((r) => r.delegator))];
  }

  inbox(
    actor: RequestActor,
    tab: 'assigned' | 'delegated' | 'escalated' | 'completed',
    limit = 50,
  ): Promise<ApprovalInbox> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const me = actor.personId;
      if (!me)
        return {
          items: [],
          counts: { assigned: 0, delegated: 0, escalated: 0, completed: 0 },
          nextCursor: null,
        };
      const delegators = await this.delegatorsOf(tx, me);
      const pendingMine = await tx
        .select()
        .from(approvalTasks)
        .where(and(eq(approvalTasks.assigneePersonId, me), eq(approvalTasks.status, 'pending')))
        .orderBy(asc(approvalTasks.dueAt));
      const delegated = delegators.length
        ? await tx
            .select()
            .from(approvalTasks)
            .where(
              and(
                inArray(approvalTasks.assigneePersonId, delegators),
                eq(approvalTasks.status, 'pending'),
              ),
            )
            .orderBy(asc(approvalTasks.dueAt))
        : [];
      const escalated = await tx
        .select()
        .from(approvalTasks)
        .where(
          or(
            and(
              eq(approvalTasks.assigneePersonId, me),
              eq(approvalTasks.status, 'pending'),
              isNotNull(approvalTasks.escalatedFromTaskId),
            ),
            and(eq(approvalTasks.assigneePersonId, me), eq(approvalTasks.status, 'escalated')),
          ),
        )
        .orderBy(desc(approvalTasks.createdAt));
      const completed = await tx
        .select()
        .from(approvalTasks)
        .where(
          and(
            ne(approvalTasks.status, 'pending'),
            or(
              eq(approvalTasks.assigneePersonId, me),
              inArray(
                approvalTasks.id,
                tx
                  .select({ id: approvalActions.taskId })
                  .from(approvalActions)
                  .where(eq(approvalActions.actorPersonId, me)),
              ),
            ),
          ),
        )
        .orderBy(desc(approvalTasks.decidedAt))
        .limit(limit);
      const delegatedForMe: TaskRow[] = [];
      for (const t of delegated) {
        const [instance] = await tx
          .select()
          .from(approvalInstances)
          .where(eq(approvalInstances.id, t.instanceId));
        const subject = await this.handlers.get(instance.subjectType).load(tx, instance.subjectId);
        if (
          subject &&
          (await this.delegation(tx, t.assigneePersonId, me, subject.spendType, todayUtc()))
        )
          delegatedForMe.push(t);
      }
      const rows = { assigned: pendingMine, delegated: delegatedForMe, escalated, completed }[
        tab
      ].slice(0, limit);
      const items: ApprovalTaskSummary[] = [];
      for (const t of rows) {
        const s = await this.summary(tx, t, me);
        if (s) items.push(s);
      }
      return {
        items,
        counts: {
          assigned: pendingMine.length,
          delegated: delegatedForMe.length,
          escalated: escalated.length,
          completed: completed.length,
        },
        nextCursor: null,
      };
    });
  }

  private async summary(tx: Tx, t: TaskRow, viewerId: string): Promise<ApprovalTaskSummary | null> {
    const [instance] = await tx
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.id, t.instanceId));
    const subject = await this.handlers.get(instance.subjectType).load(tx, instance.subjectId);
    if (!subject) return null;
    const plan = instance.explanation as unknown as PlanJson;
    const names = await personNames(tx, [t.assigneePersonId]);
    return {
      taskId: t.id,
      subjectType: subject.type,
      subjectId: subject.id,
      ref: subject.ref,
      title: subject.title,
      kindLabel: subject.kindLabel,
      requesterName: subject.requesterName,
      budgetId: subject.budget.id,
      budgetName: subject.budget.name,
      eventName: subject.eventName,
      amount: { amountMinor: plan.approvedMinor, currency: plan.currency },
      budgetAmount: subject.budgetAmount,
      taskStatus: t.status,
      subjectStatus: subject.status,
      stepNo: t.stepNo,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      decidedAt: t.decidedAt?.toISOString() ?? null,
      delegatedFromName:
        t.assigneePersonId !== viewerId ? (names.get(t.assigneePersonId) ?? null) : null,
      escalated: Boolean(t.escalatedFromTaskId) || t.status === 'escalated',
      onHold: subject.onHold,
      holdReason: subject.holdReason,
    };
  }

  task(
    actor: RequestActor,
    taskId: string,
    documents: (tx: Tx, type: string, id: string) => Promise<ApprovalTaskDetail['documents']>,
  ): Promise<ApprovalTaskDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [t] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, taskId));
      if (!t) throw ApiProblem.notFound('approval');
      const [instance] = await tx
        .select()
        .from(approvalInstances)
        .where(eq(approvalInstances.id, t.instanceId));
      const handler = this.handlers.get(instance.subjectType);
      const subject = await handler.load(tx, instance.subjectId);
      if (!subject) throw ApiProblem.notFound('approval');
      const me = actor.personId ?? '';
      const date = todayUtc();
      const delegation =
        me && me !== t.assigneePersonId
          ? await this.delegation(tx, t.assigneePersonId, me, subject.spendType, date)
          : null;
      const isApprover = me === t.assigneePersonId || Boolean(delegation);
      if (!isApprover && !(await handler.canView(tx, actor, subject)))
        throw ApiProblem.notFound('approval');
      const plan = instance.explanation as unknown as PlanJson;
      const summary = (await this.summary(tx, t, me))!;
      const limits = await this.routing.limits(tx, date);
      const limitAmount = await this.routing.toLimitCurrency(
        tx,
        subject.budget,
        { amountMinor: plan.approvedMinor, currency: plan.currency },
        limits,
        actor.reportingCurrency,
      );
      const assigneeRoles = await this.actors.rolesForPerson(tx, t.assigneePersonId, date);
      const own = checkAuthority(
        limits,
        { personId: t.assigneePersonId, roles: assigneeRoles },
        {
          spendType: subject.spendType,
          legalEntityId: subject.budget.legalEntityId,
          currency: limitAmount.currency,
          date,
          amountMinor: 0,
        },
      );
      const auth = isApprover
        ? checkDecisionAuthority({
            actor: { personId: me, roles: actor.roles },
            assignee: { personId: t.assigneePersonId, roles: assigneeRoles },
            delegation,
            requesterId: subject.requesterId,
            beneficiaryIds: subject.beneficiaryIds,
            attendeeIds: subject.attendeeIds,
            amountMinor: limitAmount.amountMinor,
            currency: limitAmount.currency,
            spendType: subject.spendType,
            legalEntityId: subject.budget.legalEntityId,
            date,
            limits,
          })
        : null;
      const limitMinor = auth?.ok
        ? auth.value.effectiveLimitMinor
        : auth && !auth.ok && typeof auth.error.params?.['limitMinor'] === 'number'
          ? (auth.error.params['limitMinor'] as number)
          : own.ok
            ? own.value.limit.limitMinor
            : null;
      const hy = (id: string) =>
        [id, delegation ? t.assigneePersonId : null].filter((x): x is string => Boolean(x));
      const deciders = hy(me || t.assigneePersonId);
      const status = acceptsNewActivity(subject.budget.status);
      const checks: ApprovalTaskDetail['checks'] = [
        {
          code: 'not_requester',
          label: 'Not the requester',
          passed: !deciders.includes(subject.requesterId),
          detail: deciders.includes(subject.requesterId)
            ? 'People cannot approve their own requests.'
            : 'You did not raise this request.',
        },
        {
          code: 'not_beneficiary',
          label: 'Not a beneficiary',
          passed: !deciders.some((d) => subject.beneficiaryIds.includes(d)),
          detail: 'Approvers cannot benefit from what they approve.',
        },
        {
          code: 'not_attendee',
          label: 'Not attending the event',
          passed: !deciders.some((d) => subject.attendeeIds.includes(d)),
          detail: subject.eventId
            ? 'Attendees of the event cannot approve its funding.'
            : 'No event attached.',
        },
        {
          code: 'within_doa',
          label: 'Within delegation of authority',
          passed: Boolean(auth?.ok),
          detail: auth
            ? auth.ok
              ? 'The amount is within the limit.'
              : auth.error.message
            : 'Only the approver is checked.',
        },
        {
          code: 'budget_open',
          label: 'Budget accepts decisions',
          passed: status.ok && !subject.onHold,
          detail: subject.onHold
            ? (subject.holdReason ?? 'On hold.')
            : status.ok
              ? 'The budget is active.'
              : status.error.message,
        },
      ];
      const pending =
        t.status === 'pending' &&
        instance.status === 'pending' &&
        subject.pending &&
        !subject.onHold;
      const allowed: ApprovalTaskDetail['allowedDecisions'] = [];
      if (isApprover && pending) {
        if (auth?.ok && status.ok) allowed.push('approve');
        if (
          status.ok &&
          (auth?.ok || (auth && !auth.ok && auth.error.code === 'DOA_LIMIT_EXCEEDED'))
        )
          allowed.push('approve_partial');
        allowed.push('reject', 'request_changes', 'escalate');
      }
      const names = await personNames(tx, [t.assigneePersonId]);
      return {
        task: summary,
        purpose: subject.purpose,
        eventId: subject.eventId,
        spendType: subject.spendType,
        impact: await handler.impact(tx, subject, actor),
        route: (await this.routeView(tx, subject.type, subject.id))!,
        checks,
        doa: {
          limit:
            limitMinor !== null
              ? { amountMinor: limitMinor, currency: limitAmount.currency }
              : null,
          withinLimit: Boolean(auth?.ok),
          message: auth
            ? auth.ok
              ? `Within ${delegation ? 'the delegated' : 'your'} limit of ${formatMoney({ amountMinor: auth.value.effectiveLimitMinor, currency: limitAmount.currency })}.`
              : auth.error.message
            : 'Shown to the approver.',
          onBehalfOfName: delegation ? (names.get(t.assigneePersonId) ?? null) : null,
        },
        ruleReason: [
          ...new Set(
            [t.reason, ...plan.explanation]
              .filter((r): r is string => !!r)
              .map((r) => r.replace(/\.$/, '')),
          ),
        ]
          .map((r) => `${r}.`)
          .join(' '),
        allowedDecisions: allowed,
        documents: await documents(tx, subject.type, subject.id),
        contributionMode: subject.contributionMode,
        transferAllowed: subject.transferAllowed,
      };
    });
  }

  /** Activity timeline for subjects from the audit trail (callers authorize). */
  async activity(tx: Tx, resources: { type: string; id: string }[]): Promise<ActivityEntry[]> {
    const rows = await this.audit.forResources(tx, resources);
    const names = await personNames(
      tx,
      rows.flatMap((r) => [r.actorPersonId, r.onBehalfOfPersonId]),
    );
    return rows.map((r) => {
      const changes = r.changes as Record<string, { to?: unknown }>;
      const channel =
        typeof changes['channel']?.to === 'string' ? (changes['channel'].to as string) : null;
      return {
        id: r.id,
        at: r.occurredAt.toISOString(),
        actorName: r.actorPersonId
          ? (names.get(r.actorPersonId) ?? null)
          : r.actorSubject === 'system:worker'
            ? 'BudgetFlow'
            : null,
        onBehalfOfName: r.onBehalfOfPersonId ? (names.get(r.onBehalfOfPersonId) ?? null) : null,
        action: r.action,
        summary: describeAction(r.action),
        reason: r.reason,
        channel,
      };
    });
  }

  // Delegations ---------------------------------------------------------------------------------

  delegations(actor: RequestActor): Promise<{ items: DelegationView[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!actor.personId) return { items: [] };
      const rows = await tx
        .select()
        .from(approvalDelegations)
        .where(
          or(
            eq(approvalDelegations.delegatorPersonId, actor.personId),
            eq(approvalDelegations.delegatePersonId, actor.personId),
          ),
        )
        .orderBy(desc(approvalDelegations.createdAt));
      const names = await personNames(
        tx,
        rows.flatMap((r) => [r.delegatorPersonId, r.delegatePersonId]),
      );
      return { items: rows.map((r) => this.delegationView(r, names)) };
    });
  }

  private delegationView(
    r: typeof approvalDelegations.$inferSelect,
    names: Map<string, string>,
  ): DelegationView {
    const today = todayUtc();
    return {
      id: r.id,
      delegatorPersonId: r.delegatorPersonId,
      delegatorName: names.get(r.delegatorPersonId) ?? '',
      delegatePersonId: r.delegatePersonId,
      delegateName: names.get(r.delegatePersonId) ?? '',
      spendType: r.spendType,
      limit:
        r.limitMinor !== null && r.currency
          ? { amountMinor: r.limitMinor, currency: r.currency }
          : null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? r.validFrom,
      reason: r.reason,
      active: r.validFrom <= today && (r.validTo === null || today <= r.validTo),
    };
  }

  createDelegation(
    actor: RequestActor,
    req: CreateDelegationRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<DelegationView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'approvals.delegate',
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const canApprove =
          can(actor, 'request.approve', { kind: 'tenant', tenantId: actor.tenantId }).allowed ||
          can(actor, 'contribution.decide', { kind: 'tenant', tenantId: actor.tenantId }).allowed;
        if (!canApprove) throw ApiProblem.forbidden('Only approvers can delegate their approvals.');
        if (req.delegatePersonId === actor.personId)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Choose someone other than yourself.', {
            field: 'delegatePersonId',
          });
        if (req.validTo < req.validFrom)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The end date is before the start date.', {
            field: 'validTo',
          });
        const [delegate] = await tx
          .select({ id: people.id })
          .from(people)
          .where(eq(people.id, req.delegatePersonId));
        if (!delegate)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The delegate does not exist.', {
            field: 'delegatePersonId',
          });
        const [row] = await tx
          .insert(approvalDelegations)
          .values({
            tenantId: actor.tenantId,
            delegatorPersonId: actor.personId,
            delegatePersonId: req.delegatePersonId,
            spendType: req.spendType ?? null,
            limitMinor: req.limit?.amountMinor ?? null,
            currency: req.limit?.currency ?? null,
            validFrom: req.validFrom,
            validTo: req.validTo,
            reason: req.reason,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'approval.delegation_created',
          resourceType: 'approval_delegation',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            delegatePersonId: { from: null, to: req.delegatePersonId },
            validFrom: { from: null, to: req.validFrom },
            validTo: { from: null, to: req.validTo },
            ...(req.limit ? { limit: { from: null, to: req.limit } } : {}),
          },
        });
        const names = await personNames(tx, [row.delegatorPersonId, row.delegatePersonId]);
        return this.delegationView(row, names);
      },
    );
  }
}

const ACTION_TEXT: Record<string, string> = {
  'request.submitted': 'Submitted the request',
  'request.created': 'Saved the request as a draft',
  'request.withdrawn': 'Withdrew the request',
  'request.resubmitted': 'Resubmitted the request',
  'request.approved': 'Approved the request',
  'request.approved_partial': 'Approved part of the request',
  'request.step_approved': 'Approved a step',
  'request.rejected': 'Rejected the request',
  'request.changes_requested': 'Asked for changes',
  'request.escalated': 'Escalated the approval',
  'request.cancelled': 'Cancelled: the budget was set to zero',
  'request.held': 'Put on hold: the budget is frozen',
  'request.released': 'Hold released: the budget is active again',
  'contribution.submitted': 'Asked for an Inter-Director Budget Contribution',
  'contribution.approved': 'Contributed in full',
  'contribution.approved_partial': 'Contributed part of the amount',
  'contribution.rejected': 'Declined the contribution',
  'contribution.changes_requested': 'Asked for changes',
  'contribution.escalated': 'Escalated the decision',
  'contribution.withdrawn': 'Withdrew the contribution request',
  'contribution.cancelled': 'Cancelled: the giving budget was set to zero',
  'contribution.held': 'Put on hold: the giving budget is frozen',
  'contribution.released': 'Hold released',
  'event.created': 'Created the event',
  'event.updated': 'Edited the event',
  'event.submitted': 'Submitted the event for approval',
  'event.participants_added': 'Added participants',
  'event.participant_removed': 'Removed a participant',
  'event.commitment_created': 'Committed spend',
  'event.commitment_released': 'Released a commitment',
  'event.funding_confirmed': 'Confirmed the funding',
  'event.started': 'Started the event',
  'event.completed': 'Completed the event',
  'event.closed': 'Closed the event and returned the surplus',
  'event.cancelled': 'Cancelled the event',
  'recharge.approved': 'Approved the intercompany recharge',
};

export const describeAction = (action: string) =>
  ACTION_TEXT[action] ?? action.replace(/[._]/g, ' ');
