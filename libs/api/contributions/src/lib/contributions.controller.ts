import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  ContributionListQuery,
  CreateContributionBody,
  DecisionRequest,
  type CandidateGivingBudget,
  type ContributionDetail,
  type ContributionSummary,
  type DecisionResponse,
  type IntercompanyPolicyView,
  type RechargeView,
  CandidateGivingBudgetsQuery,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { ContributionsService } from './contributions.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const Uuid = z.uuid();

@Controller('api')
export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  @Get('contributions')
  list(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: ContributionSummary[] }> {
    return this.contributions.list(actor, parseWith(ContributionListQuery, raw));
  }

  @Get('contributions/candidate-budgets')
  candidates(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: CandidateGivingBudget[] }> {
    const q = parseWith(CandidateGivingBudgetsQuery, raw);
    return this.contributions.candidates(actor, q.eventId, q.q);
  }

  @Post('contributions')
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ContributionDetail> {
    const r = await this.contributions.create(actor, parseWith(CreateContributionBody, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('contributions/:contributionId')
  get(
    @CurrentActor() actor: RequestActor,
    @Param('contributionId') raw: string,
  ): Promise<ContributionDetail> {
    return this.contributions.get(actor, parseWith(Uuid, raw));
  }

  @Post('contributions/:contributionId/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('contributionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DecisionResponse> {
    const r = await this.contributions.decide(
      actor,
      parseWith(Uuid, raw),
      parseWith(DecisionRequest, body),
      {
        idempotencyKey,
        requestId,
      },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('contributions/:contributionId/withdraw')
  @HttpCode(200)
  async withdraw(
    @CurrentActor() actor: RequestActor,
    @Param('contributionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ContributionDetail> {
    const r = await this.contributions.withdraw(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('recharges')
  recharges(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: RechargeView[] }> {
    const q = parseWith(z.object({ eventId: Uuid.optional() }).strict(), raw);
    return this.contributions.rechargeList(actor, q.eventId);
  }

  @Post('recharges/:rechargeId/approve')
  @HttpCode(200)
  async approveRecharge(
    @CurrentActor() actor: RequestActor,
    @Param('rechargeId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RechargeView> {
    const r = await this.contributions.approveRecharge(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('intercompany-policies')
  policies(@CurrentActor() actor: RequestActor): Promise<{ items: IntercompanyPolicyView[] }> {
    return this.contributions.policies(actor);
  }
}
