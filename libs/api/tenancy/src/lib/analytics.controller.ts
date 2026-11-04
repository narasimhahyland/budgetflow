import { CurrentActor, parseWith, PolicyService, type RequestActor } from '@bf/api/core';
import { RecordAnalyticsRequest, type RecordAnalyticsResponse } from '@bf/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(
    private readonly policy: PolicyService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Retry-safe by event id rather than an Idempotency-Key: telemetry, not a business change, so no audit entry. */
  @Post('events')
  @HttpCode(202)
  async record(
    @CurrentActor() actor: RequestActor,
    @Body() raw: unknown,
  ): Promise<RecordAnalyticsResponse> {
    const body = parseWith(RecordAnalyticsRequest, raw);
    this.policy.assert(actor, 'tenant.read', { kind: 'tenant', tenantId: actor.tenantId });
    return this.analytics.record(actor, body);
  }
}
