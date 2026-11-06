import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AcknowledgeCheckRequest,
  AssignRolloverPolicyRequest,
  CloseForecastCycleRequest,
  ClosePeriodRequest,
  CreateForecastCycleRequest,
  CreateYearEndRunRequest,
  ExecuteYearEndRequest,
  ForecastDecisionRequest,
  PeriodStatusRequest,
  ReopenDecisionRequest,
  RequestReopenRequest,
  SubmitForecastRequest,
  YearEndCarryDecisionRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { CommandContext } from './close-reads';
import { ForecastCyclesService } from './forecast-cycles.service';
import { PeriodCloseService } from './period-close.service';
import { RolloverPoliciesService } from './rollover-policies.service';
import { YearEndService } from './year-end.service';

const Uuid = z.uuid();
const ListQuery = z.object({ fiscalYearId: Uuid.optional() }).strict();
const CycleListQuery = z
  .object({ fiscalYearId: Uuid.optional(), status: z.enum(['open', 'closed']).optional() })
  .strict();

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

function replayed<T>(res: ResponseLike, r: { replayed: boolean; body: T }): T {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
}

const ctx = (idempotencyKey: string, requestId: string | null): CommandContext => ({
  idempotencyKey,
  requestId,
});
const id = (v: string) => parseWith(Uuid, v);

/** Period close, break-glass reopen, rollover policies and the fiscal year-end run. */
@Controller('api/close')
export class CloseController {
  constructor(
    private readonly periods: PeriodCloseService,
    private readonly policies: RolloverPoliciesService,
    private readonly yearEnd: YearEndService,
    private readonly forecasts: ForecastCyclesService,
  ) {}

  @Get('periods')
  listPeriods(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.periods.list(actor, parseWith(ListQuery, query));
  }

  @Get('periods/:periodId')
  getPeriod(@CurrentActor() actor: RequestActor, @Param('periodId') periodId: string) {
    return this.periods.get(actor, id(periodId));
  }

  @Get('periods/:periodId/snapshots')
  snapshots(@CurrentActor() actor: RequestActor, @Param('periodId') periodId: string) {
    return this.periods.snapshots(actor, id(periodId));
  }

  @Get('periods/:periodId/late-items')
  lateItems(@CurrentActor() actor: RequestActor, @Param('periodId') periodId: string) {
    return this.periods.lateItems(actor, id(periodId));
  }

  @Post('periods/:periodId/acknowledgements')
  @HttpCode(201)
  async acknowledge(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') periodId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.acknowledge(
        actor,
        id(periodId),
        parseWith(AcknowledgeCheckRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('periods/:periodId/soft-close')
  @HttpCode(201)
  async softClose(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') periodId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.softClose(
        actor,
        id(periodId),
        parseWith(PeriodStatusRequest, body ?? {}),
        ctx(key, rid),
      ),
    );
  }

  @Post('periods/:periodId/close')
  @HttpCode(201)
  async close(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') periodId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.close(
        actor,
        id(periodId),
        parseWith(ClosePeriodRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('periods/:periodId/lock')
  @HttpCode(201)
  async lock(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') periodId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.lock(
        actor,
        id(periodId),
        parseWith(PeriodStatusRequest, body ?? {}),
        ctx(key, rid),
      ),
    );
  }

  @Post('periods/:periodId/reopen-requests')
  @HttpCode(201)
  async requestReopen(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') periodId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.requestReopen(
        actor,
        id(periodId),
        parseWith(RequestReopenRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('reopen-requests/:requestId/decision')
  @HttpCode(201)
  async decideReopen(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') requestId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.periods.decideReopen(
        actor,
        id(requestId),
        parseWith(ReopenDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('rollover-policies')
  listPolicies(@CurrentActor() actor: RequestActor) {
    return this.policies.list(actor);
  }

  @Put('budgets/:budgetId/rollover-policy')
  async assignPolicy(
    @CurrentActor() actor: RequestActor,
    @Param('budgetId') budgetId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.policies.assign(
        actor,
        id(budgetId),
        parseWith(AssignRolloverPolicyRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('year-end-runs')
  listRuns(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.yearEnd.list(actor, parseWith(ListQuery, query));
  }

  @Get('year-end-runs/:runId')
  getRun(@CurrentActor() actor: RequestActor, @Param('runId') runId: string) {
    return this.yearEnd.get(actor, id(runId));
  }

  @Post('year-end-runs')
  @HttpCode(201)
  async createRun(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.yearEnd.create(actor, parseWith(CreateYearEndRunRequest, body), ctx(key, rid)),
    );
  }

  @Post('year-end-runs/:runId/dry-run')
  @HttpCode(201)
  async dryRun(
    @CurrentActor() actor: RequestActor,
    @Param('runId') runId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.yearEnd.dryRun(actor, id(runId), ctx(key, rid)));
  }

  @Post('year-end-runs/:runId/lines/:lineId/decision')
  @HttpCode(201)
  async decideCarry(
    @CurrentActor() actor: RequestActor,
    @Param('runId') runId: string,
    @Param('lineId') lineId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.yearEnd.decide(
        actor,
        id(runId),
        id(lineId),
        parseWith(YearEndCarryDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('year-end-runs/:runId/execution')
  @HttpCode(201)
  async execute(
    @CurrentActor() actor: RequestActor,
    @Param('runId') runId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.yearEnd.execute(
        actor,
        id(runId),
        parseWith(ExecuteYearEndRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('forecast-cycles')
  listForecastCycles(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.forecasts.list(actor, parseWith(CycleListQuery, query));
  }

  @Get('forecast-cycles/:cycleId')
  getForecastCycle(@CurrentActor() actor: RequestActor, @Param('cycleId') cycleId: string) {
    return this.forecasts.get(actor, id(cycleId));
  }

  @Post('forecast-cycles')
  @HttpCode(201)
  async createForecastCycle(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.forecasts.create(
        actor,
        parseWith(CreateForecastCycleRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('forecast-cycles/:cycleId/submissions')
  @HttpCode(201)
  async submitForecast(
    @CurrentActor() actor: RequestActor,
    @Param('cycleId') cycleId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.forecasts.submit(
        actor,
        id(cycleId),
        parseWith(SubmitForecastRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('forecast-cycles/:cycleId/submissions/:submissionId/decision')
  @HttpCode(201)
  async decideForecast(
    @CurrentActor() actor: RequestActor,
    @Param('cycleId') cycleId: string,
    @Param('submissionId') submissionId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.forecasts.decide(
        actor,
        id(cycleId),
        id(submissionId),
        parseWith(ForecastDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('forecast-cycles/:cycleId/close')
  @HttpCode(201)
  async closeForecastCycle(
    @CurrentActor() actor: RequestActor,
    @Param('cycleId') cycleId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.forecasts.close(
        actor,
        id(cycleId),
        parseWith(CloseForecastCycleRequest, body),
        ctx(key, rid),
      ),
    );
  }
}
