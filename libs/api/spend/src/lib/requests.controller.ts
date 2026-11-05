import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  CreateRequestBody,
  RequestListQuery,
  ResubmitRequestBody,
  RoutePreviewQuery,
  WithdrawRequestBody,
  type RequestableBudget,
  type RequestDetail,
  type RequestList,
  type RoutePreview,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { RequestsService } from './requests.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const RequestIdParam = z.uuid();

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<RequestList> {
    return this.requests.list(actor, parseWith(RequestListQuery, raw));
  }

  @Get('requestable-budgets')
  requestable(@CurrentActor() actor: RequestActor): Promise<{ items: RequestableBudget[] }> {
    return this.requests.requestable(actor);
  }

  @Get('route-preview')
  preview(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<RoutePreview> {
    return this.requests.previewRoute(actor, parseWith(RoutePreviewQuery, raw));
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RequestDetail> {
    const r = await this.requests.create(actor, parseWith(CreateRequestBody, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':requestId')
  get(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') raw: string,
  ): Promise<RequestDetail> {
    return this.requests.get(actor, parseWith(RequestIdParam, raw));
  }

  @Post(':requestId/submit')
  @HttpCode(200)
  async submit(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RequestDetail> {
    const r = await this.requests.submit(actor, parseWith(RequestIdParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':requestId/withdraw')
  @HttpCode(200)
  async withdraw(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RequestDetail> {
    const b = parseWith(WithdrawRequestBody, body ?? {});
    const r = await this.requests.withdraw(actor, parseWith(RequestIdParam, raw), b.reason, {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':requestId/resubmit')
  @HttpCode(200)
  async resubmit(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RequestDetail> {
    const r = await this.requests.resubmit(
      actor,
      parseWith(RequestIdParam, raw),
      parseWith(ResubmitRequestBody, body),
      {
        idempotencyKey,
        requestId,
      },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':requestId/accept-offer')
  @HttpCode(200)
  async acceptOffer(
    @CurrentActor() actor: RequestActor,
    @Param('requestId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RequestDetail> {
    const r = await this.requests.acceptCounterOffer(actor, parseWith(RequestIdParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
