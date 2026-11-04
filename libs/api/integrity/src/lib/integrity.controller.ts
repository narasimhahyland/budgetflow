import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import { Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { z } from 'zod';
import { IntegrityService } from './integrity.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Controller('api/integrity/ledger-checks')
export class IntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  @Post()
  @HttpCode(202)
  async request(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const r = await this.integrity.request(actor, { idempotencyKey, requestId });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':checkId')
  get(@CurrentActor() actor: RequestActor, @Param('checkId') rawId: string) {
    return this.integrity.get(actor, parseWith(z.uuid(), rawId));
  }
}
