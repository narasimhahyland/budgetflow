import { ApiProblem, unwrap, type CommandResult, type RequestActor } from '@bf/api/core';
import { eventQuoteRequests, eventQuotes, vendors, type Tx } from '@bf/api/db';
import { CommitmentsService, FundingSourcesService, PostingSupport } from '@bf/api/spend';
import type {
  CreateQuoteRequestBody,
  EventQuoteRequestView,
  EventQuotesView,
  RecordVendorQuoteBody,
  SelectVendorQuoteBody,
  VendorQuoteItem,
} from '@bf/contracts';
import { buildTriplet, validateQuoteSelection, type CurrencyCode } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Ctx, EventRow } from '../events.service';
import { EventDepthSupport } from './event-depth.support';
import { EventPlanService } from './event-plan.service';

type QuoteRow = typeof eventQuotes.$inferSelect;
type RequestRow = typeof eventQuoteRequests.$inferSelect;
type VendorStatus = VendorQuoteItem['vendorStatus'];

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Vendor quote requests and the side-by-side comparison (51a). Quotes never consume budget; only
 * selecting one creates the event commitment, within what the event's rules leave available and only
 * for a vendor the vendor master lists as Approved or Preferred.
 */
@Injectable()
export class EventQuotesService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly sources: FundingSourcesService,
    private readonly commitments: CommitmentsService,
    private readonly posting: PostingSupport,
    private readonly plan: EventPlanService,
  ) {}

  private async availableMinor(
    tx: Tx,
    e: EventRow,
  ): Promise<{
    funding: Awaited<ReturnType<EventDepthSupport['events']['funding']>>;
    available: number;
  }> {
    const funding = await this.support.events.funding(tx, e);
    return { funding, available: Math.max(funding.capMinor - funding.committedMinor, 0) };
  }

  private quoteView(
    q: QuoteRow,
    vendor: { name: string; status: string } | undefined,
    request: RequestRow,
    availableMinor: number,
    perHeadLimitMinor: number | null,
    lowestMinor: number | null,
  ): VendorQuoteItem {
    const expired = q.validUntil !== null && q.validUntil < todayIso();
    const exceeds = Math.max(0, q.budgetAmountMinor - availableMinor);
    const aboveLimit =
      perHeadLimitMinor !== null && q.perHeadMinor > 0 && q.perHeadMinor > perHeadLimitMinor;
    const policyCheck: VendorQuoteItem['policyCheck'] =
      exceeds > 0 ? 'above_available' : aboveLimit ? 'above_limit' : 'within_limit';
    return {
      id: q.id,
      quoteRequestId: q.quoteRequestId,
      vendorId: q.vendorId,
      vendorName: vendor?.name ?? 'Unknown vendor',
      vendorStatus: (vendor?.status ?? 'unknown') as VendorStatus,
      status: (expired && q.status === 'received'
        ? 'expired'
        : q.status) as VendorQuoteItem['status'],
      amount: { amountMinor: q.amountMinor, currency: q.currency },
      budgetAmount: { amountMinor: q.budgetAmountMinor, currency: q.budgetCurrency },
      perHead: { amountMinor: q.perHeadMinor, currency: q.budgetCurrency },
      depositPct: q.depositPct,
      deposit: { amountMinor: q.depositMinor, currency: q.currency },
      depositRefundable: q.depositRefundable,
      depositTerms: q.depositTerms,
      cancellationTerms: q.cancellationTerms,
      validUntil: q.validUntil,
      expired,
      includesText: q.includesText,
      isLowest:
        lowestMinor !== null && q.budgetAmountMinor === lowestMinor && q.status !== 'requested',
      exceedsAvailableByMinor: exceeds,
      policyCheck,
      policyMessage:
        policyCheck === 'above_available'
          ? `Exceeds what is available under this event's rules by ${exceeds} ${q.budgetCurrency} minor units.`
          : policyCheck === 'above_limit'
            ? 'Above the per-head limit for this event.'
            : `Within the per-head limit for ${request.quantity} people.`,
      documentId: q.documentId,
      commitmentId: q.commitmentId,
      selectionReason: q.selectionReason,
    };
  }

  async view(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventQuotesView> {
    const canManage = await this.support.canManage(tx, actor, e);
    const requests = await tx
      .select()
      .from(eventQuoteRequests)
      .where(eq(eventQuoteRequests.eventId, e.id))
      .orderBy(asc(eventQuoteRequests.createdAt));
    const quotes = await tx
      .select()
      .from(eventQuotes)
      .where(eq(eventQuotes.eventId, e.id))
      .orderBy(asc(eventQuotes.createdAt));
    const vendorRows = quotes.length
      ? await tx
          .select({ id: vendors.id, name: vendors.name, status: vendors.status })
          .from(vendors)
          .where(inArray(vendors.id, [...new Set(quotes.map((q) => q.vendorId))]))
      : [];
    const { funding, available } = await this.availableMinor(tx, e);
    const views: EventQuoteRequestView[] = requests.map((r) => {
      const mine = quotes.filter((q) => q.quoteRequestId === r.id);
      const received = mine.filter((q) => q.status !== 'requested');
      const lowest = received.length ? Math.min(...received.map((q) => q.budgetAmountMinor)) : null;
      return {
        id: r.id,
        eventId: e.id,
        title: r.title,
        category: r.category,
        description: r.description,
        quantity: r.quantity,
        neededBy: r.neededBy,
        respondBy: r.respondBy,
        includeDietaryCounts: r.includeDietaryCounts,
        emailed: r.emailed,
        receivedCount: received.length,
        totalCount: mine.length,
        quotes: mine.map((q) =>
          this.quoteView(
            q,
            vendorRows.find((v) => v.id === q.vendorId),
            r,
            available,
            e.perHeadLimitMinor,
            lowest,
          ),
        ),
      };
    });
    const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
    return {
      eventId: e.id,
      canManage,
      funded: m(funding.ownFundsMinor + funding.contributionsMinor),
      committed: m(funding.committedMinor),
      available: m(available),
      perHeadLimit: e.perHeadLimitMinor !== null ? m(e.perHeadLimitMinor) : null,
      requests: views,
    };
  }

  get(actor: RequestActor, eventId: string): Promise<EventQuotesView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.view(tx, actor, e);
    });
  }

  createRequest(
    actor: RequestActor,
    eventId: string,
    body: CreateQuoteRequestBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventQuotesView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.quotes.request:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'Quote requests');
        const chosen = await tx
          .select({ id: vendors.id, name: vendors.name, status: vendors.status })
          .from(vendors)
          .where(inArray(vendors.id, body.vendorIds));
        if (chosen.length !== new Set(body.vendorIds).size)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'A vendor does not exist.', {
            field: 'vendorIds',
          });
        const blocked = chosen.find((v) => v.status === 'blocked');
        if (blocked)
          throw new ApiProblem(
            409,
            'VENDOR_BLOCKED',
            `${blocked.name} is blocked by vendor controls and cannot be asked for a quote.`,
            { vendorId: blocked.id },
          );
        const [request] = await tx
          .insert(eventQuoteRequests)
          .values({
            tenantId: actor.tenantId,
            eventId: e.id,
            title: body.title,
            category: body.category,
            description: body.description ?? null,
            quantity: body.quantity,
            neededBy: body.neededBy ?? null,
            respondBy: body.respondBy ?? null,
            includeDietaryCounts: body.includeDietaryCounts,
            emailed: body.emailed,
            createdByPersonId: actor.personId,
          })
          .returning();
        await tx.insert(eventQuotes).values(
          chosen.map((v) => ({
            tenantId: actor.tenantId,
            eventId: e.id,
            quoteRequestId: request.id,
            vendorId: v.id,
            status: 'requested',
            currency: e.currency,
            budgetCurrency: e.currency,
          })),
        );
        await this.support.log(tx, actor, e, 'event.quote_request_created', ctx, {
          quoteRequestId: { from: null, to: request.id },
          title: { from: null, to: request.title },
          vendors: { from: null, to: chosen.map((v) => v.name) },
          emailed: { from: null, to: body.emailed },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  recordQuote(
    actor: RequestActor,
    eventId: string,
    body: RecordVendorQuoteBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventQuotesView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.quotes.record:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'Quotes');
        const [request] = await tx
          .select()
          .from(eventQuoteRequests)
          .where(
            and(
              eq(eventQuoteRequests.id, body.quoteRequestId),
              eq(eventQuoteRequests.eventId, e.id),
            ),
          );
        if (!request) throw ApiProblem.notFound('quote request');
        const [vendor] = await tx
          .select({ id: vendors.id, name: vendors.name, status: vendors.status })
          .from(vendors)
          .where(eq(vendors.id, body.vendorId));
        if (!vendor) throw ApiProblem.notFound('vendor');
        const home = await this.posting.budget(tx, e.budgetId!);
        if (!home) throw ApiProblem.notFound('budget');
        const rates = await this.posting.reads.planRates(tx, home.fiscalYearId);
        // The budget amount is locked at the fiscal year's plan rate: FX never consumes budget.
        const triplet = unwrap(
          buildTriplet(
            {
              amountMinor: body.amount.amountMinor,
              currency: body.amount.currency as CurrencyCode,
            },
            {
              budgetCurrency: e.currency as CurrencyCode,
              reportingCurrency: actor.reportingCurrency,
              rates,
            },
          ),
        );
        const depositMinor = Math.round((body.amount.amountMinor * body.depositPct) / 100);
        const values = {
          status: 'received',
          amountMinor: body.amount.amountMinor,
          currency: body.amount.currency,
          budgetAmountMinor: triplet.budget.amountMinor,
          budgetCurrency: triplet.budget.currency,
          perHeadMinor: Math.round(triplet.budget.amountMinor / Math.max(request.quantity, 1)),
          depositPct: body.depositPct,
          depositMinor,
          depositRefundable: body.depositRefundable,
          depositTerms: body.depositTerms ?? null,
          cancellationTerms: body.cancellationTerms ?? null,
          validUntil: body.validUntil ?? null,
          includesText: body.includesText ?? null,
          documentId: body.documentId ?? null,
          updatedAt: new Date(),
        };
        const [existing] = await tx
          .select()
          .from(eventQuotes)
          .where(
            and(eq(eventQuotes.quoteRequestId, request.id), eq(eventQuotes.vendorId, vendor.id)),
          );
        if (existing && existing.status === 'selected')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'This quote is already selected; release its commitment before changing the price.',
          );
        if (existing)
          await tx.update(eventQuotes).set(values).where(eq(eventQuotes.id, existing.id));
        else
          await tx.insert(eventQuotes).values({
            tenantId: actor.tenantId,
            eventId: e.id,
            quoteRequestId: request.id,
            vendorId: vendor.id,
            ...values,
          });
        await this.support.log(tx, actor, e, 'event.quote_recorded', ctx, {
          quoteRequestId: { from: null, to: request.id },
          vendor: { from: null, to: vendor.name },
          amount: { from: existing?.amountMinor ?? null, to: body.amount.amountMinor },
          budgetAmount: { from: null, to: triplet.budget },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  /** Selecting a quote creates the event commitment and declines the other quotes of its request. */
  select(
    actor: RequestActor,
    eventId: string,
    quoteId: string,
    body: SelectVendorQuoteBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventQuotesView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.quotes.select:${quoteId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'Quotes');
        const [quote] = await tx
          .select()
          .from(eventQuotes)
          .where(and(eq(eventQuotes.id, quoteId), eq(eventQuotes.eventId, e.id)));
        if (!quote) throw ApiProblem.notFound('quote');
        if (quote.status === 'selected')
          throw new ApiProblem(409, 'INVALID_TRANSITION', 'This quote is already selected.');
        const [vendor] = await tx
          .select({ id: vendors.id, name: vendors.name, status: vendors.status })
          .from(vendors)
          .where(eq(vendors.id, quote.vendorId));
        const [request] = await tx
          .select()
          .from(eventQuoteRequests)
          .where(eq(eventQuoteRequests.id, quote.quoteRequestId));
        const siblings = await tx
          .select()
          .from(eventQuotes)
          .where(eq(eventQuotes.quoteRequestId, quote.quoteRequestId));
        const received = siblings.filter((q) => q.status === 'received');
        const lowest = received.length
          ? Math.min(...received.map((q) => q.budgetAmountMinor))
          : quote.budgetAmountMinor;
        const locked = (await this.support.events.row(tx, e.id, true))!;
        const srcs = await this.sources.list(tx, e.id, { lock: true });
        const funding = await this.support.events.funding(tx, locked, srcs);
        const check = validateQuoteSelection({
          vendorStatus: (vendor?.status ?? 'unknown') as VendorStatus,
          quoteStatus: quote.status,
          validUntil: quote.validUntil,
          asOfDate: todayIso(),
          budgetAmountMinor: quote.budgetAmountMinor,
          availableMinor: Math.max(funding.capMinor - funding.committedMinor, 0),
          isLowest: quote.budgetAmountMinor <= lowest,
          reason: body.reason ?? null,
        });
        if (!check.ok)
          throw new ApiProblem(
            check.error.code === 'REASON_REQUIRED' ? 422 : 409,
            check.error.code,
            check.error.message,
            check.error.params,
          );
        const created = await this.commitments.createForEvent(
          tx,
          this.support.events.pc(actor, 'events.quotes.select', ctx),
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
            description: `${request?.title ?? 'Event spend'}: ${vendor?.name ?? 'vendor'}`,
            vendorId: quote.vendorId,
            amount: {
              amountMinor: quote.amountMinor,
              currency: quote.currency as CurrencyCode,
            },
            serviceStart: body.serviceStart ?? request?.neededBy ?? null,
            serviceEnd: body.serviceEnd ?? null,
            nonRefundableDepositMinor: quote.depositRefundable ? 0 : quote.depositMinor,
          },
        );
        await tx
          .update(eventQuotes)
          .set({
            status: 'selected',
            commitmentId: created.commitmentId,
            selectionReason: body.reason ?? null,
            selectedByPersonId: actor.personId,
            selectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(eventQuotes.id, quote.id));
        if (body.notifyDeclinedVendors && siblings.length > 1)
          await tx
            .update(eventQuotes)
            .set({ status: 'declined', updatedAt: new Date() })
            .where(
              and(
                eq(eventQuotes.quoteRequestId, quote.quoteRequestId),
                inArray(
                  eventQuotes.id,
                  siblings.filter((q) => q.id !== quote.id).map((q) => q.id),
                ),
              ),
            );
        await this.plan.completeSystemTask(tx, e.id, 'quote', {
          id: quote.id,
          label: `Quote selected: ${vendor?.name ?? 'vendor'}`,
        });
        await this.support.log(
          tx,
          actor,
          e,
          'event.quote_selected',
          ctx,
          {
            quoteId: { from: null, to: quote.id },
            vendor: { from: null, to: vendor?.name ?? null },
            amount: {
              from: null,
              to: { amountMinor: quote.amountMinor, currency: quote.currency },
            },
            budgetAmount: { from: null, to: created.budgetAmount },
            commitmentId: { from: null, to: created.commitmentId },
            quotesCompared: {
              from: null,
              to: siblings.map((q) => ({ id: q.id, budgetAmountMinor: q.budgetAmountMinor })),
            },
            journalIds: { from: null, to: created.journalIds },
          },
          body.reason ?? null,
        );
        return this.view(tx, actor, e);
      },
    );
  }

  decline(
    actor: RequestActor,
    eventId: string,
    quoteId: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<CommandResult<EventQuotesView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.quotes.decline:${quoteId}`,
        request: { reason },
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const [quote] = await tx
          .select()
          .from(eventQuotes)
          .where(and(eq(eventQuotes.id, quoteId), eq(eventQuotes.eventId, e.id)));
        if (!quote) throw ApiProblem.notFound('quote');
        if (quote.status === 'selected')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Release the commitment of a selected quote before declining it.',
          );
        await tx
          .update(eventQuotes)
          .set({ status: 'declined', updatedAt: new Date() })
          .where(eq(eventQuotes.id, quote.id));
        await this.support.log(
          tx,
          actor,
          e,
          'event.quote_declined',
          ctx,
          { quoteId: { from: quote.status, to: 'declined' } },
          reason ?? null,
        );
        return this.view(tx, actor, e);
      },
    );
  }
}
