import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AllocateRequest,
  CreateBudgetRequest,
  CursorQuery,
  type BudgetDetail,
  type Journal,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { BudgetsService } from './budgets.service';

const BudgetId = z.uuid();

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Controller('api/budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query() rawQuery: unknown,
  ): Promise<{ items: BudgetDetail[]; nextCursor: string | null }> {
    const q = parseWith(CursorQuery, rawQuery);
    return this.budgets.list(actor, q.cursor, q.limit ?? 50);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<BudgetDetail> {
    const req = parseWith(CreateBudgetRequest, body);
    const r = await this.budgets.create(actor, req, { idempotencyKey, requestId });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':budgetId')
  get(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
  ): Promise<BudgetDetail> {
    return this.budgets.get(actor, parseWith(BudgetId, rawId));
  }

  @Get(':budgetId/ledger')
  async ledger(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
  ): Promise<{ items: Journal['lines'] }> {
    return { items: await this.budgets.ledgerLines(actor, parseWith(BudgetId, rawId)) };
  }

  @Post(':budgetId/allocations')
  @HttpCode(201)
  async allocate(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const parentId = parseWith(BudgetId, rawId);
    const req = parseWith(AllocateRequest, body);
    const r = await this.budgets.allocate(actor, parentId, req, { idempotencyKey, requestId });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
