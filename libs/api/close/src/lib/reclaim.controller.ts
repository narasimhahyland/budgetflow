import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  BurnRateAlertQuery,
  CreateBurnRateRunRequest,
  CreateReclaimCampaignRequest,
  EscalateReclaimNoticeRequest,
  ExecuteReclaimPoolRequest,
  ReclaimPoolPreviewRequest,
  RespondReclaimNoticeRequest,
  RunReclaimRemindersRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { BurnRateService } from './burn-rate.service';
import type { CommandContext } from './close-reads';
import { ReclaimService } from './reclaim.service';

const Uuid = z.uuid();
const id = (v: string) => parseWith(Uuid, v);

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

/** Reclaim and redistribute campaigns (086a) and burn-rate alerts. Thin: parse, call one service. */
@Controller('api')
export class ReclaimController {
  constructor(
    private readonly reclaim: ReclaimService,
    private readonly burnRate: BurnRateService,
  ) {}

  @Get('reclaim/campaigns')
  list(@CurrentActor() actor: RequestActor) {
    return this.reclaim.list(actor);
  }

  @Post('reclaim/campaigns/preview')
  @HttpCode(200)
  preview(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.reclaim.preview(actor, parseWith(CreateReclaimCampaignRequest, body));
  }

  @Post('reclaim/campaigns')
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.reclaim.create(
        actor,
        parseWith(CreateReclaimCampaignRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('reclaim/campaigns/:campaignId')
  get(@CurrentActor() actor: RequestActor, @Param('campaignId') campaignId: string) {
    return this.reclaim.get(actor, id(campaignId));
  }

  @Post('reclaim/campaigns/:campaignId/pools/preview')
  @HttpCode(200)
  previewPool(
    @CurrentActor() actor: RequestActor,
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ) {
    return this.reclaim.previewPool(
      actor,
      id(campaignId),
      parseWith(ReclaimPoolPreviewRequest, body),
    );
  }

  @Post('reclaim/campaigns/:campaignId/pools/execution')
  @HttpCode(201)
  async executePool(
    @CurrentActor() actor: RequestActor,
    @Param('campaignId') campaignId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.reclaim.executePool(
        actor,
        id(campaignId),
        parseWith(ExecuteReclaimPoolRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('reclaim/notices')
  mine(@CurrentActor() actor: RequestActor) {
    return this.reclaim.mine(actor);
  }

  @Get('reclaim/notices/:noticeId')
  notice(@CurrentActor() actor: RequestActor, @Param('noticeId') noticeId: string) {
    return this.reclaim.getNotice(actor, id(noticeId));
  }

  @Post('reclaim/notices/:noticeId/response')
  @HttpCode(200)
  async respond(
    @CurrentActor() actor: RequestActor,
    @Param('noticeId') noticeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.reclaim.respond(
        actor,
        id(noticeId),
        parseWith(RespondReclaimNoticeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('reclaim/notices/:noticeId/escalation')
  @HttpCode(200)
  async escalate(
    @CurrentActor() actor: RequestActor,
    @Param('noticeId') noticeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.reclaim.escalate(
        actor,
        id(noticeId),
        parseWith(EscalateReclaimNoticeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('reclaim/reminder-runs')
  @HttpCode(202)
  async reminders(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.reclaim.requestReminders(
        actor,
        parseWith(RunReclaimRemindersRequest, body ?? {}),
        ctx(key, rid),
      ),
    );
  }

  @Post('burn-rate/runs')
  @HttpCode(202)
  async run(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.burnRate.request(
        actor,
        parseWith(CreateBurnRateRunRequest, body ?? {}),
        ctx(key, rid),
      ),
    );
  }

  @Get('burn-rate/runs/:runId')
  getRun(@CurrentActor() actor: RequestActor, @Param('runId') runId: string) {
    return this.burnRate.getRun(actor, id(runId));
  }

  @Get('burn-rate/alerts')
  alerts(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.burnRate.alerts(actor, parseWith(BurnRateAlertQuery, query));
  }
}
