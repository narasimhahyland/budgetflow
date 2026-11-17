import { csvCell } from '@bf/api/actuals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  budgetCategories,
  budgets,
  costCenters,
  financeExportBatches,
  financeExportLines,
  fiscalPeriods,
  glAccounts,
  glMappings,
  ledgerJournals,
  ledgerLines,
  legalEntities,
  people,
  rechargeSchedules,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { S3DocumentStore } from '@bf/api/documents';
import { BenefitsService } from '@bf/api/finance';
import type {
  CreateFinanceExportRequest,
  FinanceExportDetail,
  FinanceExportDownload,
  FinanceExportFormat,
  FinanceExportLine,
  FinanceExportList,
  FinanceExportListQuery,
  FinanceExportPreview,
  FinanceExportStatus,
  FinanceExportSummary,
  FinanceExportType,
  MarkFinanceExportPostedRequest,
} from '@bf/contracts';
import { formatAmount, rechargeMachine, type RechargeStatus } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { plainDecimal } from './export-files';
import { xlsxWorkbook, type XlsxCell } from './file-writers';
import type { CommandContext } from './saved-views.service';

/**
 * Finance and payroll exports (screen 094b, gap B5). An export hands the ERP or payroll entries that
 * BudgetFlow already posted: it reads posted journals (and, for payroll, the employee benefit ledger),
 * never posts or changes a balance, and records which source item went in which export so each item
 * is exported once. Sending items again needs a reason and is marked as a duplicate send.
 *
 * - Intercompany recharges: the balanced due-from / due-to journal of each recharge whose tax approval
 *   is done (053a status approved or scheduled, or later), by the journal's accounting date.
 * - Chargeback and reclass: manual journals and reversals that touch posted actual spend (cost moved
 *   between budgets and cost centers, and corrections of posted actuals).
 * - Payroll benefits: per person, the reportable benefit-in-kind amount newly due since the last
 *   export, per threshold and tax year, as of the month end (080h); totals per person, no balancing.
 */

const DOWNLOAD_TTL = 300;
const CONTENT_TYPES: Record<FinanceExportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * ERP accounts for the ledger's counter accounts. Budget-control buckets (authorized, allocated out,
 * held, pre-encumbered, encumbered) and plan funding, savings and earmark reserve are BudgetFlow-only
 * and never reach the general ledger. Actual spend uses the line's GL account, else the entity's
 * category mapping for the budget (employee attendees), else the entity's "other" mapping.
 */
const ERP_ACCOUNTS: Record<string, [string, string]> = {
  intercompany_due_from: ['1300', 'Intercompany receivable'],
  intercompany_due_to: ['2300', 'Intercompany payable'],
  obligations: ['2000', 'Accounts payable clearing'],
  fx_variance: ['7900', 'Foreign exchange variance'],
  accrued: ['2100', 'Accrued expenses'],
};
const GL_ACCOUNTS = new Set(['actual', ...Object.keys(ERP_ACCOUNTS)]);
/** 053a: a recharge is exportable once its tax approval is done and its journal is posted. */
const EXPORTABLE_RECHARGE: RechargeStatus[] = ['approved', 'scheduled', 'exported', 'posted'];

const TYPE_LABEL: Record<FinanceExportType, string> = {
  intercompany_recharges: 'Intercompany recharges',
  chargeback_reclass: 'Chargeback and reclass',
  payroll_benefits: 'Payroll benefits',
};

interface Line {
  sourceType: 'ledger_line' | 'benefit';
  sourceRef: string;
  journalId: string | null;
  ledgerLineId: string | null;
  journalLineNo: number | null;
  accountingDate: string | null;
  periodLabel: string | null;
  legalEntityId: string;
  legalEntityCode: string;
  account: string | null;
  accountName: string | null;
  costCenter: string | null;
  eventCode: string | null;
  description: string;
  currency: string;
  debitMinor: number;
  creditMinor: number;
  transactionCurrency: string;
  transactionAmountMinor: number;
  rate: string | null;
  personId: string | null;
  personName: string | null;
  benefit: string | null;
  taxYearFrom: string | null;
  taxYearTo: string | null;
  reportableCurrency: string | null;
  reportableMinor: number | null;
  reportableCumulativeMinor: number | null;
  alreadyExported: boolean;
  exportedIn: string | null;
  rechargeId?: string | null;
}

interface Built {
  lines: Line[];
  entityLabel: string;
  legalEntityCode: string | null;
  debitMinor: number;
  creditMinor: number;
  unmapped: number;
  balanced: boolean;
  reportable: { amountMinor: number; currency: string } | null;
  personTotals: { personId: string; personName: string; amountMinor: number; currency: string }[];
  problem: string | null;
  duplicates: number;
  previous: (typeof financeExportBatches.$inferSelect)[];
}

const monthLabel = (period: string): string =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const monthEnd = (period: string): string => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class FinanceExportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly benefits: BenefitsService,
    private readonly store: S3DocumentStore,
  ) {}

  private tenant(actor: RequestActor) {
    return { kind: 'tenant' as const, tenantId: actor.tenantId };
  }

  private allowed(actor: RequestActor, action: Parameters<PolicyService['can']>[1]): boolean {
    return this.policy.can(actor, action, this.tenant(actor)).allowed;
  }

  /** Lines carry journals (finance data) or named people's benefits (personal data). */
  private canSeeLines(actor: RequestActor, type: string): boolean {
    return (
      this.allowed(actor, 'finance_export.read') &&
      this.allowed(actor, type === 'payroll_benefits' ? 'benefits.read' : 'actuals.read')
    );
  }

  private assertLines(actor: RequestActor, type: string): void {
    this.policy.assert(actor, 'finance_export.read', this.tenant(actor), 'finance exports');
    if (!this.canSeeLines(actor, type))
      throw ApiProblem.forbidden(
        type === 'payroll_benefits'
          ? 'Payroll exports name employees; opening them needs access to employee benefits.'
          : 'Opening export lines needs access to actuals and journals.',
      );
  }

  private currentPeriod(): string {
    return nowUtc().toISOString().slice(0, 7);
  }

  list(actor: RequestActor, q: FinanceExportListQuery): Promise<FinanceExportList> {
    this.policy.assert(actor, 'finance_export.read', this.tenant(actor), 'finance exports');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const period = q.period ?? this.currentPeriod();
      const rows = await tx
        .select()
        .from(financeExportBatches)
        .where(
          and(
            eq(financeExportBatches.period, period),
            q.type ? eq(financeExportBatches.type, q.type) : undefined,
          ),
        )
        .orderBy(desc(financeExportBatches.createdAt), desc(financeExportBatches.number));
      const now = nowUtc();
      const periods = Array.from({ length: 12 }, (_v, i) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const value = d.toISOString().slice(0, 7);
        return { value, label: monthLabel(value) };
      });
      return {
        period,
        periodLabel: monthLabel(period),
        periods,
        items: await this.summaries(tx, actor, rows),
        reportingCurrency: actor.reportingCurrency,
        canCreate: this.allowed(actor, 'finance_export.manage'),
      };
    });
  }

  preview(
    actor: RequestActor,
    q: {
      type: FinanceExportType;
      period: string;
      legalEntityId?: string;
      includeExported?: boolean;
    },
  ): Promise<FinanceExportPreview> {
    this.assertLines(actor, q.type);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const includeExported = q.includeExported ?? false;
      const b = await this.build(tx, actor, { ...q, includeExported });
      return {
        type: q.type,
        period: q.period,
        periodLabel: monthLabel(q.period),
        legalEntityId: q.legalEntityId ?? null,
        legalEntityCode: b.legalEntityCode,
        includeExported,
        lines: b.lines.map((l, i) => this.lineDto(l, i + 1)),
        lineCount: b.lines.length,
        debitTotal: { amountMinor: b.debitMinor, currency: actor.reportingCurrency },
        creditTotal: { amountMinor: b.creditMinor, currency: actor.reportingCurrency },
        reportableTotal: b.reportable,
        personTotals: b.personTotals.map((p) => ({
          personId: p.personId,
          personName: p.personName,
          reportable: { amountMinor: p.amountMinor, currency: p.currency },
        })),
        balanced: b.balanced,
        unmappedLines: b.unmapped,
        problem: b.problem,
        nothingToExport: b.lines.length === 0,
        message: b.lines.length === 0 ? this.nothingMessage(q.period, b.legalEntityCode) : null,
        duplicates: b.duplicates,
        previousExports: b.previous.map((p) => ({
          id: p.id,
          number: p.number,
          status: p.status as FinanceExportStatus,
          sentAt: iso(p.sentAt),
          acknowledgedAt: iso(p.acknowledgedAt),
          postedAt: iso(p.postedAt),
        })),
        canCreate:
          this.allowed(actor, 'finance_export.manage') &&
          b.lines.length > 0 &&
          b.balanced &&
          !b.problem,
      };
    });
  }

  private nothingMessage(period: string, entityCode: string | null): string {
    return `No new items for ${monthLabel(period)} in ${entityCode ?? 'any legal entity'}.`;
  }

  create(
    actor: RequestActor,
    body: CreateFinanceExportRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<FinanceExportDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.exports.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'finance_export.manage', this.tenant(actor), 'finance exports');
        this.assertLines(actor, body.type);
        // One export at a time per tenant: numbering and "exported once" are decided under this lock.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`finance-export:${actor.tenantId}`}))`,
        );
        const b = await this.build(tx, actor, body);
        if (b.lines.length === 0)
          throw new ApiProblem(
            409,
            'FINANCE_EXPORT_NOTHING_TO_EXPORT',
            this.nothingMessage(body.period, b.legalEntityCode),
          );
        if (b.problem || !b.balanced)
          throw new ApiProblem(
            422,
            'FINANCE_EXPORT_NOT_BALANCED',
            b.problem ?? 'Debits do not equal credits.',
          );
        if (b.duplicates > 0 && !body.reason)
          throw new ApiProblem(
            422,
            'FINANCE_EXPORT_REASON_REQUIRED',
            `${b.duplicates} line${b.duplicates === 1 ? ' was' : 's were'} already exported. Sending again can create duplicates in the receiving system; give a reason.`,
            { field: 'reason' },
          );

        const now = nowUtc();
        const year = now.getUTCFullYear();
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(financeExportBatches)
          .where(sql`${financeExportBatches.number} like ${`EXP-${year}-%`}`);
        const number = `EXP-${year}-${String(n + 1).padStart(4, '0')}`;
        const id = randomUUID();
        const duplicate = b.duplicates > 0;
        const files = this.render(number, body.type, body.period, b, actor.reportingCurrency);
        await this.store.put(this.key(actor.tenantId, id, 'csv'), CONTENT_TYPES.csv, files.csv);
        await this.store.put(this.key(actor.tenantId, id, 'xlsx'), CONTENT_TYPES.xlsx, files.xlsx);
        const [row] = await tx
          .insert(financeExportBatches)
          .values({
            id,
            tenantId: actor.tenantId,
            number,
            type: body.type,
            period: body.period,
            legalEntityId: body.legalEntityId ?? null,
            entityLabel: b.entityLabel,
            target: 'file',
            status: 'sent',
            lineCount: b.lines.length,
            personCount: body.type === 'payroll_benefits' ? b.personTotals.length : null,
            currency: actor.reportingCurrency,
            debitTotalMinor: b.debitMinor,
            creditTotalMinor: b.creditMinor,
            reportableCurrency: b.reportable?.currency ?? null,
            reportableTotalMinor: b.reportable?.amountMinor ?? null,
            duplicate,
            duplicateReason: duplicate ? body.reason! : null,
            csvSizeBytes: files.csv.length,
            xlsxSizeBytes: files.xlsx.length,
            createdByPersonId: actor.personId,
            sentAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await tx.insert(financeExportLines).values(
          b.lines.map((l, i) => ({
            tenantId: actor.tenantId,
            batchId: id,
            lineNo: i + 1,
            sourceType: l.sourceType,
            sourceRef: l.sourceRef,
            duplicate: l.alreadyExported,
            journalId: l.journalId,
            ledgerLineId: l.ledgerLineId,
            journalLineNo: l.journalLineNo,
            accountingDate: l.accountingDate,
            periodLabel: l.periodLabel,
            legalEntityId: l.legalEntityId,
            legalEntityCode: l.legalEntityCode,
            account: l.account,
            accountName: l.accountName,
            costCenter: l.costCenter,
            eventCode: l.eventCode,
            description: l.description,
            currency: l.currency,
            debitMinor: l.debitMinor,
            creditMinor: l.creditMinor,
            transactionCurrency: l.transactionCurrency,
            transactionAmountMinor: l.transactionAmountMinor,
            rate: l.rate,
            personId: l.personId,
            personName: l.personName,
            benefit: l.benefit,
            taxYearFrom: l.taxYearFrom,
            taxYearTo: l.taxYearTo,
            reportableCurrency: l.reportableCurrency,
            reportableMinor: l.reportableMinor,
            reportableCumulativeMinor: l.reportableCumulativeMinor,
            createdAt: now,
          })),
        );
        // 053a: a recharge handed to the ERP reads "Exported" (approved → scheduled → exported).
        const rechargeIds = [
          ...new Set(
            b.lines
              .filter((l) => !l.alreadyExported && l.rechargeId)
              .map((l) => l.rechargeId as string),
          ),
        ];
        const moved: { id: string; from: string; to: string }[] = [];
        if (rechargeIds.length) {
          const recharges = await tx
            .select({ id: rechargeSchedules.id, status: rechargeSchedules.status })
            .from(rechargeSchedules)
            .where(inArray(rechargeSchedules.id, rechargeIds))
            .orderBy(asc(rechargeSchedules.id))
            .for('update');
          for (const r of recharges) {
            let to = r.status as RechargeStatus;
            if (to === 'approved') to = this.next(to, 'schedule');
            if (to === 'scheduled') to = this.next(to, 'export');
            if (to === r.status) continue;
            await tx
              .update(rechargeSchedules)
              .set({ status: to })
              .where(eq(rechargeSchedules.id, r.id));
            moved.push({ id: r.id, from: r.status, to });
          }
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: duplicate ? 'finance_export.resent' : 'finance_export.created',
          resourceType: 'finance_export',
          resourceId: id,
          legalEntityId: body.legalEntityId ?? null,
          requestId: ctx.requestId,
          reason: duplicate ? body.reason! : null,
          changes: {
            number: { from: null, to: number },
            type: { from: null, to: body.type },
            period: { from: null, to: body.period },
            status: { from: null, to: 'sent' },
            lines: { from: null, to: b.lines.length },
            debitTotalMinor: { from: null, to: b.debitMinor },
            creditTotalMinor: { from: null, to: b.creditMinor },
            reportableTotalMinor: { from: null, to: b.reportable?.amountMinor ?? null },
            sources: { from: null, to: b.lines.map((l) => l.sourceRef) },
            duplicateLines: { from: null, to: b.duplicates },
            recharges: { from: null, to: moved },
          },
        });
        return this.detailTx(tx, actor, row);
      },
    );
  }

  private next(from: RechargeStatus, event: 'schedule' | 'export' | 'post'): RechargeStatus {
    const r = rechargeMachine.next(from, event);
    return r.ok ? r.value : from;
  }

  get(actor: RequestActor, exportId: string): Promise<FinanceExportDetail> {
    this.policy.assert(actor, 'finance_export.read', this.tenant(actor), 'finance exports');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.row(tx, exportId);
      this.assertLines(actor, row.type);
      return this.detailTx(tx, actor, row);
    });
  }

  markPosted(
    actor: RequestActor,
    exportId: string,
    body: MarkFinanceExportPostedRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<FinanceExportSummary>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.exports.posted',
        request: { exportId, ...body },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'finance_export.manage', this.tenant(actor), 'finance exports');
        const [locked] = await tx
          .select()
          .from(financeExportBatches)
          .where(eq(financeExportBatches.id, exportId))
          .for('update');
        if (!locked) throw ApiProblem.notFound('export');
        if (locked.status === 'posted')
          throw new ApiProblem(
            409,
            'FINANCE_EXPORT_ALREADY_POSTED',
            `${locked.number} was already marked posted as ${locked.erpDocumentNumber ?? 'a posted document'}.`,
          );
        if (locked.status !== 'sent' && locked.status !== 'acknowledged')
          throw new ApiProblem(
            409,
            'VALIDATION_FAILED',
            `${locked.number} has not been delivered, so it cannot be marked posted.`,
          );
        const now = nowUtc();
        const [row] = await tx
          .update(financeExportBatches)
          .set({
            status: 'posted',
            erpDocumentNumber: body.erpDocumentNumber,
            postedAt: now,
            postedByPersonId: actor.personId,
            updatedAt: now,
          })
          .where(eq(financeExportBatches.id, exportId))
          .returning();
        // 053a: recharges this export carried read "Posted" once the ERP has them.
        const moved: { id: string; from: string; to: string }[] = [];
        if (locked.type === 'intercompany_recharges') {
          const journalIds = (
            await tx
              .selectDistinct({ id: financeExportLines.journalId })
              .from(financeExportLines)
              .where(eq(financeExportLines.batchId, exportId))
          )
            .map((r) => r.id)
            .filter((x): x is string => Boolean(x));
          if (journalIds.length) {
            const recharges = await tx
              .select({ id: rechargeSchedules.id, status: rechargeSchedules.status })
              .from(rechargeSchedules)
              .where(inArray(rechargeSchedules.journalId, journalIds))
              .orderBy(asc(rechargeSchedules.id))
              .for('update');
            for (const r of recharges) {
              const to = this.next(r.status as RechargeStatus, 'post');
              if (to === r.status) continue;
              await tx
                .update(rechargeSchedules)
                .set({ status: to })
                .where(eq(rechargeSchedules.id, r.id));
              moved.push({ id: r.id, from: r.status, to });
            }
          }
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'finance_export.marked_posted',
          resourceType: 'finance_export',
          resourceId: exportId,
          legalEntityId: locked.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            status: { from: locked.status, to: 'posted' },
            erpDocumentNumber: { from: locked.erpDocumentNumber, to: body.erpDocumentNumber },
            recharges: { from: null, to: moved },
          },
        });
        return (await this.summaries(tx, actor, [row]))[0];
      },
    );
  }

  /** A five-minute signed link to the file; handing out a link is audited (screen 091). */
  download(
    actor: RequestActor,
    exportId: string,
    format: FinanceExportFormat,
    requestId: string | null,
  ): Promise<FinanceExportDownload> {
    this.policy.assert(actor, 'finance_export.read', this.tenant(actor), 'finance exports');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.row(tx, exportId);
      this.assertLines(actor, row.type);
      const fileName = `${row.number}-${row.type.replace(/_/g, '-')}-${row.period}.${format}`;
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'finance_export.downloaded',
        resourceType: 'finance_export',
        resourceId: row.id,
        legalEntityId: row.legalEntityId,
        requestId,
        changes: { number: row.number, format, fileName },
      });
      return {
        url: this.store.downloadUrl(this.key(row.tenantId, row.id, format), fileName, DOWNLOAD_TTL),
        fileName,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000).toISOString(),
      };
    });
  }

  private key(tenantId: string, id: string, format: string): string {
    return `tenants/${tenantId}/finance-exports/${id}.${format}`;
  }

  private async row(tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(financeExportBatches)
      .where(eq(financeExportBatches.id, id));
    if (!row) throw ApiProblem.notFound('export');
    return row;
  }

  // Building lines ------------------------------------------------------------------------------

  private async build(
    tx: Tx,
    actor: RequestActor,
    q: {
      type: FinanceExportType;
      period: string;
      legalEntityId?: string;
      includeExported: boolean;
    },
  ): Promise<Built> {
    const entities = await tx
      .select({ id: legalEntities.id, code: legalEntities.code })
      .from(legalEntities);
    const codeOf = new Map(entities.map((e) => [e.id, e.code]));
    if (q.legalEntityId && !codeOf.has(q.legalEntityId)) throw ApiProblem.notFound('legal entity');
    const legalEntityCode = q.legalEntityId ? codeOf.get(q.legalEntityId)! : null;
    const all =
      q.type === 'payroll_benefits'
        ? await this.payrollLines(tx, actor, q, codeOf)
        : await this.journalLines(tx, actor, q, codeOf);
    const lines = q.includeExported ? all : all.filter((l) => !l.alreadyExported);
    const duplicates = lines.filter((l) => l.alreadyExported).length;
    const previousNumbers = [
      ...new Set(all.map((l) => l.exportedIn).filter((x): x is string => Boolean(x))),
    ];
    const previous = previousNumbers.length
      ? await tx
          .select()
          .from(financeExportBatches)
          .where(inArray(financeExportBatches.number, previousNumbers))
          .orderBy(asc(financeExportBatches.number))
      : [];

    let entityLabel = legalEntityCode ?? 'All entities';
    if (q.type === 'intercompany_recharges' && lines.length) {
      const from = [
        ...new Set(lines.filter((l) => l.debitMinor > 0).map((l) => l.legalEntityCode)),
      ];
      const to = [...new Set(lines.filter((l) => l.creditMinor > 0).map((l) => l.legalEntityCode))];
      if (from.length === 1 && to.length === 1) entityLabel = `${from[0]} to ${to[0]}`;
    }

    if (q.type === 'payroll_benefits') {
      const currencies = [...new Set(lines.map((l) => l.reportableCurrency))];
      const byPerson = new Map<
        string,
        { personId: string; personName: string; amountMinor: number; currency: string }
      >();
      for (const l of lines) {
        const p = byPerson.get(l.personId!) ?? {
          personId: l.personId!,
          personName: l.personName ?? '',
          amountMinor: 0,
          currency: l.reportableCurrency!,
        };
        p.amountMinor += l.reportableMinor ?? 0;
        byPerson.set(l.personId!, p);
      }
      const total = lines.reduce((a, l) => a + (l.reportableMinor ?? 0), 0);
      return {
        lines,
        entityLabel,
        legalEntityCode,
        debitMinor: 0,
        creditMinor: 0,
        unmapped: 0,
        balanced: true,
        reportable: lines.length
          ? { amountMinor: total, currency: (currencies[0] ?? actor.reportingCurrency) as string }
          : null,
        personTotals: [...byPerson.values()].sort((a, b) =>
          a.personName.localeCompare(b.personName),
        ),
        problem:
          currencies.length > 1
            ? 'The reportable benefits are in more than one currency; export each payroll separately.'
            : null,
        duplicates,
        previous,
      };
    }

    const mapped = lines.filter((l) => l.account);
    const debitMinor = mapped.reduce((a, l) => a + l.debitMinor, 0);
    const creditMinor = mapped.reduce((a, l) => a + l.creditMinor, 0);
    const unmapped = lines.length - mapped.length;
    const balanced = unmapped === 0 && debitMinor === creditMinor;
    const ccy = actor.reportingCurrency;
    const problem =
      lines.length && !balanced
        ? `Debits ${formatAmount(debitMinor, ccy)}, credits ${formatAmount(creditMinor, ccy)}` +
          (unmapped
            ? `: ${unmapped} line${unmapped === 1 ? ' has' : 's have'} no account mapping.`
            : '.')
        : null;
    return {
      lines,
      entityLabel,
      legalEntityCode,
      debitMinor,
      creditMinor,
      unmapped,
      balanced,
      reportable: null,
      personTotals: [],
      problem,
      duplicates,
      previous,
    };
  }

  /** The first (non-duplicate) export of each source item, by source ref. */
  private async exportedIn(
    tx: Tx,
    sourceType: string,
    refs: string[],
  ): Promise<Map<string, string>> {
    if (!refs.length) return new Map();
    const rows = await tx
      .select({ ref: financeExportLines.sourceRef, number: financeExportBatches.number })
      .from(financeExportLines)
      .innerJoin(financeExportBatches, eq(financeExportBatches.id, financeExportLines.batchId))
      .where(
        and(
          eq(financeExportLines.sourceType, sourceType),
          eq(financeExportLines.duplicate, false),
          inArray(financeExportLines.sourceRef, refs),
        ),
      );
    return new Map(rows.map((r) => [r.ref, r.number]));
  }

  private async journalLines(
    tx: Tx,
    actor: RequestActor,
    q: { type: FinanceExportType; period: string; legalEntityId?: string },
    codeOf: Map<string, string>,
  ): Promise<Line[]> {
    const from = `${q.period}-01`;
    const to = monthEnd(q.period);
    const inMonth = and(
      gte(ledgerJournals.accountingDate, from),
      lte(ledgerJournals.accountingDate, to),
    );

    // Which journals, and a description and recharge link for each.
    const journals = new Map<
      string,
      { description: string; rechargeId: string | null; reversal: boolean }
    >();
    if (q.type === 'intercompany_recharges') {
      const rows = await tx
        .select({ j: ledgerJournals, r: rechargeSchedules })
        .from(rechargeSchedules)
        .innerJoin(ledgerJournals, eq(ledgerJournals.id, rechargeSchedules.journalId))
        .where(
          and(
            inArray(rechargeSchedules.status, EXPORTABLE_RECHARGE),
            eq(ledgerJournals.journalType, 'recharge'),
            inMonth,
            q.legalEntityId
              ? sql`(${rechargeSchedules.fromLegalEntityId} = ${q.legalEntityId} or ${rechargeSchedules.toLegalEntityId} = ${q.legalEntityId})`
              : undefined,
          ),
        );
      for (const { j, r } of rows) {
        const markup = r.markupMinor
          ? ` with markup ${formatAmount(r.markupMinor, r.currency)}`
          : ' at cost';
        journals.set(j.id, {
          description: `Intercompany recharge ${codeOf.get(r.fromLegalEntityId) ?? ''} to ${codeOf.get(r.toLegalEntityId) ?? ''}${markup}`,
          rechargeId: r.id,
          reversal: false,
        });
      }
    } else {
      const rows = await tx
        .select()
        .from(ledgerJournals)
        .where(
          and(
            inArray(ledgerJournals.journalType, ['manual', 'reversal']),
            inMonth,
            sql`exists (select 1 from ledger_lines a where a.journal_id = ${ledgerJournals.id} and a.account = 'actual')`,
            q.legalEntityId
              ? sql`exists (select 1 from ledger_lines e where e.journal_id = ${ledgerJournals.id} and e.legal_entity_id = ${q.legalEntityId})`
              : undefined,
          ),
        );
      for (const j of rows) {
        const reversal = j.journalType === 'reversal';
        const reason = [j.reasonCode, j.reason].filter(Boolean).join(': ');
        journals.set(j.id, {
          description:
            (reversal ? 'Reclass (reversal of a posted actual)' : 'Chargeback') +
            (reason ? ` - ${reason}` : ''),
          rechargeId: null,
          reversal,
        });
      }
    }
    if (!journals.size) return [];

    const rows = await tx
      .select({
        l: ledgerLines,
        period: fiscalPeriods.label,
        gl: glAccounts.code,
        glName: glAccounts.name,
        cc: costCenters.code,
        categoryId: budgets.categoryId,
        budgetCc: budgets.costCenterId,
      })
      .from(ledgerLines)
      .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerLines.journalId))
      .leftJoin(fiscalPeriods, eq(fiscalPeriods.id, ledgerLines.fiscalPeriodId))
      .leftJoin(glAccounts, eq(glAccounts.id, ledgerLines.glAccountId))
      .leftJoin(budgets, eq(budgets.id, ledgerLines.budgetId))
      .leftJoin(
        costCenters,
        sql`${costCenters.id} = coalesce(${ledgerLines.costCenterId}, ${budgets.costCenterId})`,
      )
      .where(inArray(ledgerLines.journalId, [...journals.keys()]))
      .orderBy(
        asc(ledgerJournals.accountingDate),
        asc(ledgerJournals.createdAt),
        asc(ledgerLines.lineNo),
      );

    // Actual spend without a GL account on the line falls back to the entity's mapping for the
    // budget's category, then to its "other" category (as the accruals export defaults to 6900).
    const mappings = await tx
      .select({
        le: glMappings.legalEntityId,
        category: glMappings.categoryId,
        categoryCode: budgetCategories.code,
        code: glAccounts.code,
        name: glAccounts.name,
      })
      .from(glMappings)
      .innerJoin(glAccounts, eq(glAccounts.id, glMappings.glAccountId))
      .innerJoin(budgetCategories, eq(budgetCategories.id, glMappings.categoryId))
      .where(eq(glMappings.attendeeType, 'employee'));
    const mapOf = new Map(mappings.map((m) => [`${m.le}:${m.category}`, m]));
    const otherOf = new Map(
      mappings.filter((m) => m.categoryCode === 'other').map((m) => [m.le, m]),
    );

    const gl = rows.filter((r) => GL_ACCOUNTS.has(r.l.account));
    const exported = await this.exportedIn(
      tx,
      'ledger_line',
      gl.map((r) => r.l.id),
    );
    return gl.map(({ l, period, gl: glCode, glName, cc, categoryId }) => {
      const j = journals.get(l.journalId)!;
      let account: string | null = null;
      let accountName: string | null = null;
      if (l.account === 'actual') {
        const m =
          (categoryId ? mapOf.get(`${l.legalEntityId}:${categoryId}`) : undefined) ??
          otherOf.get(l.legalEntityId);
        account = glCode ?? m?.code ?? null;
        accountName = glCode ? glName : (m?.name ?? null);
      } else {
        [account, accountName] = ERP_ACCOUNTS[l.account];
      }
      const amount = l.reportingAmountMinor;
      return {
        sourceType: 'ledger_line' as const,
        sourceRef: l.id,
        journalId: l.journalId,
        ledgerLineId: l.id,
        journalLineNo: l.lineNo,
        accountingDate: l.accountingDate,
        periodLabel: period,
        legalEntityId: l.legalEntityId,
        legalEntityCode: codeOf.get(l.legalEntityId) ?? '',
        account,
        accountName,
        costCenter: cc,
        eventCode: l.eventCode,
        description: j.description,
        currency: actor.reportingCurrency,
        debitMinor: amount > 0 ? amount : 0,
        creditMinor: amount < 0 ? -amount : 0,
        transactionCurrency: l.transactionCurrency,
        transactionAmountMinor: l.transactionAmountMinor,
        rate: l.reportingRate,
        personId: null,
        personName: null,
        benefit: null,
        taxYearFrom: null,
        taxYearTo: null,
        reportableCurrency: null,
        reportableMinor: null,
        reportableCumulativeMinor: null,
        alreadyExported: exported.has(l.id),
        exportedIn: exported.get(l.id) ?? null,
        rechargeId: j.rechargeId,
      };
    });
  }

  /**
   * Payroll: each person's reportable benefit per threshold and tax year as of the month end (080h).
   * An export carries what is newly reportable since the last export of that person, threshold and
   * tax year (`source_ref` ends with the cumulative amount, so the same state is never sent twice).
   */
  private async payrollLines(
    tx: Tx,
    actor: RequestActor,
    q: { period: string; legalEntityId?: string },
    codeOf: Map<string, string>,
  ): Promise<Line[]> {
    if (!q.legalEntityId)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Choose the legal entity whose payroll receives the export.',
        { field: 'legalEntityId' },
      );
    const asOf = monthEnd(q.period);
    const view = await this.benefits.ledger(actor, { legalEntityId: q.legalEntityId, asOf });
    const rows = view.items.filter((r) => r.reportable && r.reportable.amountMinor > 0);
    if (!rows.length) return [];
    const prefixes = rows.map((r) => `benefit:${r.personId}:${r.thresholdId}:${r.window.fromDate}`);
    const prior = await tx
      .select({
        ref: financeExportLines.sourceRef,
        cumulative: financeExportLines.reportableCumulativeMinor,
        number: financeExportBatches.number,
      })
      .from(financeExportLines)
      .innerJoin(financeExportBatches, eq(financeExportBatches.id, financeExportLines.batchId))
      .where(
        and(
          eq(financeExportLines.sourceType, 'benefit'),
          eq(financeExportLines.duplicate, false),
          inArray(
            sql<string>`array_to_string((string_to_array(${financeExportLines.sourceRef}, ':'))[1:4], ':')`,
            prefixes,
          ),
        ),
      )
      .orderBy(asc(financeExportLines.createdAt));
    const last = new Map<string, { cumulative: number; number: string }>();
    for (const p of prior) {
      const prefix = p.ref.split(':').slice(0, 4).join(':');
      last.set(prefix, { cumulative: p.cumulative ?? 0, number: p.number });
    }
    const out: Line[] = [];
    rows.forEach((r, i) => {
      const prefix = prefixes[i];
      const cumulative = r.reportable!.amountMinor;
      const before = last.get(prefix);
      const delta = cumulative - (before?.cumulative ?? 0);
      const already = delta === 0;
      out.push({
        sourceType: 'benefit',
        sourceRef: `${prefix}:${cumulative}`,
        journalId: null,
        ledgerLineId: null,
        journalLineNo: null,
        accountingDate: asOf,
        periodLabel: monthLabel(q.period),
        legalEntityId: r.legalEntityId,
        legalEntityCode: codeOf.get(r.legalEntityId) ?? r.legalEntityCode,
        account: null,
        accountName: null,
        costCenter: null,
        eventCode: null,
        description: already
          ? `${r.thresholdName}: reportable for the tax year to date (sent again)`
          : `${r.thresholdName}: reportable benefit-in-kind`,
        currency: actor.reportingCurrency,
        debitMinor: 0,
        creditMinor: 0,
        transactionCurrency: r.reportable!.currency,
        transactionAmountMinor: already ? cumulative : delta,
        rate: null,
        personId: r.personId,
        personName: r.personName,
        benefit: r.thresholdName,
        taxYearFrom: r.window.fromDate,
        taxYearTo: r.window.toDate,
        reportableCurrency: r.reportable!.currency,
        reportableMinor: already ? cumulative : delta,
        reportableCumulativeMinor: cumulative,
        alreadyExported: already,
        exportedIn: already ? (before?.number ?? null) : null,
      });
    });
    return out.sort(
      (a, b) =>
        (a.personName ?? '').localeCompare(b.personName ?? '') ||
        (a.benefit ?? '').localeCompare(b.benefit ?? ''),
    );
  }

  // DTOs and files ------------------------------------------------------------------------------

  private lineDto(l: Line, lineNo: number): FinanceExportLine {
    return {
      lineNo,
      sourceType: l.sourceType,
      sourceRef: l.sourceRef,
      journalId: l.journalId,
      journalLineNo: l.journalLineNo,
      accountingDate: l.accountingDate,
      periodLabel: l.periodLabel,
      legalEntityId: l.legalEntityId,
      legalEntityCode: l.legalEntityCode,
      account: l.account,
      accountName: l.accountName,
      costCenter: l.costCenter,
      eventCode: l.eventCode,
      description: l.description,
      debit: { amountMinor: l.debitMinor, currency: l.currency },
      credit: { amountMinor: l.creditMinor, currency: l.currency },
      transaction: { amountMinor: l.transactionAmountMinor, currency: l.transactionCurrency },
      rate: l.rate,
      personId: l.personId,
      personName: l.personName,
      benefit: l.benefit,
      taxYear:
        l.taxYearFrom && l.taxYearTo ? { fromDate: l.taxYearFrom, toDate: l.taxYearTo } : null,
      reportable:
        l.reportableMinor !== null && l.reportableCurrency
          ? { amountMinor: l.reportableMinor, currency: l.reportableCurrency }
          : null,
      alreadyExported: l.alreadyExported,
      exportedIn: l.exportedIn,
    };
  }

  private async summaries(
    tx: Tx,
    actor: RequestActor,
    rows: (typeof financeExportBatches.$inferSelect)[],
  ): Promise<FinanceExportSummary[]> {
    const ids = [...new Set(rows.map((r) => r.createdByPersonId).filter((x): x is string => !!x))];
    const names = new Map(
      ids.length
        ? (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, ids))
          ).map((p) => [p.id, p.name])
        : [],
    );
    const manage = this.allowed(actor, 'finance_export.manage');
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type as FinanceExportType,
      period: r.period,
      periodLabel: monthLabel(r.period),
      legalEntityId: r.legalEntityId,
      entityLabel: r.entityLabel,
      lineCount: r.lineCount,
      personCount: r.personCount,
      debitTotal: { amountMinor: r.debitTotalMinor, currency: r.currency },
      creditTotal: { amountMinor: r.creditTotalMinor, currency: r.currency },
      reportableTotal:
        r.reportableTotalMinor !== null && r.reportableCurrency
          ? { amountMinor: r.reportableTotalMinor, currency: r.reportableCurrency }
          : null,
      target: 'file' as const,
      status: r.status as FinanceExportStatus,
      duplicate: r.duplicate,
      duplicateReason: r.duplicateReason,
      erpDocumentNumber: r.erpDocumentNumber,
      acknowledgementRef: r.acknowledgementRef,
      failureMessage: r.failureMessage,
      createdByName: r.createdByPersonId ? (names.get(r.createdByPersonId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      sentAt: iso(r.sentAt),
      postedAt: iso(r.postedAt),
      canDownload: this.canSeeLines(actor, r.type),
      canMarkPosted: manage && (r.status === 'sent' || r.status === 'acknowledged'),
      canResend: manage && this.canSeeLines(actor, r.type),
    }));
  }

  private async detailTx(
    tx: Tx,
    actor: RequestActor,
    row: typeof financeExportBatches.$inferSelect,
  ): Promise<FinanceExportDetail> {
    const lines = await tx
      .select()
      .from(financeExportLines)
      .where(eq(financeExportLines.batchId, row.id))
      .orderBy(asc(financeExportLines.lineNo));
    const dto = lines.map((l) =>
      this.lineDto(
        {
          ...l,
          sourceType: l.sourceType as Line['sourceType'],
          alreadyExported: l.duplicate,
          exportedIn: null,
        },
        l.lineNo,
      ),
    );
    const byPerson = new Map<
      string,
      {
        personId: string;
        personName: string;
        reportable: { amountMinor: number; currency: string };
      }
    >();
    for (const l of dto) {
      if (!l.personId || !l.reportable) continue;
      const p = byPerson.get(l.personId) ?? {
        personId: l.personId,
        personName: l.personName ?? '',
        reportable: { amountMinor: 0, currency: l.reportable.currency },
      };
      p.reportable.amountMinor += l.reportable.amountMinor;
      byPerson.set(l.personId, p);
    }
    return {
      export: (await this.summaries(tx, actor, [row]))[0],
      lines: dto,
      personTotals: [...byPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName)),
    };
  }

  /**
   * CSV and XLSX of the same lines. Money is written in major units with its currency in its own
   * column; every CSV cell goes through `csvCell`, which neutralises formulas.
   */
  private render(
    number: string,
    type: FinanceExportType,
    period: string,
    b: Built,
    reportingCurrency: string,
  ): { csv: Buffer; xlsx: Buffer } {
    const dup = (l: Line) => (l.alreadyExported ? 'yes' : 'no');
    let headers: string[];
    let rows: (string | { n: string })[][];
    let totals: (string | { n: string })[] | null;
    if (type === 'payroll_benefits') {
      headers = [
        'export_id',
        'legal_entity',
        'employee_id',
        'employee_name',
        'benefit',
        'tax_year_from',
        'tax_year_to',
        'reportable_amount',
        'currency',
        'duplicate_send',
      ];
      rows = b.lines.map((l) => [
        number,
        l.legalEntityCode,
        l.personId ?? '',
        l.personName ?? '',
        l.benefit ?? '',
        l.taxYearFrom ?? '',
        l.taxYearTo ?? '',
        { n: plainDecimal(l.reportableMinor ?? 0, l.reportableCurrency ?? reportingCurrency) },
        l.reportableCurrency ?? '',
        dup(l),
      ]);
      totals = b.reportable
        ? [
            'Total',
            '',
            '',
            `${b.personTotals.length} person${b.personTotals.length === 1 ? '' : 's'}`,
            '',
            '',
            '',
            { n: plainDecimal(b.reportable.amountMinor, b.reportable.currency) },
            b.reportable.currency,
            '',
          ]
        : null;
    } else {
      headers = [
        'export_id',
        'legal_entity',
        'period',
        'accounting_date',
        'journal_id',
        'journal_line',
        'account',
        'account_name',
        'cost_center',
        'event_code',
        'description',
        `debit (${reportingCurrency})`,
        `credit (${reportingCurrency})`,
        'transaction_currency',
        'transaction_amount',
        'rate',
        'duplicate_send',
      ];
      rows = b.lines.map((l) => [
        number,
        l.legalEntityCode,
        l.periodLabel ?? '',
        l.accountingDate ?? '',
        l.journalId ?? '',
        String(l.journalLineNo ?? ''),
        l.account ?? '',
        l.accountName ?? '',
        l.costCenter ?? '',
        l.eventCode ?? '',
        l.description,
        { n: plainDecimal(l.debitMinor, reportingCurrency) },
        { n: plainDecimal(l.creditMinor, reportingCurrency) },
        l.transactionCurrency,
        { n: plainDecimal(l.transactionAmountMinor, l.transactionCurrency) },
        l.rate ?? '',
        dup(l),
      ]);
      totals = [
        'Total',
        ...Array(10).fill(''),
        { n: plainDecimal(b.debitMinor, reportingCurrency) },
        { n: plainDecimal(b.creditMinor, reportingCurrency) },
        '',
        '',
        '',
        '',
      ];
    }
    const plain = (c: string | { n: string }) => (typeof c === 'string' ? c : c.n);
    const csvLines = [
      headers.map(csvCell).join(','),
      ...rows.map((r) => r.map((c) => csvCell(plain(c))).join(',')),
      ...(totals ? [totals.map((c) => csvCell(plain(c))).join(',')] : []),
    ];
    const about: XlsxCell[][] = [
      ['Export', number],
      ['Type', TYPE_LABEL[type]],
      ['Period', monthLabel(period)],
      ['Entity', b.entityLabel],
      ['Lines', String(b.lines.length)],
      [
        'Balance check',
        type === 'payroll_benefits'
          ? 'Totals per person'
          : b.balanced
            ? 'Debits equal credits'
            : 'Not balanced',
      ],
      ['Duplicate send', b.duplicates > 0 ? 'yes' : 'no'],
    ];
    const xlsx = xlsxWorkbook(
      [
        { name: 'Lines', rows: [headers, ...rows, ...(totals ? [totals] : [])] },
        { name: 'About', rows: about },
      ],
      number,
    );
    return { csv: Buffer.from(`${csvLines.join('\r\n')}\r\n`, 'utf8'), xlsx };
  }
}
