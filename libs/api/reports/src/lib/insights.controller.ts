import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  ApprovalPerformanceQuery,
  CreateEvidencePackRequest,
  PendingApprovalsQuery,
  ProductAnalyticsQuery,
  type ApprovalPerformance,
  type EvidencePack,
  type EvidencePackDownload,
  type PendingApprovalsOverview,
  type ProductAnalytics,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { ApprovalsDashboardsService } from './approvals-dashboards.service';
import { EvidencePacksService } from './evidence-packs.service';
import { ProductAnalyticsService } from './product-analytics.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const Uuid = z.uuid();

/** Gap package B2, second part: 018, 018a, 018b and 088a. Thin: parse, call, return. */
@Controller('api')
export class InsightsController {
  constructor(
    private readonly approvals: ApprovalsDashboardsService,
    private readonly analytics: ProductAnalyticsService,
    private readonly packs: EvidencePacksService,
  ) {}

  @Get('dashboards/pending-approvals')
  pending(
    @CurrentActor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<PendingApprovalsOverview> {
    return this.approvals.pending(actor, parseWith(PendingApprovalsQuery, query));
  }

  @Post('dashboards/pending-approvals/:taskId/nudge')
  @HttpCode(200)
  async nudge(
    @CurrentActor() actor: RequestActor,
    @Param('taskId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const r = await this.approvals.nudge(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('dashboards/approval-performance')
  performance(
    @CurrentActor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<ApprovalPerformance> {
    return this.approvals.performance(actor, parseWith(ApprovalPerformanceQuery, query));
  }

  @Get('analytics/kpis')
  kpis(@CurrentActor() actor: RequestActor, @Query() query: unknown): Promise<ProductAnalytics> {
    return this.analytics.kpis(actor, parseWith(ProductAnalyticsQuery, query));
  }

  @Get('evidence-packs')
  listPacks(@CurrentActor() actor: RequestActor) {
    return this.packs.list(actor);
  }

  @Post('evidence-packs')
  @HttpCode(202)
  async createPack(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EvidencePack> {
    const r = await this.packs.create(actor, parseWith(CreateEvidencePackRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('evidence-packs/:packId')
  pack(@CurrentActor() actor: RequestActor, @Param('packId') raw: string): Promise<EvidencePack> {
    return this.packs.get(actor, parseWith(Uuid, raw));
  }

  @Get('evidence-packs/:packId/download')
  download(
    @CurrentActor() actor: RequestActor,
    @Param('packId') raw: string,
    @RequestId() requestId: string | null,
  ): Promise<EvidencePackDownload> {
    return this.packs.download(actor, parseWith(Uuid, raw), { requestId });
  }
}
