import { ImportsService } from '@bf/api/actuals';
import {
  ApiProblem,
  DB,
  IdempotencyKey,
  parseWith,
  PolicyService,
  Public,
  RequestId,
  header,
  type ApiRequest,
} from '@bf/api/core';
import { budgets, events, withTenant, type Db } from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type { CurrencyCode } from '@bf/domain';
import {
  CursorQuery,
  PublicImportRequest,
  type PublicApiMeta,
  type PublicBudget,
  type PublicBudgetList,
  type PublicEventList,
  type PublicImportResult,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { asc, gt } from 'drizzle-orm';
import { ApiKeysService, type ApiKeyIdentity } from './api-keys.service';
import { tenantOf } from './connections.service';

/**
 * The public API (101, 101a). Authentication is a scoped API key, not a session: the key names its
 * tenant, so the database session is scoped before anything is read and row level security keeps a
 * key inside its own tenant. Every handler also asks `PolicyService`, and the key's scopes are the
 * only actions it holds, so no key can approve, apply a control or move money.
 */
@Controller('api/public/v1')
export class PublicApiController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly keys: ApiKeysService,
    private readonly policy: PolicyService,
    private readonly ledgerReads: LedgerReads,
    private readonly imports: ImportsService,
  ) {}

  @Public()
  @Get('meta')
  async meta(@Req() req: ApiRequest): Promise<PublicApiMeta> {
    const identity = await this.identify(req);
    const result: PublicApiMeta = {
      version: 'v1',
      keyPrefix: identity.prefix,
      scopes: identity.scopes,
      rateLimitPerMinute: identity.rateLimitPerMinute,
      rateLimitRemaining: identity.rateLimitRemaining,
      tenantId: identity.actor.tenantId,
      notice:
        'API keys read and feed data. They can never approve or reject requests, change controls or move money.',
    };
    await this.keys.logRequest(identity, 'GET', '/api/public/v1/meta', 200);
    return result;
  }

  @Public()
  @Get('budgets')
  async listBudgets(@Req() req: ApiRequest, @Query() raw: unknown): Promise<PublicBudgetList> {
    const identity = await this.identify(req);
    this.keys.assertScope(identity, 'budgets.read');
    const q = parseWith(CursorQuery, raw);
    const limit = q.limit ?? 50;
    const actor = identity.actor;
    const body = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'budget.read', tenantOf(actor));
        const rows = await tx
          .select()
          .from(budgets)
          .where(q.cursor ? gt(budgets.id, q.cursor) : undefined)
          .orderBy(asc(budgets.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const balances = await this.ledgerReads.balances(
          tx,
          page.map((b) => b.id),
        );
        return {
          items: page.map((b) => this.budgetView(b, balances.get(b.id)!.budget)),
          nextCursor: rows.length > limit ? page.at(-1)!.id : null,
        };
      },
    );
    await this.keys.logRequest(identity, 'GET', '/api/public/v1/budgets', 200);
    return body;
  }

  @Public()
  @Get('events')
  async listEvents(@Req() req: ApiRequest, @Query() raw: unknown): Promise<PublicEventList> {
    const identity = await this.identify(req);
    this.keys.assertScope(identity, 'events.read');
    const q = parseWith(CursorQuery, raw);
    const limit = q.limit ?? 50;
    const actor = identity.actor;
    const body = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'event.read', tenantOf(actor));
        const rows = await tx
          .select()
          .from(events)
          .where(q.cursor ? gt(events.id, q.cursor) : undefined)
          .orderBy(asc(events.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        return {
          items: page.map((e) => ({
            id: e.id,
            eventCode: e.eventCode,
            name: e.name,
            status: e.status,
            startDate: e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null,
            endDate: e.endsAt ? e.endsAt.toISOString().slice(0, 10) : null,
            estimatedCost: { amountMinor: e.estimateMinor, currency: e.currency as CurrencyCode },
          })),
          nextCursor: rows.length > limit ? page.at(-1)!.id : null,
        };
      },
    );
    await this.keys.logRequest(identity, 'GET', '/api/public/v1/events', 200);
    return body;
  }

  /**
   * Feeds lines into the actuals review queue (080a). It deliberately does not post them: a person
   * reviews and posts the batch, which is where the ledger postings happen.
   */
  @Public()
  @Post('actuals/imports')
  @HttpCode(201)
  async createImport(
    @Req() req: ApiRequest,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() raw: unknown,
  ): Promise<PublicImportResult> {
    const identity = await this.identify(req);
    this.keys.assertScope(identity, 'actuals.write');
    const body = parseWith(PublicImportRequest, raw);
    const res = await this.imports.upload(
      identity.actor,
      { source: body.source, fileName: body.fileName, content: body.csv },
      { idempotencyKey, requestId },
    );
    await this.keys.logRequest(identity, 'POST', '/api/public/v1/actuals/imports', 201);
    return {
      importBatchId: res.body.id,
      linesRead: res.body.summary.linesRead,
      imported: res.body.summary.imported,
      duplicatesSkipped: res.body.summary.duplicatesSkipped,
      rejected: res.body.summary.rejected,
      status: 'review',
    };
  }

  private budgetView(row: typeof budgets.$inferSelect, b: Record<string, number>): PublicBudget {
    const currency = row.currency as CurrencyCode;
    const money = (amountMinor: number) => ({ amountMinor, currency });
    const available =
      b['authorized'] -
      b['allocated_out'] -
      b['held'] -
      b['pre_encumbered'] -
      b['encumbered'] -
      b['actual'];
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      status: row.status,
      currency,
      authorized: money(b['authorized']),
      allocatedOut: money(b['allocated_out']),
      held: money(b['held']),
      preEncumbered: money(b['pre_encumbered']),
      encumbered: money(b['encumbered']),
      actual: money(b['actual']),
      available: money(available),
      fiscalYearLabel: null,
    };
  }

  private async identify(req: ApiRequest): Promise<ApiKeyIdentity> {
    const auth = header(req, 'authorization');
    if (!auth?.startsWith('Bearer ')) {
      throw new ApiProblem(
        401,
        'API_KEY_INVALID',
        'Send your API key as an Authorization: Bearer header.',
      );
    }
    const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    return this.keys.authenticate(auth.slice(7).trim(), forwarded);
  }
}
