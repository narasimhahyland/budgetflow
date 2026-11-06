import { AuditService } from '@bf/api/audit';
import { BudgetViews, PlanningService, budgetResource } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  commitments,
  documents,
  fiscalYears,
  people,
  walletClaims,
  walletPrograms,
  wallets,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import { PostingSupport, type LockedBudget, type PostCtx } from '@bf/api/spend';
import type {
  CreateWalletClaimRequest,
  PayWalletClaimRequest,
  UpsertWalletProgramRequest,
  Wallet,
  WalletClaim,
  WalletClaimDecisionRequest,
  WalletClaimList,
  WalletClaimStatus,
  WalletOverview,
  WalletProgram,
  WalletProgramList,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  convert,
  crossRate,
  postCommitmentMovement,
  type CurrencyCode,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { iso, nameOfPeople, todayUtc, type CommandContext } from './support';

type ProgramRow = typeof walletPrograms.$inferSelect;
type WalletRow = typeof wallets.$inferSelect;
type ClaimRow = typeof walletClaims.$inferSelect;

/** Claims that have already spoken for part of the allowance. A returned claim gives it back. */
const CONSUMING_STATUSES: readonly string[] = ['submitted', 'approved', 'paid'];

/**
 * Wellbeing and learning wallets (120b).
 *
 * A wallet is not a pot of money. The allowance is a per-person cap on top of a funding budget, and
 * every claim is ordinary ledger spend on that budget:
 *
 * - submit pre-encumbers, approve encumbers, pay consumes (actual), return releases the
 *   pre-encumbrance; each movement is a balanced `postCommitmentMovement` journal with one
 *   hash-chained audit entry and an idempotency key.
 * - The funding budget's controls apply to new claims: a frozen or zeroed budget refuses them with
 *   its own typed reason, exactly as it refuses any request, while claims already submitted finish.
 * - The budget's available amount is the real limit. A claim that fits the wallet balance but not
 *   the budget is refused by `INSUFFICIENT_AVAILABLE` from the posting itself, so a wallet can never
 *   become a side channel that spends past the budget.
 * - Amounts stay integer minor units in the transaction currency with a budget-currency amount at
 *   the locked plan rate; the wallet balance is kept in the budget currency, so FX never grants
 *   anyone more allowance.
 */
@Injectable()
export class WalletsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly planning: PlanningService,
    private readonly posting: PostingSupport,
    private readonly reads: LedgerReads,
  ) {}

  // Programs -----------------------------------------------------------------------------

  listPrograms(actor: RequestActor): Promise<WalletProgramList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(
        actor,
        'tenant.read',
        { kind: 'tenant', tenantId: actor.tenantId },
        'wallet program',
      );
      const rows = await this.programRows(tx, actor.tenantId);
      return { items: await this.programViews(tx, rows) };
    });
  }

  upsertProgram(actor: RequestActor, req: UpsertWalletProgramRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `wallets.program:${req.key}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const budget = await this.views.row(tx, req.fundingBudgetId);
        // A wallet programme is a promise to spend a budget, so the authorization that matters is
        // the money one: whoever sets it up has to be able to allocate from the funding budget.
        // Administration alone is not enough, which is the same rule that stops a feature switch
        // from conferring authority.
        this.policy.assert(actor, 'budget.allocate', budgetResource(budget), 'budget');
        if (req.yearlyAllowanceMinor <= 0)
          throw new ApiProblem(
            422,
            'WALLET_PROGRAM_INVALID',
            'The yearly allowance has to be more than zero.',
            { field: 'yearlyAllowanceMinor' },
          );
        const existing = (await this.programRows(tx, actor.tenantId)).find(
          (p) => p.key === req.key,
        );
        const values = {
          tenantId: actor.tenantId,
          key: req.key,
          name: req.name,
          kind: req.kind,
          fundingBudgetId: budget.id,
          fiscalYearId: budget.fiscalYearId,
          yearlyAllowanceMinor: req.yearlyAllowanceMinor,
          currency: budget.currency,
          categories: req.categories,
          eligibleEmploymentTypes: req.eligibleEmploymentTypes ?? ['employee'],
          receiptRequired: true,
          taxable: req.taxable ?? false,
          carryUnused: req.carryUnused ?? false,
          reviewerPersonId: req.reviewerPersonId ?? null,
          active: req.active ?? true,
          updatedAt: new Date(),
        };
        const [row] = existing
          ? await tx
              .update(walletPrograms)
              .set(values)
              .where(eq(walletPrograms.id, existing.id))
              .returning()
          : await tx.insert(walletPrograms).values(values).returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: existing ? 'wallet_program.updated' : 'wallet_program.created',
          resourceType: 'wallet_program',
          resourceId: row.id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            yearlyAllowanceMinor: {
              from: existing ? Number(existing.yearlyAllowanceMinor) : null,
              to: req.yearlyAllowanceMinor,
            },
            fundingBudgetId: { from: existing?.fundingBudgetId ?? null, to: budget.id },
            active: { from: existing?.active ?? null, to: values.active },
          },
        });
        return (await this.programViews(tx, [row]))[0];
      },
    );
  }

  // Wallets and claims --------------------------------------------------------------------

  myWallets(actor: RequestActor): Promise<WalletOverview> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!actor.personId) throw ApiProblem.forbidden('Only a person has wallets.');
      const programs = (await this.programRows(tx, actor.tenantId)).filter((p) => p.active);
      const mine: Wallet[] = [];
      for (const program of programs) {
        const wallet = await this.walletFor(tx, actor.tenantId, program, actor.personId, false);
        if (wallet) mine.push(await this.walletView(tx, program, wallet));
      }
      const claims = await tx
        .select()
        .from(walletClaims)
        .where(
          and(eq(walletClaims.tenantId, actor.tenantId), eq(walletClaims.personId, actor.personId)),
        )
        .orderBy(asc(walletClaims.claimDate), asc(walletClaims.id));
      return { wallets: mine, claims: await this.claimViews(tx, claims) };
    });
  }

  listClaims(
    actor: RequestActor,
    query: { status?: WalletClaimStatus; programId?: string },
  ): Promise<WalletClaimList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(walletClaims)
        .where(
          and(
            eq(walletClaims.tenantId, actor.tenantId),
            query.status ? eq(walletClaims.status, query.status) : undefined,
            query.programId ? eq(walletClaims.programId, query.programId) : undefined,
          ),
        )
        .orderBy(asc(walletClaims.claimDate), asc(walletClaims.id));
      const programs = await this.programRows(tx, actor.tenantId);
      // An employee sees their own claims; a reviewer sees the claims of the programmes they review;
      // finance sees them all through the funding budget they can already read.
      const visible = [] as ClaimRow[];
      for (const row of rows) {
        const program = programs.find((p) => p.id === row.programId);
        if (!program) continue;
        if (row.personId === actor.personId) visible.push(row);
        else if (await this.canReview(tx, actor, program)) visible.push(row);
      }
      return { items: await this.claimViews(tx, visible) };
    });
  }

  createClaim(actor: RequestActor, req: CreateWalletClaimRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'wallets.createClaim',
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden('Only a person can claim from a wallet.');
        const { wallet, program } = await this.walletForClaim(tx, actor, req.programId);
        if (wallet.closedAt)
          throw new ApiProblem(
            409,
            'WALLET_NOT_ELIGIBLE',
            'This wallet is closed. Claims made before it closed are still reviewed.',
          );
        if (!program.categories.includes(req.category))
          throw new ApiProblem(
            422,
            'WALLET_CATEGORY_NOT_ALLOWED',
            `${req.category} is not one of the categories this programme pays for.`,
            { field: 'category' },
          );
        if (program.receiptRequired && !req.documentId)
          throw new ApiProblem(
            422,
            'WALLET_RECEIPT_REQUIRED',
            'Attach the receipt: this programme pays nothing without one.',
            { field: 'documentId' },
          );
        if (req.documentId) await this.assertDocument(tx, actor.tenantId, req.documentId);
        const locked = await this.posting.lock(tx, [program.fundingBudgetId]);
        const funding = locked.get(program.fundingBudgetId)!;
        const budgetAmountMinor = await this.toBudgetCurrency(
          tx,
          funding,
          req.amountMinor,
          req.currency,
        );
        const balance = await this.balance(tx, wallet, program);
        if (budgetAmountMinor > balance)
          throw new ApiProblem(
            422,
            'WALLET_BALANCE_EXCEEDED',
            `This claim is more than the ${(balance / 100).toFixed(2)} ${wallet.currency} left in the wallet.`,
            { field: 'amountMinor', balanceMinor: balance },
          );
        // Wallet claims are new activity on the funding budget, so the budget's controls decide
        // whether one may start at all: a frozen or zeroed programme budget refuses it by name.
        const accepts = acceptsNewActivity(funding.row.status);
        if (!accepts.ok) throw new ApiProblem(409, accepts.error.code, accepts.error.message);
        const check = await this.planning.spendCheckInTx(tx, funding.row, {
          amountMinor: budgetAmountMinor,
        });
        if (check.outcome === 'blocked')
          throw new ApiProblem(
            409,
            (check.reasons[0]?.code ?? 'INSUFFICIENT_AVAILABLE') as 'INSUFFICIENT_AVAILABLE',
            check.reasons[0]?.message ??
              'This claim is more than the programme budget has available.',
          );
        const [commitment] = await tx
          .insert(commitments)
          .values({
            tenantId: actor.tenantId,
            budgetId: funding.row.id,
            status: 'pre_encumbered',
            legalEntityId: funding.row.legalEntityId,
            costCenterId: funding.row.costCenterId,
            description: `${program.name}: ${req.category} at ${req.merchant}`,
            amountMinor: budgetAmountMinor,
            currency: funding.row.currency,
            createdByPersonId: actor.personId,
          })
          .returning();
        const journalIds = await this.move(
          tx,
          actor,
          funding,
          commitment.id,
          budgetAmountMinor,
          'pre_encumber',
          ctx,
        );
        const [claim] = await tx
          .insert(walletClaims)
          .values({
            tenantId: actor.tenantId,
            walletId: wallet.id,
            programId: program.id,
            personId: actor.personId,
            commitmentId: commitment.id,
            category: req.category,
            merchant: req.merchant,
            amountMinor: req.amountMinor,
            currency: req.currency,
            budgetAmountMinor,
            budgetCurrency: funding.row.currency,
            claimDate: req.claimDate,
            documentId: req.documentId ?? null,
            note: req.note ?? null,
            status: 'submitted',
            journalIds,
            taxable: program.taxable,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'wallet_claim.submitted',
          resourceType: 'wallet_claim',
          resourceId: claim.id,
          legalEntityId: funding.row.legalEntityId,
          requestId: ctx.requestId,
          reason: `${program.name} claim for ${req.category}`,
          changes: {
            status: { from: null, to: 'submitted' },
            budgetAmountMinor: { from: null, to: budgetAmountMinor },
            commitmentId: { from: null, to: commitment.id },
            journalIds: { from: null, to: journalIds },
          },
        });
        return (await this.claimViews(tx, [claim]))[0];
      },
    );
  }

  decideClaim(
    actor: RequestActor,
    id: string,
    req: WalletClaimDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `wallets.decideClaim:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const { claim, program } = await this.loadClaim(tx, actor, id);
        if (claim.status !== 'submitted')
          throw new ApiProblem(
            409,
            'WALLET_CLAIM_NOT_OPEN',
            `This claim is ${claim.status}; only a submitted claim can be approved or returned.`,
          );
        if (!(await this.canReview(tx, actor, program)))
          throw ApiProblem.forbidden(
            'Only the programme reviewer or finance decides wallet claims.',
          );
        // Nobody reviews their own claim, for the same reason nobody approves their own request.
        if (claim.personId === actor.personId)
          throw new ApiProblem(422, 'SELF_APPROVAL', 'You cannot decide your own wallet claim.');
        const locked = await this.posting.lock(tx, [program.fundingBudgetId]);
        const funding = locked.get(program.fundingBudgetId)!;
        const amount = Number(claim.budgetAmountMinor);
        const journalIds = await this.move(
          tx,
          actor,
          funding,
          claim.commitmentId!,
          amount,
          req.decision === 'approve' ? 'encumber' : 'release_pre_encumbrance',
          ctx,
        );
        await tx
          .update(commitments)
          .set({
            status: req.decision === 'approve' ? 'encumbered' : 'released',
            releasedMinor: req.decision === 'approve' ? 0 : amount,
            updatedAt: new Date(),
          })
          .where(eq(commitments.id, claim.commitmentId!));
        await tx
          .update(walletClaims)
          .set({
            status: req.decision === 'approve' ? 'approved' : 'returned',
            reviewerPersonId: actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
            journalIds: [...claim.journalIds, ...journalIds],
            updatedAt: new Date(),
          })
          .where(eq(walletClaims.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.decision === 'approve' ? 'wallet_claim.approved' : 'wallet_claim.returned',
          resourceType: 'wallet_claim',
          resourceId: id,
          legalEntityId: funding.row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: {
              from: claim.status,
              to: req.decision === 'approve' ? 'approved' : 'returned',
            },
            journalIds: { from: claim.journalIds, to: journalIds },
          },
        });
        return (await this.claimViews(tx, [await this.claimRow(tx, id)]))[0];
      },
    );
  }

  payClaim(actor: RequestActor, id: string, req: PayWalletClaimRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `wallets.payClaim:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const { claim, program } = await this.loadClaim(tx, actor, id);
        if (claim.status !== 'approved')
          throw new ApiProblem(
            409,
            'WALLET_CLAIM_NOT_OPEN',
            `This claim is ${claim.status}; only an approved claim is paid.`,
          );
        this.policy.assert(
          actor,
          'actuals.manage',
          { kind: 'tenant', tenantId: actor.tenantId },
          'wallet claim',
        );
        const locked = await this.posting.lock(tx, [program.fundingBudgetId]);
        const funding = locked.get(program.fundingBudgetId)!;
        const amount = Number(claim.budgetAmountMinor);
        // Paying moves encumbered to actual, exactly as a matched actual does for any commitment.
        const journalIds = await this.move(
          tx,
          actor,
          funding,
          claim.commitmentId!,
          amount,
          'consume',
          ctx,
        );
        await tx
          .update(commitments)
          .set({ status: 'consumed', consumedMinor: amount, updatedAt: new Date() })
          .where(eq(commitments.id, claim.commitmentId!));
        await tx
          .update(walletClaims)
          .set({
            status: 'paid',
            paidVia: req.via,
            paidAt: new Date(),
            journalIds: [...claim.journalIds, ...journalIds],
            updatedAt: new Date(),
          })
          .where(eq(walletClaims.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'wallet_claim.paid',
          resourceType: 'wallet_claim',
          resourceId: id,
          legalEntityId: funding.row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: { from: 'approved', to: 'paid' },
            paidVia: { from: null, to: req.via },
            taxable: { from: claim.taxable, to: claim.taxable },
            journalIds: { from: claim.journalIds, to: journalIds },
          },
        });
        return (await this.claimViews(tx, [await this.claimRow(tx, id)]))[0];
      },
    );
  }

  // Internals ------------------------------------------------------------------------------

  /** One balanced commitment movement on the funding budget, with owner threshold alerts. */
  private move(
    tx: Tx,
    actor: RequestActor,
    funding: LockedBudget,
    commitmentId: string,
    amountMinor: number,
    kind: 'pre_encumber' | 'encumber' | 'release_pre_encumbrance' | 'consume',
    ctx: CommandContext,
  ): Promise<string[]> {
    const post: PostCtx = {
      actor,
      command: `wallets.${kind}`,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    };
    return this.posting.context(tx, funding.row, actor.reportingCurrency).then((context) =>
      this.posting.post(
        tx,
        [
          unwrap(
            postCommitmentMovement(
              {
                kind,
                budget: funding,
                amount: { amountMinor, currency: funding.currency },
                provenance: { commitmentId },
              },
              context,
            ),
          ),
        ],
        funding.row.fiscalYearId,
        post,
      ),
    );
  }

  /**
   * The claim amount in the funding budget's currency at the locked plan rate. Control always uses
   * the plan rate, so a wallet balance never moves with the spot market.
   */
  private async toBudgetCurrency(
    tx: Tx,
    funding: { row: { currency: string; fiscalYearId: string } },
    amountMinor: number,
    currency: string,
  ): Promise<number> {
    if (currency === funding.row.currency) return amountMinor;
    const rates = await this.reads.planRates(tx, funding.row.fiscalYearId);
    const rate = unwrap(
      crossRate(
        currency as CurrencyCode,
        funding.row.currency as CurrencyCode,
        funding.row.currency as CurrencyCode,
        rates,
        'plan',
      ),
    );
    const converted = unwrap(convert({ amountMinor, currency: currency as CurrencyCode }, rate));
    if (converted.amountMinor <= 0)
      throw new ApiProblem(
        422,
        'AMOUNT_ROUNDS_TO_ZERO',
        'This amount is worth less than one minor unit of the funding budget\u2019s currency.',
        { field: 'amountMinor' },
      );
    return converted.amountMinor;
  }

  private programRows(tx: Tx, tenantId: string): Promise<ProgramRow[]> {
    return tx
      .select()
      .from(walletPrograms)
      .where(eq(walletPrograms.tenantId, tenantId))
      .orderBy(asc(walletPrograms.name), asc(walletPrograms.id));
  }

  private async programViews(tx: Tx, rows: readonly ProgramRow[]): Promise<WalletProgram[]> {
    if (rows.length === 0) return [];
    const budgetRows = await tx
      .select({
        id: budgets.id,
        name: budgets.name,
        status: budgets.status,
        currency: budgets.currency,
      })
      .from(budgets)
      .where(
        inArray(
          budgets.id,
          rows.map((r) => r.fundingBudgetId),
        ),
      );
    const names = await nameOfPeople(
      tx,
      rows.map((r) => r.reviewerPersonId),
    );
    return rows.map((r) => {
      const budget = budgetRows.find((b) => b.id === r.fundingBudgetId);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        kind: r.kind as 'wellbeing' | 'learning',
        fundingBudgetId: r.fundingBudgetId,
        fundingBudgetName: budget?.name ?? '',
        fundingBudgetStatus: budget?.status ?? 'active',
        yearlyAllowance: {
          amountMinor: Number(r.yearlyAllowanceMinor),
          currency: r.currency,
        },
        fiscalYearId: r.fiscalYearId,
        categories: [...r.categories].sort((a, b) => a.localeCompare(b)),
        eligibleEmploymentTypes:
          r.eligibleEmploymentTypes as WalletProgram['eligibleEmploymentTypes'],
        receiptRequired: r.receiptRequired,
        taxable: r.taxable,
        carryUnused: r.carryUnused,
        reviewerPersonId: r.reviewerPersonId,
        reviewerName: names.get(r.reviewerPersonId ?? '') ?? null,
        active: r.active,
      };
    });
  }

  /**
   * The person's wallet for a programme, created on first sight so the allowance is visible before
   * anyone claims. Creating one moves no money: it records a cap, not a balance.
   */
  private async walletFor(
    tx: Tx,
    tenantId: string,
    program: ProgramRow,
    personId: string,
    create = true,
  ): Promise<WalletRow | null> {
    const [existing] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.tenantId, tenantId),
          eq(wallets.programId, program.id),
          eq(wallets.personId, personId),
          eq(wallets.fiscalYearId, program.fiscalYearId),
        ),
      );
    if (existing) return existing;
    const [person] = await tx
      .select({
        employmentType: people.employmentType,
        startDate: people.startDate,
        endDate: people.endDate,
      })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)));
    if (!person) return null;
    if (!program.eligibleEmploymentTypes.includes(person.employmentType)) return null;
    const [year] = await tx
      .select({ startDate: fiscalYears.startDate, endDate: fiscalYears.endDate })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, program.fiscalYearId));
    const allowance = Number(program.yearlyAllowanceMinor);
    const prorated = this.prorate(allowance, person.startDate, year);
    if (!create) {
      return {
        id: null as unknown as string,
        tenantId,
        programId: program.id,
        personId,
        fiscalYearId: program.fiscalYearId,
        allowanceMinor: allowance,
        proratedAllowanceMinor: prorated,
        currency: program.currency,
        closedAt: person.endDate && person.endDate < todayUtc() ? new Date() : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WalletRow;
    }
    const [created] = await tx
      .insert(wallets)
      .values({
        tenantId,
        programId: program.id,
        personId,
        fiscalYearId: program.fiscalYearId,
        allowanceMinor: allowance,
        proratedAllowanceMinor: prorated,
        currency: program.currency,
        closedAt: person.endDate && person.endDate < todayUtc() ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();
    return created ?? null;
  }

  /** Joiners are prorated by whole months left in the fiscal year when they started. */
  private prorate(
    allowanceMinor: number,
    startDate: string | null,
    year: { startDate: string; endDate: string } | undefined,
  ): number {
    if (!startDate || !year || startDate <= year.startDate) return allowanceMinor;
    if (startDate > year.endDate) return 0;
    const months = (from: string, to: string) => {
      const a = new Date(`${from}T00:00:00Z`);
      const b = new Date(`${to}T00:00:00Z`);
      return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    };
    const total = months(year.startDate, year.endDate) + 1;
    const left = months(startDate, year.endDate) + 1;
    return Math.round((allowanceMinor * Math.max(left, 0)) / Math.max(total, 1));
  }

  private async balance(tx: Tx, wallet: WalletRow, program: ProgramRow): Promise<number> {
    const rows = await tx
      .select({ status: walletClaims.status, budgetAmountMinor: walletClaims.budgetAmountMinor })
      .from(walletClaims)
      .where(
        and(
          eq(walletClaims.tenantId, wallet.tenantId),
          eq(walletClaims.programId, program.id),
          eq(walletClaims.personId, wallet.personId),
        ),
      );
    const consumed = rows
      .filter((r) => CONSUMING_STATUSES.includes(r.status))
      .reduce((s, r) => s + Number(r.budgetAmountMinor), 0);
    return Number(wallet.proratedAllowanceMinor) - consumed;
  }

  /**
   * The caller's wallet in a programme, created on the first claim. Creating the row moves no money:
   * it records the cap and the proration, and the ledger only hears about it when a claim posts.
   */
  private async walletForClaim(
    tx: Tx,
    actor: RequestActor,
    programId: string,
  ): Promise<{ wallet: WalletRow; program: ProgramRow }> {
    const program = (await this.programRows(tx, actor.tenantId)).find((p) => p.id === programId);
    if (!program || !program.active) throw ApiProblem.notFound('wallet program');
    const created = await this.walletFor(tx, actor.tenantId, program, actor.personId!, true);
    if (!created)
      throw new ApiProblem(
        422,
        'WALLET_NOT_ELIGIBLE',
        'Wallets are for employees; this programme does not cover your employment type.',
      );
    return { wallet: created, program };
  }

  private async claimRow(tx: Tx, id: string): Promise<ClaimRow> {
    const [row] = await tx.select().from(walletClaims).where(eq(walletClaims.id, id));
    if (!row) throw ApiProblem.notFound('wallet claim');
    return row;
  }

  private async loadClaim(
    tx: Tx,
    actor: RequestActor,
    id: string,
  ): Promise<{ claim: ClaimRow; program: ProgramRow }> {
    const [row] = await tx
      .select()
      .from(walletClaims)
      .where(and(eq(walletClaims.tenantId, actor.tenantId), eq(walletClaims.id, id)));
    if (!row) throw ApiProblem.notFound('wallet claim');
    const program = (await this.programRows(tx, actor.tenantId)).find(
      (p) => p.id === row.programId,
    );
    if (!program) throw ApiProblem.notFound('wallet program');
    if (row.personId !== actor.personId && !(await this.canReview(tx, actor, program)))
      throw ApiProblem.notFound('wallet claim');
    return { claim: row, program };
  }

  /** The named reviewer for the programme, or anyone finance trusts with the funding budget. */
  private async canReview(tx: Tx, actor: RequestActor, program: ProgramRow): Promise<boolean> {
    if (program.reviewerPersonId && program.reviewerPersonId === actor.personId) return true;
    const budget = await this.views.row(tx, program.fundingBudgetId);
    return this.policy.can(actor, 'budget.allocate', budgetResource(budget)).allowed;
  }

  private async assertDocument(tx: Tx, tenantId: string, documentId: string): Promise<void> {
    const [doc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
    if (!doc) throw ApiProblem.notFound('document');
  }

  private async walletView(tx: Tx, program: ProgramRow, wallet: WalletRow): Promise<Wallet> {
    const [budget] = await tx
      .select({ status: budgets.status })
      .from(budgets)
      .where(eq(budgets.id, program.fundingBudgetId));
    const [year] = await tx
      .select({ endDate: fiscalYears.endDate })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, program.fiscalYearId));
    const balance = await this.balance(tx, wallet, program);
    const money = (amountMinor: number) => ({ amountMinor, currency: wallet.currency });
    return {
      id: wallet.id ?? null,
      programId: program.id,
      programName: program.name,
      programKind: program.kind as 'wellbeing' | 'learning',
      personId: wallet.personId,
      fiscalYearId: wallet.fiscalYearId,
      allowance: money(Number(wallet.allowanceMinor)),
      proratedAllowance: money(Number(wallet.proratedAllowanceMinor)),
      consumed: money(Number(wallet.proratedAllowanceMinor) - balance),
      balance: money(balance),
      categories: [...program.categories].sort((a, b) => a.localeCompare(b)),
      receiptRequired: program.receiptRequired,
      fundingFrozen: budget ? !acceptsNewActivity(budget.status).ok : false,
      lapsesOn: program.carryUnused ? null : (year?.endDate ?? null),
      closed: Boolean(wallet.closedAt),
    };
  }

  private async claimViews(tx: Tx, rows: readonly ClaimRow[]): Promise<WalletClaim[]> {
    if (rows.length === 0) return [];
    const programs = await this.programRows(tx, rows[0].tenantId);
    const names = await nameOfPeople(tx, [
      ...rows.map((r) => r.personId),
      ...rows.map((r) => r.reviewerPersonId),
    ]);
    return rows
      .map((r) => ({
        id: r.id,
        walletId: r.walletId,
        programName: programs.find((p) => p.id === r.programId)?.name ?? '',
        personId: r.personId,
        personName: names.get(r.personId) ?? '',
        category: r.category,
        merchant: r.merchant,
        amount: { amountMinor: Number(r.amountMinor), currency: r.currency },
        budgetAmount: {
          amountMinor: Number(r.budgetAmountMinor),
          currency: r.budgetCurrency,
        },
        claimDate: r.claimDate,
        note: r.note,
        documentId: r.documentId,
        status: r.status as WalletClaimStatus,
        commitmentId: r.commitmentId,
        journalIds: r.journalIds,
        reviewerName: names.get(r.reviewerPersonId ?? '') ?? null,
        decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
        decisionReason: r.decisionReason,
        paidVia: (r.paidVia as 'expense' | 'payroll' | null) ?? null,
        paidAt: r.paidAt ? iso(r.paidAt) : null,
        taxable: r.taxable,
        createdAt: iso(r.createdAt),
      }))
      .sort(
        (a, b) =>
          a.claimDate.localeCompare(b.claimDate) ||
          a.merchant.localeCompare(b.merchant) ||
          a.id.localeCompare(b.id),
      );
  }
}
