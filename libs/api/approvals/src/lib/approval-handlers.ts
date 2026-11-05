import type { RequestActor } from '@bf/api/core';
import type { budgets, Tx } from '@bf/api/db';
import type { BudgetImpact } from '@bf/contracts';
import { Injectable } from '@nestjs/common';

export type SubjectType = 'request' | 'contribution';
export type BudgetRow = typeof budgets.$inferSelect;

export interface Money {
  amountMinor: number;
  currency: string;
}

/** What the approval engine needs to know about the thing being approved. */
export interface ApprovalSubject {
  type: SubjectType;
  id: string;
  ref: string;
  title: string;
  kindLabel: string;
  status: string;
  version: number;
  requesterId: string;
  requesterName: string;
  beneficiaryIds: string[];
  attendeeIds: string[];
  /** The budget the decision charges (the request's budget, or the giving budget). */
  budget: BudgetRow;
  eventId: string | null;
  eventName: string | null;
  purpose: string;
  spendType: string;
  neededBy: string | null;
  /** Requested amount in the transaction currency. */
  amount: Money;
  /** The same amount in the budget currency at the locked plan rate. */
  budgetAmount: Money;
  onHold: boolean;
  holdReason: string | null;
  /** Statuses in which a decision is accepted. */
  pending: boolean;
  contributionMode: 'earmark' | 'transfer' | null;
  transferAllowed: boolean;
  detailsPath: string;
}

export interface DecisionContext {
  actor: RequestActor;
  onBehalfOfPersonId: string | null;
  channel: 'web' | 'email';
  taskId: string;
  requestId: string | null;
  idempotencyKey: string | null;
  reasonCode: string | null;
  reason: string | null;
}

export interface HandlerOutcome {
  status: string;
  /** Changed fields for the decision's single audit entry (journal ids, earmarks, recharges). */
  changes: Record<string, unknown>;
  message?: string;
}

/**
 * Each approvable subject (requests, Inter-Director Budget Contribution Requests) registers a handler;
 * the engine owns routing, tasks, authority, hygiene, audit and notifications, the handler owns money.
 */
export interface ApprovalSubjectHandler {
  readonly type: SubjectType;
  load(tx: Tx, id: string, opts?: { lock?: boolean }): Promise<ApprovalSubject | null>;
  /** Every step passed: post the approved amount (transaction currency) and move the subject on. */
  approve(
    tx: Tx,
    subject: ApprovalSubject,
    approvedMinor: number,
    ctx: DecisionContext,
    opts: { mode?: 'earmark' | 'transfer' },
  ): Promise<HandlerOutcome>;
  reject(tx: Tx, subject: ApprovalSubject, ctx: DecisionContext): Promise<HandlerOutcome>;
  requestChanges(tx: Tx, subject: ApprovalSubject, ctx: DecisionContext): Promise<HandlerOutcome>;
  impact(tx: Tx, subject: ApprovalSubject, actor: RequestActor): Promise<BudgetImpact | null>;
  /** Whether a viewer who is not the approver may see the subject (requester, owners, finance). */
  canView(tx: Tx, actor: RequestActor, subject: ApprovalSubject): Promise<boolean>;
}

@Injectable()
export class ApprovalHandlers {
  private readonly handlers = new Map<SubjectType, ApprovalSubjectHandler>();

  register(handler: ApprovalSubjectHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ApprovalSubjectHandler {
    const h = this.handlers.get(type as SubjectType);
    if (!h) throw new Error(`No approval handler for ${type}`);
    return h;
  }
}
