import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AsOfQuery,
  CostCenterChangeRequest,
  CreateCostCenterRequest,
  CreateOrgUnitRequest,
  HeadcountImportRequest,
  OrgImportRequest,
  OrgUnitChangeRequest,
  PeopleQuery,
  ReportingLineChangeRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { CostCentersService } from './cost-centers.service';
import { HeadcountService } from './headcount.service';
import { OrgImportService } from './org-import.service';
import { OrgUnitsService } from './org-units.service';
import { PeopleService } from './people.service';

const Uuid = z.uuid();

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

function replayed<T>(res: ResponseLike, r: { replayed: boolean; body: T }): T {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
}

@Controller('api/org')
export class OrgController {
  constructor(
    private readonly units: OrgUnitsService,
    private readonly people: PeopleService,
    private readonly costCenters: CostCentersService,
    private readonly headcount: HeadcountService,
    private readonly imports: OrgImportService,
  ) {}

  @Get('units')
  listUnits(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.units.list(actor, parseWith(AsOfQuery, q).asOf);
  }

  @Get('units/:orgUnitId')
  getUnit(
    @CurrentActor() actor: RequestActor,
    @Param('orgUnitId') id: string,
    @Query() q: unknown,
  ) {
    return this.units.get(actor, parseWith(Uuid, id), parseWith(AsOfQuery, q).asOf);
  }

  @Post('units')
  @HttpCode(201)
  async createUnit(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateOrgUnitRequest, body);
    return replayed(res, await this.units.create(actor, req, { idempotencyKey, requestId }));
  }

  @Post('units/:orgUnitId/changes')
  @HttpCode(201)
  async changeUnit(
    @CurrentActor() actor: RequestActor,
    @Param('orgUnitId') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const unitId = parseWith(Uuid, id);
    const req = parseWith(OrgUnitChangeRequest, body);
    return replayed(
      res,
      await this.units.change(actor, unitId, req, { idempotencyKey, requestId }),
    );
  }

  @Get('people')
  listPeople(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.people.list(actor, parseWith(PeopleQuery, q));
  }

  @Get('people/:personId')
  getPerson(
    @CurrentActor() actor: RequestActor,
    @Param('personId') id: string,
    @Query() q: unknown,
  ) {
    return this.people.get(actor, parseWith(Uuid, id), parseWith(AsOfQuery, q).asOf);
  }

  @Post('people/:personId/reporting-lines')
  @HttpCode(201)
  async changeReportingLine(
    @CurrentActor() actor: RequestActor,
    @Param('personId') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const personId = parseWith(Uuid, id);
    const req = parseWith(ReportingLineChangeRequest, body);
    return replayed(
      res,
      await this.people.changeReportingLine(actor, personId, req, { idempotencyKey, requestId }),
    );
  }

  @Get('cost-centers')
  listCostCenters(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.costCenters.list(actor, parseWith(AsOfQuery, q).asOf);
  }

  @Post('cost-centers')
  @HttpCode(201)
  async createCostCenter(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateCostCenterRequest, body);
    return replayed(res, await this.costCenters.create(actor, req, { idempotencyKey, requestId }));
  }

  @Post('cost-centers/:costCenterId/changes')
  @HttpCode(201)
  async changeCostCenter(
    @CurrentActor() actor: RequestActor,
    @Param('costCenterId') id: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const ccId = parseWith(Uuid, id);
    const req = parseWith(CostCenterChangeRequest, body);
    return replayed(
      res,
      await this.costCenters.change(actor, ccId, req, { idempotencyKey, requestId }),
    );
  }

  @Get('headcount')
  headcountSummary(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.headcount.summary(actor, parseWith(AsOfQuery, q).asOf);
  }

  @Get('headcount/snapshots')
  headcountSnapshots(@CurrentActor() actor: RequestActor) {
    return this.headcount.snapshots(actor);
  }

  @Post('headcount/imports')
  @HttpCode(201)
  async importHeadcount(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(HeadcountImportRequest, body);
    return replayed(res, await this.headcount.import(actor, req, { idempotencyKey, requestId }));
  }

  @Post('imports')
  @HttpCode(201)
  async importOrg(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(OrgImportRequest, body);
    return replayed(res, await this.imports.run(actor, req, { idempotencyKey, requestId }));
  }
}
