import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  AllocateRequest,
  BatchAllocationRequest,
  BudgetListQuery,
  BudgetSettingsRequest,
  BudgetSummaryQuery,
  ChangeRequestQuery,
  ControlPreviewRequest,
  CreateBudgetRequest,
  CreateIncreaseRequest,
  CreateReleaseRequest,
  DecideChangeRequest,
  FreezeRequest,
  PerHeadRequest,
  ReduceRequest,
  RestoreRequest,
  RollForwardRequest,
  SetBudgetLimitsRequest,
  SetPhasingRequest,
  SetToZeroRequest,
  SpendCheckRequest,
  TransferRequest,
  TrueUpRequest,
  UnfreezeRequest,
  type BudgetDetail,
  type Journal,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { AllocationService } from './allocation.service';
import { BudgetsService } from './budgets.service';
import { ControlsService } from './controls.service';
import { PlanningService } from './planning.service';

const BudgetId = z.uuid();

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

function replayed<T>(res: ResponseLike, r: CommandResult<T>): T {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
}

@Controller('api/budgets')
export class BudgetsController {
  constructor(
    private readonly budgets: BudgetsService,
    private readonly controls: ControlsService,
    private readonly allocation: AllocationService,
    private readonly planning: PlanningService,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query() rawQuery: unknown,
  ): Promise<{ items: BudgetDetail[]; nextCursor: string | null }> {
    return this.budgets.list(actor, parseWith(BudgetListQuery, rawQuery));
  }

  @Get('summary')
  summary(@CurrentActor() actor: RequestActor, @Query() rawQuery: unknown) {
    return this.budgets.summary(actor, parseWith(BudgetSummaryQuery, rawQuery));
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
    return replayed(res, await this.budgets.create(actor, req, { idempotencyKey, requestId }));
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
    return replayed(
      res,
      await this.budgets.allocate(actor, parentId, req, { idempotencyKey, requestId }),
    );
  }

  @Post(':budgetId/allocations/batch')
  @HttpCode(200)
  batch(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return this.allocation.batch(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(BatchAllocationRequest, body),
      { idempotencyKey, requestId },
    );
  }

  @Get(':budgetId/allocation-history')
  history(@CurrentActor() actor: RequestActor, @Param('budgetId') rawId: string) {
    return this.allocation.history(actor, parseWith(BudgetId, rawId));
  }

  @Post(':budgetId/activate')
  @HttpCode(200)
  async activate(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.budgets.activate(actor, parseWith(BudgetId, rawId), { idempotencyKey, requestId }),
    );
  }

  @Put(':budgetId/settings')
  async settings(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.budgets.updateSettings(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(BudgetSettingsRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Get(':budgetId/limits')
  limits(@CurrentActor() actor: RequestActor, @Param('budgetId') rawId: string) {
    return this.planning.getLimits(actor, parseWith(BudgetId, rawId));
  }

  @Put(':budgetId/limits')
  async setLimits(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.planning.setLimits(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(SetBudgetLimitsRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/spend-check')
  @HttpCode(200)
  spendCheck(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @Body() body: unknown,
  ) {
    return this.planning.spendCheck(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(SpendCheckRequest, body),
    );
  }

  @Post(':budgetId/controls/preview')
  @HttpCode(200)
  preview(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @Body() body: unknown,
  ) {
    return this.controls.preview(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(ControlPreviewRequest, body),
    );
  }

  @Post(':budgetId/freeze')
  @HttpCode(200)
  async freeze(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.freeze(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(FreezeRequest, body),
        {
          idempotencyKey,
          requestId,
        },
      ),
    );
  }

  @Post(':budgetId/unfreeze')
  @HttpCode(200)
  async unfreeze(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.unfreeze(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(UnfreezeRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/reduce')
  @HttpCode(200)
  async reduce(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.reduce(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(ReduceRequest, body),
        {
          idempotencyKey,
          requestId,
        },
      ),
    );
  }

  @Post(':budgetId/set-to-zero')
  @HttpCode(200)
  async setToZero(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.setToZero(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(SetToZeroRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/restore')
  @HttpCode(200)
  async restore(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.restore(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(RestoreRequest, body),
        {
          idempotencyKey,
          requestId,
        },
      ),
    );
  }

  @Post(':budgetId/transfers')
  @HttpCode(201)
  async transfer(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.controls.transfer(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(TransferRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Get(':budgetId/versions')
  versions(@CurrentActor() actor: RequestActor, @Param('budgetId') rawId: string) {
    return this.planning.versions(actor, parseWith(BudgetId, rawId));
  }

  @Get(':budgetId/phasing')
  phasing(@CurrentActor() actor: RequestActor, @Param('budgetId') rawId: string) {
    return this.planning.getPhasing(actor, parseWith(BudgetId, rawId));
  }

  @Put(':budgetId/phasing')
  async setPhasing(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.planning.setPhasing(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(SetPhasingRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/per-head')
  @HttpCode(200)
  perHead(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return this.allocation.perHead(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(PerHeadRequest, body),
      { idempotencyKey, requestId },
    );
  }

  @Post(':budgetId/per-head/true-up')
  @HttpCode(200)
  trueUp(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return this.allocation.trueUp(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(TrueUpRequest, body),
      { idempotencyKey, requestId },
    );
  }

  @Post(':budgetId/increase-requests')
  @HttpCode(201)
  async requestIncrease(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.allocation.requestIncrease(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(CreateIncreaseRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/releases')
  @HttpCode(201)
  async requestRelease(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.allocation.requestRelease(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(CreateReleaseRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post(':budgetId/roll-forward')
  @HttpCode(200)
  rollForward(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return this.planning.rollForward(
      actor,
      parseWith(BudgetId, rawId),
      parseWith(RollForwardRequest, body),
      { idempotencyKey, requestId },
    );
  }
}

@Controller('api/budget-requests')
export class BudgetRequestsController {
  constructor(private readonly allocation: AllocationService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() rawQuery: unknown) {
    return this.allocation.listRequests(actor, parseWith(ChangeRequestQuery, rawQuery));
  }

  @Post(':requestId/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.allocation.decide(
        actor,
        parseWith(BudgetId, rawId),
        parseWith(DecideChangeRequest, body),
        { idempotencyKey, requestId },
      ),
    );
  }
}
