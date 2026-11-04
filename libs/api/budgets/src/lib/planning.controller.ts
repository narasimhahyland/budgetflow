import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  CreatePlanVersionRequest,
  PlanImportRequest,
  PlanVersionQuery,
  TieOutQuery,
  UpsertProgramTemplateRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { PlanningService } from './planning.service';

const Id = z.uuid();

@Controller('api/plan-versions')
export class PlanVersionsController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() rawQuery: unknown) {
    return this.planning.listVersions(actor, parseWith(PlanVersionQuery, rawQuery).fiscalYearId);
  }

  @Get('tie-out')
  tieOut(@CurrentActor() actor: RequestActor, @Query() rawQuery: unknown) {
    return this.planning.tieOut(actor, parseWith(TieOutQuery, rawQuery).fiscalYearId);
  }

  @Post('import')
  @HttpCode(200)
  import(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return this.planning.importPlan(actor, parseWith(PlanImportRequest, body), {
      idempotencyKey,
      requestId,
    });
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return (
      await this.planning.createVersion(actor, parseWith(CreatePlanVersionRequest, body), {
        idempotencyKey,
        requestId,
      })
    ).body;
  }

  @Get(':planVersionId')
  get(@CurrentActor() actor: RequestActor, @Param('planVersionId') rawId: string) {
    return this.planning.getVersion(actor, parseWith(Id, rawId));
  }

  @Post(':planVersionId/approve')
  @HttpCode(200)
  async approve(
    @CurrentActor() actor: RequestActor,
    @Param('planVersionId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
  ) {
    return (
      await this.planning.approveVersion(actor, parseWith(Id, rawId), { idempotencyKey, requestId })
    ).body;
  }

  @Post(':planVersionId/apply')
  @HttpCode(200)
  async apply(
    @CurrentActor() actor: RequestActor,
    @Param('planVersionId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
  ) {
    return (
      await this.planning.applyVersion(actor, parseWith(Id, rawId), { idempotencyKey, requestId })
    ).body;
  }
}

@Controller('api/program-templates')
export class ProgramTemplatesController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor) {
    return this.planning.listTemplates(actor);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return (
      await this.planning.upsertTemplate(
        actor,
        null,
        parseWith(UpsertProgramTemplateRequest, body),
        {
          idempotencyKey,
          requestId,
        },
      )
    ).body;
  }

  @Put(':templateId')
  async update(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    return (
      await this.planning.upsertTemplate(
        actor,
        parseWith(Id, rawId),
        parseWith(UpsertProgramTemplateRequest, body),
        { idempotencyKey, requestId },
      )
    ).body;
  }
}
