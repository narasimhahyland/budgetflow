import { CurrentActor, IdempotencyKey, parseWith, type RequestActor } from '@bf/api/core';
import {
  AlertDecisionRequest,
  AlertsQuery,
  ExceptionsQuery,
  type AlertsOverview,
  type BudgetAlert,
  type ExceptionsOverview,
  type FinanceOverview,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

/** Gap package B2 dashboards. Thin: parse, call the service, return the contract shape. */
@Controller('api/dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('finance')
  finance(@CurrentActor() actor: RequestActor): Promise<FinanceOverview> {
    return this.dashboards.finance(actor);
  }

  @Get('alerts')
  alerts(@CurrentActor() actor: RequestActor, @Query() query: unknown): Promise<AlertsOverview> {
    return this.dashboards.alerts(actor, parseWith(AlertsQuery, query));
  }

  @Post('alerts/decisions')
  @HttpCode(200)
  async decideAlert(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<BudgetAlert> {
    const r = await this.dashboards.decideAlert(actor, parseWith(AlertDecisionRequest, body), {
      idempotencyKey,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('exceptions')
  exceptions(
    @CurrentActor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<ExceptionsOverview> {
    return this.dashboards.exceptions(actor, parseWith(ExceptionsQuery, query));
  }
}
