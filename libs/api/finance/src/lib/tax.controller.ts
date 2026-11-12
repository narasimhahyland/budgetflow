import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  BenefitLedgerQuery,
  BenefitThresholdInput,
  PublishVersionRequest,
  RecordBenefitRequest,
  ReturnVersionRequest,
  ReverseBenefitRequest,
  SaveTaxRulesRequest,
  TaxPreviewQuery,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { BenefitsService } from './benefits.service';
import type { CommandContext } from './finance-base';
import { TaxService } from './tax.service';

const Uuid = z.uuid();
const AsOf = z.object({ asOf: z.iso.date().optional() }).strict();

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

/** Gap B3: tax recoverability rules (080g) and the employee benefit ledger (080h). Thin: parse, call one service. */
@Controller('api/finance')
export class TaxController {
  constructor(
    private readonly tax: TaxService,
    private readonly benefits: BenefitsService,
  ) {}

  @Get('tax-rules')
  rules(@CurrentActor() actor: RequestActor) {
    return this.tax.view(actor);
  }

  @Get('tax-rules/preview')
  preview(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.tax.preview(actor, parseWith(TaxPreviewQuery, query));
  }

  @Post('tax-rules/drafts')
  @HttpCode(201)
  async createDraft(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.tax.createDraft(actor, ctx(key, requestId)));
  }

  @Put('tax-rules/drafts/:ruleSetId')
  async saveDraft(
    @CurrentActor() actor: RequestActor,
    @Param('ruleSetId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.tax.saveDraft(
        actor,
        parseWith(Uuid, id),
        parseWith(SaveTaxRulesRequest, body),
        ctx(key, requestId),
      ),
    );
  }

  @Post('tax-rules/drafts/:ruleSetId/submit')
  @HttpCode(200)
  async submit(
    @CurrentActor() actor: RequestActor,
    @Param('ruleSetId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.tax.submit(actor, parseWith(Uuid, id), ctx(key, requestId)));
  }

  @Post('tax-rules/drafts/:ruleSetId/publish')
  @HttpCode(200)
  async publish(
    @CurrentActor() actor: RequestActor,
    @Param('ruleSetId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(PublishVersionRequest, body);
    return replayed(
      res,
      await this.tax.publish(actor, parseWith(Uuid, id), req.effectiveFrom, ctx(key, requestId)),
    );
  }

  @Post('tax-rules/drafts/:ruleSetId/return')
  @HttpCode(200)
  async returnDraft(
    @CurrentActor() actor: RequestActor,
    @Param('ruleSetId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(ReturnVersionRequest, body);
    return replayed(
      res,
      await this.tax.returnDraft(actor, parseWith(Uuid, id), req.comment, ctx(key, requestId)),
    );
  }

  @Get('benefits/ledger')
  ledger(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.benefits.ledger(actor, parseWith(BenefitLedgerQuery, query));
  }

  @Get('benefits/people/:personId')
  person(
    @CurrentActor() actor: RequestActor,
    @Param('personId') id: string,
    @Query() query: unknown,
  ) {
    return this.benefits.person(actor, parseWith(Uuid, id), parseWith(AsOf, query).asOf);
  }

  @Post('benefits/entries')
  @HttpCode(201)
  async record(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.benefits.recordManual(
        actor,
        parseWith(RecordBenefitRequest, body),
        ctx(key, requestId),
      ),
    );
  }

  @Post('benefits/entries/:entryId/reverse')
  @HttpCode(201)
  async reverse(
    @CurrentActor() actor: RequestActor,
    @Param('entryId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(ReverseBenefitRequest, body);
    return replayed(
      res,
      await this.benefits.reverse(actor, parseWith(Uuid, id), req.reason, ctx(key, requestId)),
    );
  }

  @Get('benefits/thresholds')
  thresholds(@CurrentActor() actor: RequestActor) {
    return this.benefits.thresholds(actor);
  }

  @Post('benefits/thresholds')
  @HttpCode(201)
  async createThreshold(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.benefits.createThreshold(
        actor,
        parseWith(BenefitThresholdInput, body),
        ctx(key, requestId),
      ),
    );
  }

  @Put('benefits/thresholds/:thresholdId')
  async updateThreshold(
    @CurrentActor() actor: RequestActor,
    @Param('thresholdId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.benefits.updateThreshold(
        actor,
        parseWith(Uuid, id),
        parseWith(BenefitThresholdInput, body),
        ctx(key, requestId),
      ),
    );
  }

  @Post('benefits/thresholds/:thresholdId/submit')
  @HttpCode(200)
  async submitThreshold(
    @CurrentActor() actor: RequestActor,
    @Param('thresholdId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.benefits.decideThreshold(
        actor,
        parseWith(Uuid, id),
        'submit',
        {},
        ctx(key, requestId),
      ),
    );
  }

  @Post('benefits/thresholds/:thresholdId/publish')
  @HttpCode(200)
  async publishThreshold(
    @CurrentActor() actor: RequestActor,
    @Param('thresholdId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(PublishVersionRequest, body);
    return replayed(
      res,
      await this.benefits.decideThreshold(
        actor,
        parseWith(Uuid, id),
        'publish',
        req,
        ctx(key, requestId),
      ),
    );
  }

  @Post('benefits/thresholds/:thresholdId/return')
  @HttpCode(200)
  async returnThreshold(
    @CurrentActor() actor: RequestActor,
    @Param('thresholdId') id: string,
    @IdempotencyKey() key: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const req = parseWith(ReturnVersionRequest, body);
    return replayed(
      res,
      await this.benefits.decideThreshold(
        actor,
        parseWith(Uuid, id),
        'return',
        req,
        ctx(key, requestId),
      ),
    );
  }
}
