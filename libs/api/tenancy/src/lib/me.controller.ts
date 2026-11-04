import { CurrentActor, PolicyService, type RequestActor } from '@bf/api/core';
import type { MeResponse } from '@bf/contracts';
import { Controller, Get, Module } from '@nestjs/common';
import type { z } from 'zod';

@Controller('api/me')
export class MeController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  me(@CurrentActor() actor: RequestActor): z.infer<typeof MeResponse> {
    this.policy.assert(actor, 'tenant.read', { kind: 'tenant', tenantId: actor.tenantId });
    return {
      subject: actor.subject,
      tenantId: actor.tenantId,
      tenantName: actor.tenantName,
      reportingCurrency: actor.reportingCurrency,
      personId: actor.personId,
      displayName: actor.displayName,
      roles: [...actor.roles],
      memberships: actor.memberships,
    };
  }
}

/** Identity endpoints for the signed-in user (Phase 2 adds tenant and org switching on top). */
@Module({ controllers: [MeController] })
export class TenancyApiModule {}
