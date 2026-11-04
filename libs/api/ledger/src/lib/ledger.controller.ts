import {
  ApiProblem,
  CurrentActor,
  DB,
  IdempotencyKey,
  parseWith,
  PolicyService,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import { budgets, withTenant, type Db } from '@bf/api/db';
import { ManualJournalRequest, ReversalRequest, type Journal } from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { LedgerCommands } from './ledger-commands.service';
import { LedgerService } from './ledger.service';

const JournalId = z.uuid();

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Controller('api/ledger/journals')
export class LedgerController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly ledger: LedgerService,
    private readonly commands: LedgerCommands,
  ) {}

  @Get(':journalId')
  async get(
    @CurrentActor() actor: RequestActor,
    @Param('journalId') rawId: string,
  ): Promise<Journal> {
    const journalId = parseWith(JournalId, rawId);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const j = await this.ledger.journalRow(tx, journalId);
      if (!j) throw ApiProblem.notFound('journal');
      const lines = await this.ledger.linesOf(tx, journalId);
      const ids = [...new Set(lines.map((l) => l.budgetId).filter((b): b is string => Boolean(b)))];
      const rows = ids.length
        ? await tx
            .select({ id: budgets.id, path: budgets.path })
            .from(budgets)
            .where(inArray(budgets.id, ids))
        : [];
      const readable = rows.some(
        (b) =>
          this.policy.can(actor, 'ledger.read', {
            kind: 'budget',
            tenantId: actor.tenantId,
            id: b.id,
            path: b.path,
          }).allowed,
      );
      const tenantWide =
        this.policy.can(actor, 'ledger.read', { kind: 'tenant', tenantId: actor.tenantId })
          .allowed && actor.roles.length > 0;
      if (!readable && !(tenantWide && ids.length === 0)) throw ApiProblem.notFound('journal');
      return this.ledger.journalDto(tx, journalId);
    });
  }

  @Post()
  @HttpCode(201)
  async postManual(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<Journal> {
    const req = parseWith(ManualJournalRequest, body);
    const r = await this.commands.postManual(actor, req, { idempotencyKey, requestId });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':journalId/reversals')
  @HttpCode(201)
  async reverse(
    @CurrentActor() actor: RequestActor,
    @Param('journalId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<Journal> {
    const journalId = parseWith(JournalId, rawId);
    const req = parseWith(ReversalRequest, body);
    const r = await this.commands.reverse(actor, journalId, req, { idempotencyKey, requestId });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
