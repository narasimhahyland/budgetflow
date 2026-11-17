import { AuditService } from '@bf/api/audit';
import { budgetResource } from '@bf/api/budgets';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgets,
  commitments,
  costCenters,
  events,
  expenseHandoffs,
  idempotencyKeys,
  integrationConnections,
  integrationMappings,
  people,
  requests,
  vendors,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { ExpenseHandoffFields, ExpenseHandoffView, IntegrationProvider } from '@bf/contracts';
import { exponentOf, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { connectorFor } from './connectors';
import { ConnectionsService, type CommandContext } from './connections.service';
import { OutboundHttp, providerMessage } from './http';

type RequestRow = typeof requests.$inferSelect;
type ConnectionRow = typeof integrationConnections.$inferSelect;
type Status = NonNullable<ExpenseHandoffView['handoff']>['status'];

const APPROVED = new Set(['approved', 'partially_approved']);
const TOOL_STATUS: Record<string, 'draft_created' | 'submitted' | 'approved' | 'paid'> = {
  draft: 'draft_created',
  submitted: 'submitted',
  approved: 'approved',
  paid: 'paid',
};
const ORDER = ['draft_created', 'submitted', 'approved', 'paid'];

/**
 * Hand-off of approved spend to a prefilled expense (117a). Once a request is approved, its
 * requester creates one draft expense in the connected expense tool with the request's fields
 * already filled; the employee submits it there. BudgetFlow never submits on their behalf and the
 * hand-off moves no money: the commitment stays encumbered until the expense line is matched in the
 * actuals review. The draft's progress comes back with the expense tool's sync (object
 * `expense_reports`). Without a connected tool the same fields are offered to copy.
 */
@Injectable()
export class ExpenseHandoffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
  ) {}

  get(actor: RequestActor, requestId: string): Promise<ExpenseHandoffView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.view(tx, actor, requestId),
    );
  }

  async create(
    actor: RequestActor,
    requestId: string,
    ctx: CommandContext,
  ): Promise<{ body: ExpenseHandoffView; replayed: boolean }> {
    // Read and validate first; the tool is called outside any transaction.
    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const [replay] = await tx
          .select({ id: idempotencyKeys.id })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.key, ctx.idempotencyKey),
              eq(idempotencyKeys.operation, `integrations.expense_handoff:${requestId}`),
            ),
          );
        const view = await this.view(tx, actor, requestId);
        if (replay) return { view, call: null };
        if (view.availability === 'created')
          throw new ApiProblem(
            409,
            'EXPENSE_HANDOFF_EXISTS',
            `A draft expense already exists in ${view.tool?.displayName ?? 'the expense tool'}; open it there.`,
            { externalId: view.handoff?.externalId ?? null },
          );
        if (view.availability !== 'ready')
          throw new ApiProblem(
            view.availability === 'not_allowed' ? 403 : 422,
            view.availability === 'not_allowed' ? 'FORBIDDEN' : 'EXPENSE_HANDOFF_NOT_AVAILABLE',
            {
              not_allowed: 'Only the person who made the request can create its expense.',
              not_approved: 'An expense can be created once the request is approved.',
              not_connected: 'No expense tool is connected; copy the details instead.',
            }[view.availability as 'not_allowed' | 'not_approved' | 'not_connected'],
          );
        const row = (await this.toolConnection(tx))!;
        const context = await this.connections.contextFor(tx, row);
        const [me] = actor.personId
          ? await tx
              .select({ email: people.email })
              .from(people)
              .where(eq(people.id, actor.personId))
          : [];
        return { view, call: { context, employeeEmail: me?.email ?? '', connectionId: row.id } };
      },
    );

    let externalId: string | null = null;
    if (prepared.call) {
      const { context, employeeEmail } = prepared.call;
      const def = context.definition;
      const f = prepared.view.fields;
      const res = await this.http.send({
        url: `${context.baseUrl}${def.draftExpense!.path}`,
        method: 'POST',
        headers: {
          authorization: `Bearer ${context.credential}`,
          'content-type': 'application/json',
          // The tool de-duplicates on this, so a retried hand-off never creates a second draft.
          'idempotency-key': `budgetflow-handoff:${requestId}`,
        },
        body: JSON.stringify({
          EmployeeEmail: employeeEmail,
          ExpenseTypeName: f.expenseType,
          TransactionAmount: major(f.amount.amountMinor, f.amount.currency),
          TransactionCurrencyCode: f.amount.currency,
          TransactionDate: f.date,
          CostCenter: f.costCenterCode,
          EventCode: f.eventCode,
          VendorDescription: f.merchant,
          Description: f.title,
          BudgetFlowRequestRef: f.requestRef,
        }),
        timeoutMs: 10_000,
      });
      if (!res.ok) {
        throw new ApiProblem(
          422,
          'EXPENSE_TOOL_REJECTED',
          `${def.displayName} did not accept the draft: ${providerMessage(res.statusCode || null, res.body)}`,
          { statusCode: res.statusCode || 0 },
        );
      }
      externalId = String((JSON.parse(res.body) as { ID?: string }).ID ?? '');
      if (!externalId)
        throw new ApiProblem(
          422,
          'EXPENSE_TOOL_REJECTED',
          `${def.displayName} did not return an id for the draft.`,
        );
    }

    const res = await this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.expense_handoff:${requestId}`,
        request: {},
        status: 201,
      },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(expenseHandoffs)
          .where(eq(expenseHandoffs.requestId, requestId))
          .for('update');
        if (existing)
          throw new ApiProblem(
            409,
            'EXPENSE_HANDOFF_EXISTS',
            'A draft expense already exists for this request; open it in the expense tool.',
            { externalId: existing.externalId },
          );
        // Re-check under the request's lock: still approved, still the requester's (or organizer's).
        const [locked] = await tx
          .select()
          .from(requests)
          .where(eq(requests.id, requestId))
          .for('update');
        const current = await this.view(tx, actor, requestId);
        if (!locked || current.availability !== 'ready')
          throw new ApiProblem(
            409,
            'EXPENSE_HANDOFF_NOT_AVAILABLE',
            'The request changed while the draft was being created; open it again.',
          );
        const connectionId = prepared.call!.connectionId;
        const [row] = await tx
          .select()
          .from(integrationConnections)
          .where(eq(integrationConnections.id, connectionId));
        const now = new Date();
        const [created] = await tx
          .insert(expenseHandoffs)
          .values({
            tenantId: actor.tenantId,
            requestId,
            connectionId: row.id,
            externalId: externalId!,
            status: 'draft_created',
            fields: prepared.view.fields,
            history: [{ status: 'draft_created', at: now.toISOString() }],
            createdBy: actor.personId,
            statusChangedAt: now,
          })
          .returning();
        const [req] = await tx.select().from(requests).where(eq(requests.id, requestId));
        const [budget] = req.budgetId
          ? await tx.select().from(budgets).where(eq(budgets.id, req.budgetId))
          : [];
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'request.expense_handoff_created',
          resourceType: 'request',
          resourceId: requestId,
          legalEntityId: budget?.legalEntityId ?? null,
          requestId: ctx.requestId,
          changes: {
            expenseTool: { from: null, to: row.displayName },
            externalId: { from: null, to: created.externalId },
            amount: { from: null, to: prepared.view.fields.amount },
          },
        });
        return this.view(tx, actor, requestId);
      },
    );
    return { body: res.body, replayed: res.replayed };
  }

  /**
   * Progress from the expense tool for the drafts BudgetFlow created: Submitted, Approved, Paid and
   * the amount claimed. Applied by the connector identity; a status the hand-off already has (or an
   * older one) changes nothing, so a repeated run is a no-op. One audit entry per change, on the
   * request. Unknown drafts and unknown statuses are refused with the reason.
   */
  async applyStatuses(
    actor: RequestActor,
    connectionId: string,
    records: { externalId: string; status: string; claimedAmount: string; currency: string }[],
  ): Promise<{
    applied: number;
    unchanged: number;
    refused: { externalId: string; reason: string }[];
  }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.manage', { kind: 'tenant', tenantId: actor.tenantId });
      const out = {
        applied: 0,
        unchanged: 0,
        refused: [] as { externalId: string; reason: string }[],
      };
      for (const r of [...records].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
        const status = TOOL_STATUS[r.status.trim().toLowerCase()];
        if (!status) {
          out.refused.push({
            externalId: r.externalId,
            reason: `"${r.status}" is not a status BudgetFlow tracks.`,
          });
          continue;
        }
        const [h] = await tx
          .select()
          .from(expenseHandoffs)
          .where(
            and(
              eq(expenseHandoffs.connectionId, connectionId),
              eq(expenseHandoffs.externalId, r.externalId),
            ),
          )
          .for('update');
        if (!h) {
          out.refused.push({
            externalId: r.externalId,
            reason: 'No BudgetFlow hand-off created this draft.',
          });
          continue;
        }
        let claimed: number | null = h.claimedMinor;
        let claimedCurrency = h.claimedCurrency;
        if (r.claimedAmount) {
          const currency = (r.currency || '').trim().toUpperCase();
          const value = /^[A-Z]{3}$/.test(currency) ? parseMinor(r.claimedAmount, currency) : null;
          if (value === null) {
            out.refused.push({
              externalId: r.externalId,
              reason: `"${r.claimedAmount} ${r.currency}" is not an amount in a known currency.`,
            });
            continue;
          }
          claimed = value;
          claimedCurrency = currency;
        }
        // Progress only moves forward; a stale answer from the tool is not applied over a newer one.
        const forward = ORDER.indexOf(status) > ORDER.indexOf(h.status);
        const claimChanged = claimed !== h.claimedMinor;
        if (!forward && !claimChanged) {
          out.unchanged += 1;
          continue;
        }
        const now = new Date();
        const history = (h.history as { status: string; at: string }[]) ?? [];
        await tx
          .update(expenseHandoffs)
          .set({
            status: forward ? status : h.status,
            claimedMinor: claimed,
            claimedCurrency,
            history: forward ? [...history, { status, at: now.toISOString() }] : history,
            statusChangedAt: forward ? now : h.statusChangedAt,
          })
          .where(eq(expenseHandoffs.id, h.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'request.expense_status_synced',
          resourceType: 'request',
          resourceId: h.requestId,
          requestId: null,
          changes: {
            ...(forward ? { status: { from: h.status, to: status } } : {}),
            ...(claimChanged ? { claimedMinor: { from: h.claimedMinor, to: claimed } } : {}),
          },
        });
        out.applied += 1;
      }
      return out;
    });
  }

  // Reads -------------------------------------------------------------------------------------

  private async view(tx: Tx, actor: RequestActor, requestId: string): Promise<ExpenseHandoffView> {
    const [req] = await tx.select().from(requests).where(eq(requests.id, requestId));
    if (!req) throw ApiProblem.notFound('request');
    const [budget] = req.budgetId
      ? await tx.select().from(budgets).where(eq(budgets.id, req.budgetId))
      : [];
    const [event] = req.eventId
      ? await tx.select().from(events).where(eq(events.id, req.eventId))
      : [];
    const requester = actor.personId === req.requesterPersonId;
    const organizer = !!event && actor.personId === event.organizerPersonId;
    const reads =
      requester ||
      organizer ||
      (!!budget && this.policy.can(actor, 'budget.read', budgetResource(budget)).allowed);
    if (!reads) throw ApiProblem.notFound('request');

    const tool = await this.toolConnection(tx);
    const fields = await this.fields(tx, req, budget, event, tool);
    const [h] = await tx
      .select()
      .from(expenseHandoffs)
      .where(eq(expenseHandoffs.requestId, requestId));
    const availability: ExpenseHandoffView['availability'] = h
      ? 'created'
      : !APPROVED.has(req.status)
        ? 'not_approved'
        : !(requester || organizer)
          ? 'not_allowed'
          : tool
            ? 'ready'
            : 'not_connected';
    const handoffTool = h
      ? (
          await tx
            .select()
            .from(integrationConnections)
            .where(eq(integrationConnections.id, h.connectionId))
        )[0]
      : tool;
    const [creator] = h?.createdBy
      ? await tx.select({ name: people.displayName }).from(people).where(eq(people.id, h.createdBy))
      : [];
    return {
      requestId,
      availability,
      tool: handoffTool
        ? {
            provider: handoffTool.provider as IntegrationProvider,
            displayName: handoffTool.displayName,
          }
        : null,
      fields,
      handoff: h
        ? {
            id: h.id,
            status: h.status as Status,
            externalId: h.externalId,
            createdAt: h.createdAt.toISOString(),
            createdByName: creator?.name ?? null,
            statusChangedAt: h.statusChangedAt.toISOString(),
            history: (h.history as { status: Status; at: string }[]) ?? [],
            claimedAmount:
              h.claimedMinor !== null
                ? {
                    amountMinor: h.claimedMinor,
                    currency: (h.claimedCurrency ?? req.currency) as CurrencyCode,
                  }
                : null,
            differenceMinor:
              h.claimedMinor !== null &&
              (h.claimedCurrency ?? req.currency) === fields.amount.currency
                ? h.claimedMinor - fields.amount.amountMinor
                : null,
          }
        : null,
    };
  }

  /** The connected expense tool that accepts draft expenses, if any (095). */
  private async toolConnection(tx: Tx): Promise<ConnectionRow | null> {
    const rows = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.category, 'expense'),
          isNull(integrationConnections.disconnectedAt),
          isNull(integrationConnections.pausedAt),
        ),
      );
    return (
      rows.find((r) => !!connectorFor(r.provider as IntegrationProvider)?.draftExpense) ?? null
    );
  }

  private async fields(
    tx: Tx,
    req: RequestRow,
    budget: typeof budgets.$inferSelect | undefined,
    event: typeof events.$inferSelect | undefined,
    tool: ConnectionRow | null,
  ): Promise<ExpenseHandoffFields> {
    const [center] = budget?.costCenterId
      ? await tx
          .select({ code: costCenters.code })
          .from(costCenters)
          .where(eq(costCenters.id, budget.costCenterId))
      : [];
    const [vendor] = req.commitmentId
      ? await tx
          .select({ name: vendors.name })
          .from(commitments)
          .innerJoin(vendors, eq(vendors.id, commitments.vendorId))
          .where(eq(commitments.id, req.commitmentId))
      : [];
    // The category's expense type in the tool, from the connection's approved mappings (095).
    const [type] =
      tool && req.category
        ? await tx
            .select({ external: integrationMappings.externalValue })
            .from(integrationMappings)
            .where(
              and(
                eq(integrationMappings.connectionId, tool.id),
                eq(integrationMappings.kind, 'expense_type'),
                eq(integrationMappings.approved, true),
                sql`lower(${integrationMappings.internalValue}) = lower(${req.category})`,
              ),
            )
            .orderBy(asc(integrationMappings.externalValue))
            .limit(1)
        : [];
    const expenseType = type?.external ?? null;
    return {
      requestRef: req.ref,
      title: req.title || req.purpose,
      expenseType,
      amount: {
        amountMinor: req.approvedMinor ?? req.amountMinor,
        currency: req.currency as CurrencyCode,
      },
      date: (req.decidedAt ?? req.createdAt).toISOString().slice(0, 10),
      costCenterCode: center?.code ?? null,
      eventCode: event?.eventCode ?? null,
      merchant: vendor?.name ?? null,
    };
  }
}

const major = (minor: number, currency: string): string => {
  const exp = exponentOf(currency as CurrencyCode);
  return (minor / 10 ** exp).toFixed(exp);
};

/** Major-unit text from the tool into minor units by the ISO 4217 exponent, without floating point. */
function parseMinor(amount: string, currency: string): number | null {
  let exp: number;
  try {
    exp = exponentOf(currency as CurrencyCode);
  } catch {
    return null;
  }
  const clean = amount.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!m || (m[2]?.length ?? 0) > exp) return null;
  const minor = Number(m[1] + (m[2] ?? '').padEnd(exp, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}
