import { AiGateway, AiSettingsService, type Fact } from '@bf/api/ai';
import { AuditService } from '@bf/api/audit';
import { BudgetViews, budgetResource } from '@bf/api/budgets';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgets,
  commitments,
  events,
  fiscalPeriods,
  leadershipSummaries,
  requests,
  varianceCommentaries,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type {
  AiSourceRef,
  ApproveSummaryRequest,
  DraftCommentaryRequest,
  DraftSummaryRequest,
  EditSummarySectionRequest,
  LeadershipSummary,
  LeadershipSummaryList,
  Money,
  RegenerateSectionRequest,
  SubmitCommentaryRequest,
  SummaryFigure,
  SummarySection,
  SummarySectionKey,
  SummaryStatus,
  VarianceCommentary,
  VarianceDriver,
} from '@bf/contracts';
import { CONSUMING_BUCKETS, availableOf } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import { iso, nameOfPeople, type CommandContext } from './support';

const SECTION_KEYS: readonly SummarySectionKey[] = [
  'headline',
  'variances',
  'risks',
  'engagement',
] as const;

const SECTION_TITLES: Record<SummarySectionKey, string> = {
  headline: 'Headline',
  variances: 'Variances',
  risks: 'Risks and actions',
  engagement: 'Engagement',
};

const SectionsOutput = z
  .object({
    sections: z
      .array(z.object({ key: z.string().max(40), text: z.string().max(2000) }).strict())
      .max(8),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

const CommentaryOutput = z
  .object({
    text: z.string().max(2000),
    needsExplanation: z.boolean(),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

/** The only places a figure may come from; a token outside this list is treated as invented. */
const FIGURE_TOKEN = /\{\{figure:([a-z_0-9]+)\}\}/g;

interface StoredSection {
  key: SummarySectionKey;
  title: string;
  text: string;
  figures: SummaryFigure[];
  sources: AiSourceRef[];
  edited: boolean;
  reviewed: boolean;
  generatedAt: string | null;
}

/**
 * Auto-drafted leadership summaries and variance commentary (011b).
 *
 * The rule this service exists to keep is simple: the model writes sentences, BudgetFlow writes
 * numbers, and a person decides whether any of it is published.
 *
 * - Every figure is read from a reconciled read model, stored as a `{{figure:<token>}}` reference
 *   with its value and source, and rendered by BudgetFlow. The model only ever receives the figures
 *   and writes prose around the tokens.
 * - Phase 13's figure guard runs on the sentences the model wrote: a literal number that was not in
 *   the retrieved facts discards the whole draft (`AI_OUTPUT_DISCARDED`). On top of it, a token the
 *   draft invents is rejected the same way, because an unknown token renders as nothing.
 * - A draft is never published. It sits as `ai_draft` until its author has opened every section and
 *   approved it, and an open period can never be approved at all.
 */
@Injectable()
export class NarrativesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: LedgerReads,
    private readonly views: BudgetViews,
    private readonly gateway: AiGateway,
    private readonly settings: AiSettingsService,
  ) {}

  // Leadership summaries -----------------------------------------------------------------

  list(actor: RequestActor, query: { status?: SummaryStatus }): Promise<LeadershipSummaryList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.assertReader(actor);
      const rows = await tx
        .select()
        .from(leadershipSummaries)
        .where(
          and(
            eq(leadershipSummaries.tenantId, actor.tenantId),
            query.status ? eq(leadershipSummaries.status, query.status) : undefined,
          ),
        )
        .orderBy(desc(leadershipSummaries.createdAt), asc(leadershipSummaries.id));
      const items: LeadershipSummary[] = [];
      for (const row of rows) items.push(await this.summaryView(tx, row));
      return { items };
    });
  }

  get(actor: RequestActor, id: string): Promise<LeadershipSummary> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) =>
      this.summaryView(tx, await this.loadSummary(tx, actor, id)),
    );
  }

  draft(actor: RequestActor, req: DraftSummaryRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'insights.draftSummary',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.assertAuthor(actor);
        await this.settings.assertEnabled(tx, actor.tenantId, 'leadership_summary');
        const period = await this.period(tx, actor.tenantId, req.periodId);
        const closed = period.status === 'closed' || period.status === 'locked';
        if (!closed && !req.allowOpenPeriod)
          throw new ApiProblem(
            422,
            'SUMMARY_PERIOD_NOT_CLOSED',
            'This period is still open. Draft it as an open-period draft if you need it now; it cannot be approved.',
          );
        const facts = await this.summaryFacts(tx, actor, period);
        const result = await this.gateway.run({
          tx,
          actor,
          feature: 'leadership_summary',
          channel: 'web',
          task: 'summary_sections',
          facts: facts.facts,
          sources: facts.sources,
          scope: {
            action: 'report.read',
            scope: 'tenant',
            consideredCount: facts.facts.length,
            permittedCount: facts.facts.length,
          },
          schema: SectionsOutput,
          successOutcome: 'suggested',
          narrative: (out) => out.sections.map((s) => s.text),
        });
        if (!result.output) throw this.discarded(result.outcome, result.untraceable);
        const sections = this.buildSections(result.output.sections, facts);
        const [row] = await tx
          .insert(leadershipSummaries)
          .values({
            tenantId: actor.tenantId,
            periodId: period.id,
            periodState: closed ? 'closed' : 'open',
            snapshotTakenAt: closed ? (period.closedAt ?? new Date()) : null,
            status: 'ai_draft',
            sections: sections as unknown as object,
            authorPersonId: actor.personId,
            queryLogId: result.queryLogId,
            modelId: this.gateway.modelId,
            modelVersion: this.gateway.modelVersion,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'leadership_summary.drafted',
          resourceType: 'leadership_summary',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: `Drafted from the ${closed ? 'closed' : 'open'} period ${period.label}`,
          changes: {
            status: { from: null, to: 'ai_draft' },
            periodState: { from: null, to: closed ? 'closed' : 'open' },
            queryLogId: { from: null, to: result.queryLogId },
            published: { from: false, to: false },
          },
        });
        return this.summaryView(tx, row);
      },
    );
  }

  editSection(
    actor: RequestActor,
    id: string,
    key: SummarySectionKey,
    req: EditSummarySectionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `insights.editSummarySection:${id}:${key}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const row = await this.loadSummary(tx, actor, id);
        this.assertDraft(row);
        const sections = this.storedSections(row).map((s) =>
          s.key === key
            ? {
                ...s,
                text: req.text,
                edited: true,
                reviewed: req.markReviewed ? true : s.reviewed,
              }
            : s,
        );
        if (!sections.some((s) => s.key === key)) throw ApiProblem.notFound('summary section');
        await tx
          .update(leadershipSummaries)
          .set({
            sections: sections as unknown as object,
            status: 'edited',
            updatedAt: new Date(),
          })
          .where(eq(leadershipSummaries.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'leadership_summary.edited',
          resourceType: 'leadership_summary',
          resourceId: id,
          requestId: ctx.requestId,
          reason: `Section ${key} rewritten by the author`,
          changes: { section: { from: key, to: key }, status: { from: row.status, to: 'edited' } },
        });
        return this.summaryView(tx, await this.loadSummary(tx, actor, id));
      },
    );
  }

  regenerate(
    actor: RequestActor,
    id: string,
    key: SummarySectionKey,
    req: RegenerateSectionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `insights.regenerateSummarySection:${id}:${key}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.loadSummary(tx, actor, id);
        this.assertDraft(row);
        await this.settings.assertEnabled(tx, actor.tenantId, 'leadership_summary');
        const period = await this.period(tx, actor.tenantId, row.periodId);
        const facts = await this.summaryFacts(tx, actor, period);
        const result = await this.gateway.run({
          tx,
          actor,
          feature: 'leadership_summary',
          channel: 'web',
          task: 'summary_sections',
          facts: facts.facts,
          sources: facts.sources,
          scope: {
            action: 'report.read',
            scope: 'tenant',
            consideredCount: facts.facts.length,
            permittedCount: facts.facts.length,
          },
          schema: SectionsOutput,
          successOutcome: 'suggested',
          narrative: (out) => out.sections.map((s) => s.text),
        });
        if (!result.output) throw this.discarded(result.outcome, result.untraceable);
        const fresh = this.buildSections(result.output.sections, facts).find((s) => s.key === key);
        if (!fresh) throw ApiProblem.notFound('summary section');
        // Regenerating replaces the author's edits in this section and takes its review with them:
        // nobody approves text they have not read since it last changed.
        const sections = this.storedSections(row).map((s) =>
          s.key === key ? { ...fresh, reviewed: false, edited: false } : s,
        );
        await tx
          .update(leadershipSummaries)
          .set({
            sections: sections as unknown as object,
            queryLogId: result.queryLogId,
            updatedAt: new Date(),
          })
          .where(eq(leadershipSummaries.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'leadership_summary.regenerated',
          resourceType: 'leadership_summary',
          resourceId: id,
          requestId: ctx.requestId,
          reason: req.reason ?? `Section ${key} redrafted`,
          changes: {
            section: { from: key, to: key },
            reviewed: { from: true, to: false },
            queryLogId: { from: row.queryLogId, to: result.queryLogId },
          },
        });
        return this.summaryView(tx, await this.loadSummary(tx, actor, id));
      },
    );
  }

  approve(actor: RequestActor, id: string, req: ApproveSummaryRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `insights.approveSummary:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.loadSummary(tx, actor, id);
        this.assertAuthor(actor);
        if (row.status === 'approved')
          throw new ApiProblem(
            409,
            'SUMMARY_ALREADY_APPROVED',
            'This summary is approved and immutable. Create a new version to change it.',
          );
        if (row.periodState !== 'closed')
          throw new ApiProblem(
            422,
            'SUMMARY_PERIOD_NOT_CLOSED',
            'An open-period draft cannot be approved: its figures can still move. Close the period first.',
          );
        const sections = this.storedSections(row);
        const unread = sections.filter((s) => !s.reviewed).map((s) => s.key);
        if (unread.length)
          throw new ApiProblem(
            422,
            'SUMMARY_SECTION_UNREVIEWED',
            `Read every section before approving: ${unread.join(', ')} ${unread.length === 1 ? 'is' : 'are'} still unread.`,
            { sections: unread.join(',') },
          );
        await tx
          .update(leadershipSummaries)
          .set({
            status: 'approved',
            approvedByPersonId: actor.personId,
            approvedAt: new Date(),
            approvalNote: req.note ?? null,
            updatedAt: new Date(),
          })
          .where(eq(leadershipSummaries.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'leadership_summary.approved',
          resourceType: 'leadership_summary',
          resourceId: id,
          requestId: ctx.requestId,
          reason: req.note ?? 'Summary approved after review',
          changes: {
            status: { from: row.status, to: 'approved' },
            modelId: { from: null, to: row.modelId },
            modelVersion: { from: null, to: row.modelVersion },
            queryLogId: { from: null, to: row.queryLogId },
          },
        });
        return this.summaryView(tx, await this.loadSummary(tx, actor, id));
      },
    );
  }

  // Variance commentary ------------------------------------------------------------------

  draftCommentary(actor: RequestActor, req: DraftCommentaryRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'insights.draftCommentary',
        request: req,
        status: 201,
      },
      async (tx) => {
        const budget = await this.views.row(tx, req.budgetId);
        this.policy.assert(actor, 'forecast.submit', budgetResource(budget), 'budget');
        await this.settings.assertEnabled(tx, actor.tenantId, 'variance_commentary');
        const drivers = await this.varianceDrivers(tx, budget.id, budget.currency);
        const balances = (await this.reads.balances(tx, [budget.id])).get(budget.id)!.budget;
        const forecastMinor = balances.actual + balances.encumbered + balances.pre_encumbered;
        const varianceMinor = forecastMinor - balances.authorized;
        const explained = drivers.reduce((s, d) => s + d.amount.amountMinor, 0);
        const unexplainedMinor = Math.max(Math.abs(varianceMinor) - explained, 0);
        const facts: Fact[] = [
          {
            type: 'budget',
            id: budget.id,
            label: budget.name,
            fields: {
              budgetName: budget.name,
              currency: budget.currency,
              status: budget.status,
              authorizedMinor: balances.authorized,
              forecastMinor,
              varianceMinor,
              unexplainedMinor,
            },
          },
          ...drivers.map<Fact>((d, i) => ({
            type: 'driver',
            id: d.source.id,
            label: d.label,
            fields: {
              driverLabel: d.label,
              driverAmountMinor: d.amount.amountMinor,
              currency: d.amount.currency,
              reference: `driver_${i}`,
            },
          })),
        ];
        const sources: AiSourceRef[] = [
          { type: 'budget', id: budget.id, label: budget.name },
          ...drivers.map((d) => d.source),
        ];
        const result = await this.gateway.run({
          tx,
          actor,
          feature: 'variance_commentary',
          channel: 'web',
          task: 'variance_commentary',
          facts,
          sources,
          scope: {
            action: 'forecast.submit',
            scope: 'owned',
            consideredCount: facts.length,
            permittedCount: facts.length,
          },
          schema: CommentaryOutput,
          successOutcome: 'suggested',
          narrative: (out) => [out.text],
        });
        if (!result.output) throw this.discarded(result.outcome, result.untraceable);
        const allowed = new Map(drivers.map((d, i) => [`driver_${i}`, d.amount]));
        let text = this.renderFigures(result.output.text, allowed);
        if (unexplainedMinor > 0)
          // Nothing in BudgetFlow explains this part, so the draft says so in the owner's words'
          // place rather than guessing a reason. Submission is blocked until they replace it.
          text += ` [Explain: no driver found for ${(unexplainedMinor / 100).toFixed(2)} ${budget.currency}]`;
        const [row] = await tx
          .insert(varianceCommentaries)
          .values({
            tenantId: actor.tenantId,
            budgetId: budget.id,
            forecastSnapshotId: req.forecastSnapshotId ?? null,
            status: 'draft',
            text,
            drivers: drivers as unknown as object,
            unexplainedMinor,
            currency: budget.currency,
            draftedWithAi: true,
            authorPersonId: actor.personId,
            queryLogId: result.queryLogId,
            modelId: this.gateway.modelId,
            modelVersion: this.gateway.modelVersion,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'variance_commentary.drafted',
          resourceType: 'variance_commentary',
          resourceId: row.id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: `Commentary drafted for ${budget.name}`,
          changes: {
            budgetId: { from: null, to: budget.id },
            drivers: { from: null, to: drivers.length },
            unexplainedMinor: { from: null, to: unexplainedMinor },
            submitted: { from: false, to: false },
          },
        });
        return this.commentaryView(tx, row);
      },
    );
  }

  submitCommentary(
    actor: RequestActor,
    id: string,
    req: SubmitCommentaryRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `insights.submitCommentary:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(varianceCommentaries)
          .where(
            and(eq(varianceCommentaries.tenantId, actor.tenantId), eq(varianceCommentaries.id, id)),
          );
        if (!row) throw ApiProblem.notFound('variance commentary');
        const budget = await this.views.row(tx, row.budgetId);
        this.policy.assert(actor, 'forecast.submit', budgetResource(budget), 'budget');
        if (row.status === 'submitted')
          throw new ApiProblem(
            409,
            'COMMENTARY_ALREADY_SUBMITTED',
            'This commentary has already been submitted.',
          );
        if (/\[Explain:/i.test(req.text))
          throw new ApiProblem(
            422,
            'COMMENTARY_PLACEHOLDER_PRESENT',
            'Replace the [Explain] note with your own explanation before submitting.',
            { field: 'text' },
          );
        await tx
          .update(varianceCommentaries)
          .set({
            text: req.text,
            status: 'submitted',
            attested: req.attested,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(varianceCommentaries.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'variance_commentary.submitted',
          resourceType: 'variance_commentary',
          resourceId: id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: 'Owner submitted their variance commentary',
          changes: {
            status: { from: row.status, to: 'submitted' },
            attested: { from: false, to: true },
            draftedWithAi: { from: row.draftedWithAi, to: row.draftedWithAi },
            suggestionId: { from: null, to: row.queryLogId },
          },
        });
        return this.commentaryView(
          tx,
          (await tx.select().from(varianceCommentaries).where(eq(varianceCommentaries.id, id)))[0],
        );
      },
    );
  }

  // Internals --------------------------------------------------------------------------

  private discarded(outcome: string, untraceable: readonly string[]): ApiProblem {
    if (outcome === 'failed')
      return new ApiProblem(
        503,
        'AI_UNAVAILABLE',
        'The drafting service is unavailable. Write the text yourself, or try again later.',
      );
    return new ApiProblem(
      409,
      'AI_OUTPUT_DISCARDED',
      untraceable.length
        ? `The draft was discarded: it contained ${untraceable.length === 1 ? 'a figure' : 'figures'} BudgetFlow did not produce (${untraceable.join(', ')}).`
        : 'The draft was discarded because it did not meet BudgetFlow\u2019s checks.',
    );
  }

  private assertReader(actor: RequestActor): void {
    this.policy.assert(
      actor,
      'report.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'leadership summary',
    );
  }

  /** Drafting and approving a company narrative is company-level work, like the board pack. */
  private assertAuthor(actor: RequestActor): void {
    this.assertReader(actor);
    if (!this.policy.can(actor, 'audit.read', { kind: 'tenant', tenantId: actor.tenantId }).allowed)
      throw ApiProblem.forbidden(
        'Only leadership and finance draft and approve the company summary; an analyst reads approved ones.',
      );
  }

  private assertDraft(row: typeof leadershipSummaries.$inferSelect): void {
    if (row.status === 'approved')
      throw new ApiProblem(
        409,
        'SUMMARY_ALREADY_APPROVED',
        'An approved summary is immutable. Create a new version to change it.',
      );
  }

  private async loadSummary(
    tx: Tx,
    actor: RequestActor,
    id: string,
  ): Promise<typeof leadershipSummaries.$inferSelect> {
    this.assertReader(actor);
    const [row] = await tx
      .select()
      .from(leadershipSummaries)
      .where(and(eq(leadershipSummaries.tenantId, actor.tenantId), eq(leadershipSummaries.id, id)));
    if (!row) throw ApiProblem.notFound('leadership summary');
    return row;
  }

  private async period(
    tx: Tx,
    tenantId: string,
    periodId: string,
  ): Promise<{
    id: string;
    label: string;
    status: string;
    closedAt: Date | null;
    startDate: string;
    endDate: string;
  }> {
    const [row] = await tx
      .select()
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.tenantId, tenantId), eq(fiscalPeriods.id, periodId)));
    if (!row) throw ApiProblem.notFound('accounting period');
    return {
      id: row.id,
      label: row.label ?? row.startDate,
      status: row.status,
      closedAt: row.statusChangedAt ?? null,
      startDate: row.startDate,
      endDate: row.endDate,
    };
  }

  /**
   * The figures a summary may quote, read from the ledger read models. They go to the model as facts
   * *and* stay on the draft as data references, which is what makes every number traceable.
   */
  private async summaryFacts(
    tx: Tx,
    actor: RequestActor,
    period: { id: string; label: string; startDate: string; endDate: string },
  ): Promise<{ facts: Fact[]; sources: AiSourceRef[]; figures: Map<string, SummaryFigure> }> {
    const roots = await tx
      .select({
        id: budgets.id,
        name: budgets.name,
        path: budgets.path,
        currency: budgets.currency,
      })
      .from(budgets)
      .where(and(eq(budgets.tenantId, actor.tenantId), eq(budgets.depth, 0)))
      .orderBy(asc(budgets.name), asc(budgets.id));
    const ids: string[] = [];
    for (const root of roots) {
      const subtree = await tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.tenantId, actor.tenantId), like(budgets.path, `${root.path}%`)));
      ids.push(...subtree.map((s) => s.id));
    }
    const balances = await this.reads.balances(tx, [...new Set(ids)]);
    const currency = actor.reportingCurrency;
    let authorized = 0;
    let actual = 0;
    let encumbered = 0;
    let available = 0;
    for (const pair of balances.values()) {
      authorized += pair.reporting.authorized;
      actual += pair.reporting.actual;
      encumbered += pair.reporting.encumbered;
      available += availableOf(pair.reporting, CONSUMING_BUCKETS);
    }
    // The phased plan for the period is what the budgets were authorized to spend by now; the ledger
    // read model is the only place either number comes from.
    const plan = authorized;
    const utilizationBps = plan > 0 ? Math.round(((actual + encumbered) / plan) * 10_000) : 0;
    const regions = await tx
      .select({ id: budgets.id, name: budgets.name, currency: budgets.currency })
      .from(budgets)
      .where(and(eq(budgets.tenantId, actor.tenantId), eq(budgets.depth, 1)))
      .orderBy(asc(budgets.name), asc(budgets.id));
    const regionBalances = await this.reads.balances(
      tx,
      regions.map((r) => r.id),
    );
    const largest = regions
      .map((r) => {
        const b = regionBalances.get(r.id)!.reporting;
        return {
          region: r,
          variance: b.actual + b.encumbered - b.authorized,
          committed: b.encumbered,
        };
      })
      .sort(
        (a, b) =>
          Math.abs(b.variance) - Math.abs(a.variance) || a.region.name.localeCompare(b.region.name),
      )[0];
    const unusedBudgets = regions.filter((r) => {
      const b = regionBalances.get(r.id)!.reporting;
      return availableOf(b, CONSUMING_BUCKETS) > 0;
    });
    const unusedMinor = unusedBudgets.reduce(
      (s, r) => s + availableOf(regionBalances.get(r.id)!.reporting, CONSUMING_BUCKETS),
      0,
    );
    const money = (amountMinor: number): Money => ({ amountMinor, currency });
    const periodSource: AiSourceRef = {
      type: 'period_snapshot',
      id: period.id,
      label: `${period.label} close snapshot`,
    };
    const figures = new Map<string, SummaryFigure>([
      [
        'period_actual',
        {
          token: 'period_actual',
          label: `${period.label} spend`,
          value: money(actual),
          numericValue: null,
          unit: 'money',
          source: periodSource,
        },
      ],
      [
        'period_plan',
        {
          token: 'period_plan',
          label: `${period.label} phased plan`,
          value: money(plan),
          numericValue: null,
          unit: 'money',
          source: periodSource,
        },
      ],
      [
        'ytd_utilization',
        {
          token: 'ytd_utilization',
          label: 'Year-to-date utilization',
          value: null,
          numericValue: utilizationBps,
          unit: 'percent_bps',
          source: periodSource,
        },
      ],
      [
        'company_available',
        {
          token: 'company_available',
          label: 'Company-wide Available',
          value: money(available),
          numericValue: null,
          unit: 'money',
          source: periodSource,
        },
      ],
    ]);
    const facts: Fact[] = [
      {
        type: 'period',
        id: period.id,
        label: `${period.label} close snapshot`,
        fields: {
          periodLabel: period.label,
          currency,
          authorizedMinor: authorized,
          actualMinor: actual,
          plannedMinor: plan,
          availableMinor: available,
          encumberedMinor: encumbered,
          utilizationBps,
        },
      },
    ];
    const sources: AiSourceRef[] = [periodSource];
    if (largest && largest.variance !== 0) {
      figures.set('largest_variance', {
        token: 'largest_variance',
        label: `${largest.region.name} variance against plan`,
        value: money(largest.variance),
        numericValue: null,
        unit: 'money',
        source: { type: 'budget', id: largest.region.id, label: largest.region.name },
      });
      figures.set('largest_variance_committed', {
        token: 'largest_variance_committed',
        label: `${largest.region.name} committed`,
        value: money(largest.committed),
        numericValue: null,
        unit: 'money',
        source: { type: 'budget', id: largest.region.id, label: largest.region.name },
      });
      facts.push({
        type: 'region',
        id: largest.region.id,
        label: largest.region.name,
        fields: {
          regionName: largest.region.name,
          currency,
          varianceMinor: largest.variance,
          encumberedMinor: largest.committed,
        },
      });
      sources.push({ type: 'budget', id: largest.region.id, label: largest.region.name });
    }
    if (unusedBudgets.length > 0) {
      figures.set('at_risk_budgets', {
        token: 'at_risk_budgets',
        label: 'Budgets likely to leave money unused',
        value: null,
        numericValue: unusedBudgets.length,
        unit: 'count',
        source: periodSource,
      });
      figures.set('at_risk_unused', {
        token: 'at_risk_unused',
        label: 'Likely unused by year end',
        value: money(unusedMinor),
        numericValue: null,
        unit: 'money',
        source: periodSource,
      });
      facts.push({
        type: 'risk',
        id: period.id,
        label: 'Likely unused budget',
        fields: { currency, unusedMinor, budgetsAtRisk: unusedBudgets.length },
      });
    }
    return { facts, sources, figures };
  }

  /**
   * Accepts the model's sentences only when every figure token in them is one BudgetFlow produced.
   * An unknown token would render as nothing, which is how an invented figure sneaks past a reader.
   */
  private buildSections(
    written: readonly { key: string; text: string }[],
    facts: { figures: Map<string, SummaryFigure>; sources: AiSourceRef[] },
  ): StoredSection[] {
    const now = iso(new Date());
    return SECTION_KEYS.map((key) => {
      const text = written.find((w) => w.key === key)?.text ?? '';
      const tokens = [...text.matchAll(FIGURE_TOKEN)].map((m) => m[1]);
      const unknown = tokens.filter((t) => !facts.figures.has(t));
      if (unknown.length)
        throw new ApiProblem(
          409,
          'AI_OUTPUT_DISCARDED',
          `The draft was discarded: it referred to figures BudgetFlow did not produce (${unknown.join(', ')}).`,
        );
      return {
        key,
        title: SECTION_TITLES[key],
        text,
        figures: tokens.map((t) => facts.figures.get(t)!),
        sources: facts.sources,
        edited: false,
        reviewed: false,
        generatedAt: now,
      };
    });
  }

  /** Replaces `{{figure:n}}` with the stored value, so the owner reads real money, not a token. */
  private renderFigures(text: string, values: Map<string, Money>): string {
    return text.replace(FIGURE_TOKEN, (match, token: string) => {
      const value = values.get(token);
      if (!value) return match;
      return `${value.currency} ${(value.amountMinor / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    });
  }

  /** The real records behind a variance: open commitments and pending requests, largest first. */
  private async varianceDrivers(
    tx: Tx,
    budgetId: string,
    currency: string,
  ): Promise<VarianceDriver[]> {
    const open = await tx
      .select({
        id: commitments.id,
        description: commitments.description,
        amountMinor: commitments.amountMinor,
        eventName: events.name,
        eventId: events.id,
      })
      .from(commitments)
      .leftJoin(events, eq(events.id, commitments.eventId))
      .where(
        and(
          eq(commitments.budgetId, budgetId),
          inArray(commitments.status, ['encumbered', 'partially_consumed', 'consumed']),
        ),
      );
    const pending = await tx
      .select({
        id: requests.id,
        purpose: requests.purpose,
        amountMinor: requests.amountMinor,
        ref: requests.ref,
      })
      .from(requests)
      .where(and(eq(requests.budgetId, budgetId), eq(requests.status, 'pending_approval')));
    const drivers: VarianceDriver[] = [
      ...open.map<VarianceDriver>((c) => ({
        label: c.eventName ?? c.description,
        amount: { amountMinor: Number(c.amountMinor), currency },
        source: c.eventId
          ? { type: 'event', id: c.eventId, label: c.eventName ?? c.description }
          : { type: 'commitment', id: c.id, label: c.description },
      })),
      ...pending.map<VarianceDriver>((r) => ({
        label: r.purpose,
        amount: { amountMinor: Number(r.amountMinor), currency },
        source: { type: 'request', id: r.id, label: r.ref ?? r.purpose },
      })),
    ];
    return drivers
      .sort(
        (a, b) =>
          b.amount.amountMinor - a.amount.amountMinor ||
          a.label.localeCompare(b.label) ||
          a.source.id.localeCompare(b.source.id),
      )
      .slice(0, 5);
  }

  private storedSections(row: typeof leadershipSummaries.$inferSelect): StoredSection[] {
    return (row.sections as StoredSection[]) ?? [];
  }

  private async summaryView(
    tx: Tx,
    row: typeof leadershipSummaries.$inferSelect,
  ): Promise<LeadershipSummary> {
    const names = await nameOfPeople(tx, [row.authorPersonId, row.approvedByPersonId]);
    const [period] = await tx
      .select({ label: fiscalPeriods.label, startDate: fiscalPeriods.startDate })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, row.periodId));
    return {
      id: row.id,
      periodId: row.periodId,
      periodLabel: period?.label ?? period?.startDate ?? '',
      periodState: row.periodState as 'closed' | 'open',
      snapshotTakenAt: row.snapshotTakenAt ? iso(row.snapshotTakenAt) : null,
      status: row.status as SummaryStatus,
      version: row.version,
      authorName: names.get(row.authorPersonId ?? '') ?? null,
      approvedByName: names.get(row.approvedByPersonId ?? '') ?? null,
      approvedAt: row.approvedAt ? iso(row.approvedAt) : null,
      sections: this.storedSections(row) as SummarySection[],
      provenance: row.queryLogId
        ? {
            suggestionId: row.suggestionId,
            queryLogId: row.queryLogId,
            provider: this.gateway.providerId,
            modelId: row.modelId ?? this.gateway.modelId,
            modelVersion: row.modelVersion ?? this.gateway.modelVersion,
            generatedAt: iso(row.createdAt),
            latencyMs: 0,
          }
        : null,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private async commentaryView(
    tx: Tx,
    row: typeof varianceCommentaries.$inferSelect,
  ): Promise<VarianceCommentary> {
    const names = await nameOfPeople(tx, [row.authorPersonId]);
    const [budget] = await tx
      .select({ name: budgets.name })
      .from(budgets)
      .where(eq(budgets.id, row.budgetId));
    return {
      id: row.id,
      budgetId: row.budgetId,
      budgetName: budget?.name ?? '',
      forecastSnapshotId: row.forecastSnapshotId,
      status: row.status as 'draft' | 'submitted',
      text: row.text,
      drivers: (row.drivers as VarianceDriver[]) ?? [],
      unexplained:
        row.unexplainedMinor === null || row.unexplainedMinor === 0
          ? null
          : { amountMinor: Number(row.unexplainedMinor), currency: row.currency ?? 'USD' },
      hasPlaceholder: /\[Explain:/i.test(row.text),
      draftedWithAi: row.draftedWithAi,
      attested: row.attested,
      provenance: row.queryLogId
        ? {
            suggestionId: row.suggestionId,
            queryLogId: row.queryLogId,
            provider: this.gateway.providerId,
            modelId: row.modelId ?? this.gateway.modelId,
            modelVersion: row.modelVersion ?? this.gateway.modelVersion,
            generatedAt: iso(row.createdAt),
            latencyMs: 0,
          }
        : null,
      authorName: names.get(row.authorPersonId ?? '') ?? null,
      submittedAt: row.submittedAt ? iso(row.submittedAt) : null,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}
