import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AddFiscalYearRequest,
  CreateExchangeRateRequest,
  CreateFiscalCalendarRequest,
  CreateGlAccountRequest,
  CreateGlMappingRequest,
  CreateLegalEntityRequest,
  CreateReasonCodeRequest,
  CreateVendorRequest,
  DoaLookupQuery,
  GlAccountQuery,
  GlMappingQuery,
  PeriodStatusChangeRequest,
  PlanRateLockRequest,
  PreviewFiscalCalendarRequest,
  RateLookupQuery,
  RatesQuery,
  ReasonCodeQuery,
  UpdateLegalEntityRequest,
  UpdateReasonCodeRequest,
  UpdateVendorRequest,
  VendorQuery,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { CalendarsService } from './calendars.service';
import { DoaService } from './doa.service';
import type { CommandContext } from './finance-base';
import { GlService } from './gl.service';
import { LegalEntitiesService } from './legal-entities.service';
import { RatesService } from './rates.service';
import { ReferenceDataService } from './reference-data.service';

const Uuid = z.uuid();

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

@Controller('api/finance')
export class FinanceController {
  constructor(
    private readonly entities: LegalEntitiesService,
    private readonly calendars: CalendarsService,
    private readonly rates: RatesService,
    private readonly gl: GlService,
    private readonly reference: ReferenceDataService,
    private readonly doa: DoaService,
  ) {}

  @Get('legal-entities')
  listLegalEntities(@CurrentActor() actor: RequestActor) {
    return this.entities.list(actor);
  }

  @Post('legal-entities')
  @HttpCode(201)
  async createLegalEntity(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateLegalEntityRequest, body);
    return replayed(res, await this.entities.create(actor, req, ctx(key, requestId)));
  }

  @Patch('legal-entities/:legalEntityId')
  async updateLegalEntity(
    @CurrentActor() actor: RequestActor,
    @Param('legalEntityId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const entityId = parseWith(Uuid, id);
    const req = parseWith(UpdateLegalEntityRequest, body);
    return replayed(res, await this.entities.update(actor, entityId, req, ctx(key, requestId)));
  }

  @Get('fiscal-calendars')
  listCalendars(@CurrentActor() actor: RequestActor) {
    return this.calendars.list(actor);
  }

  @Post('fiscal-calendars/preview')
  @HttpCode(200)
  previewCalendar(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.calendars.preview(actor, parseWith(PreviewFiscalCalendarRequest, body));
  }

  @Get('fiscal-calendars/:calendarId')
  getCalendar(@CurrentActor() actor: RequestActor, @Param('calendarId') id: string) {
    return this.calendars.get(actor, parseWith(Uuid, id));
  }

  @Post('fiscal-calendars')
  @HttpCode(201)
  async createCalendar(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateFiscalCalendarRequest, body);
    return replayed(res, await this.calendars.create(actor, req, ctx(key, requestId)));
  }

  @Post('fiscal-calendars/:calendarId/years')
  @HttpCode(201)
  async addYear(
    @CurrentActor() actor: RequestActor,
    @Param('calendarId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const calendarId = parseWith(Uuid, id);
    const req = parseWith(AddFiscalYearRequest, body);
    return replayed(res, await this.calendars.addYear(actor, calendarId, req, ctx(key, requestId)));
  }

  @Post('fiscal-periods/:periodId/status')
  @HttpCode(201)
  async changePeriodStatus(
    @CurrentActor() actor: RequestActor,
    @Param('periodId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const periodId = parseWith(Uuid, id);
    const req = parseWith(PeriodStatusChangeRequest, body);
    return replayed(
      res,
      await this.calendars.changePeriodStatus(actor, periodId, req, ctx(key, requestId)),
    );
  }

  @Post('fiscal-years/:fiscalYearId/plan-rate-lock')
  @HttpCode(201)
  async lockPlanRates(
    @CurrentActor() actor: RequestActor,
    @Param('fiscalYearId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const fyId = parseWith(Uuid, id);
    const req = parseWith(PlanRateLockRequest, body);
    return replayed(res, await this.calendars.lockPlanRates(actor, fyId, req, ctx(key, requestId)));
  }

  @Get('currencies')
  currencies(@CurrentActor() actor: RequestActor) {
    return this.rates.currencies(actor);
  }

  @Get('exchange-rates/lookup')
  lookupRate(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.rates.lookup(actor, parseWith(RateLookupQuery, q));
  }

  @Get('exchange-rates')
  listRates(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.rates.list(actor, parseWith(RatesQuery, q));
  }

  @Post('exchange-rates')
  @HttpCode(201)
  async createRate(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateExchangeRateRequest, body);
    return replayed(res, await this.rates.create(actor, req, ctx(key, requestId)));
  }

  @Get('gl-accounts')
  glAccounts(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.gl.accounts(actor, parseWith(GlAccountQuery, q).legalEntityId);
  }

  @Post('gl-accounts')
  @HttpCode(201)
  async createGlAccount(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateGlAccountRequest, body);
    return replayed(res, await this.gl.createAccount(actor, req, ctx(key, requestId)));
  }

  @Get('gl-mappings')
  glMappings(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.gl.mappings(actor, parseWith(GlMappingQuery, q));
  }

  @Post('gl-mappings')
  @HttpCode(201)
  async createGlMapping(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateGlMappingRequest, body);
    return replayed(res, await this.gl.createMapping(actor, req, ctx(key, requestId)));
  }

  @Get('categories')
  categories(@CurrentActor() actor: RequestActor) {
    return this.gl.categories(actor);
  }

  @Get('reason-codes')
  reasonCodes(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.reference.reasonCodes(actor, parseWith(ReasonCodeQuery, q));
  }

  @Post('reason-codes')
  @HttpCode(201)
  async createReasonCode(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateReasonCodeRequest, body);
    return replayed(res, await this.reference.createReasonCode(actor, req, ctx(key, requestId)));
  }

  @Patch('reason-codes/:reasonCodeId')
  async updateReasonCode(
    @CurrentActor() actor: RequestActor,
    @Param('reasonCodeId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const codeId = parseWith(Uuid, id);
    const req = parseWith(UpdateReasonCodeRequest, body);
    return replayed(
      res,
      await this.reference.updateReasonCode(actor, codeId, req, ctx(key, requestId)),
    );
  }

  @Get('vendors')
  vendors(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.reference.vendors(actor, parseWith(VendorQuery, q));
  }

  @Post('vendors')
  @HttpCode(201)
  async createVendor(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(CreateVendorRequest, body);
    return replayed(res, await this.reference.createVendor(actor, req, ctx(key, requestId)));
  }

  @Patch('vendors/:vendorId')
  async updateVendor(
    @CurrentActor() actor: RequestActor,
    @Param('vendorId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const vendorId = parseWith(Uuid, id);
    const req = parseWith(UpdateVendorRequest, body);
    return replayed(
      res,
      await this.reference.updateVendor(actor, vendorId, req, ctx(key, requestId)),
    );
  }

  @Get('doa')
  doaMatrix(@CurrentActor() actor: RequestActor) {
    return this.doa.matrix(actor);
  }

  @Get('doa/lookup')
  doaLookup(@CurrentActor() actor: RequestActor, @Query() q: unknown) {
    return this.doa.lookup(actor, parseWith(DoaLookupQuery, q));
  }
}
