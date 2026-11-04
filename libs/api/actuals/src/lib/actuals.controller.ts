import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AccrualsQuery,
  ActualsQuery,
  AsOfRequest,
  CancelCommitmentRequest,
  CloseEventRequest,
  CommitmentsQuery,
  CreateMappingRuleRequest,
  CreateOverBudgetRequest,
  CreateTieOutRequest,
  ExcludeActualRequest,
  ExplainTieOutLineRequest,
  MatchActualRequest,
  OverBudgetDecisionRequest,
  RejectAccrualRequest,
  ReleaseCommitmentRequest,
  SignOffTieOutRequest,
  TieOutQuery,
  UnmatchActualRequest,
  UpdateMappingRuleRequest,
  UploadActualsImportRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { AccrualsService } from './accruals.service';
import type { CommandContext } from './actuals-reads';
import { CommitmentsService } from './commitments.service';
import { EventsCloseService } from './events.service';
import { ImportsService } from './imports.service';
import { QueueService } from './queue.service';
import { RulesService } from './rules.service';
import { TieOutService } from './tieout.service';

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
const id = (v: string) => parseWith(Uuid, v);

/** Actuals and accounting: imports, the unmatched queue, matching, mapping rules, hygiene, accruals, prepaids, GL tie-out, event close. */
@Controller('api/actuals')
export class ActualsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly queue: QueueService,
    private readonly rules: RulesService,
    private readonly commitments: CommitmentsService,
    private readonly accruals: AccrualsService,
    private readonly tieouts: TieOutService,
    private readonly eventsClose: EventsCloseService,
  ) {}

  // Imports
  @Post('imports')
  @HttpCode(201)
  async upload(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.imports.upload(actor, parseWith(UploadActualsImportRequest, body), ctx(key, rid)),
    );
  }

  @Get('imports')
  listImports(@CurrentActor() actor: RequestActor) {
    return this.imports.list(actor);
  }

  @Get('imports/:batchId')
  getImport(@CurrentActor() actor: RequestActor, @Param('batchId') batchId: string) {
    return this.imports.get(actor, id(batchId));
  }

  @Post('imports/:batchId/post')
  @HttpCode(200)
  async postImport(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('batchId') batchId: string,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.imports.post(actor, id(batchId), ctx(key, rid)));
  }

  // Mapping rules (before :actualId routes)
  @Get('mapping-rules')
  listRules(@CurrentActor() actor: RequestActor) {
    return this.rules.list(actor);
  }

  @Post('mapping-rules')
  @HttpCode(201)
  async createRule(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.rules.create(actor, parseWith(CreateMappingRuleRequest, body), ctx(key, rid)),
    );
  }

  @Patch('mapping-rules/:ruleId')
  async updateRule(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.rules.update(
        actor,
        id(ruleId),
        parseWith(UpdateMappingRuleRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Commitment hygiene
  @Get('commitments')
  listCommitments(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.commitments.list(actor, parseWith(CommitmentsQuery, query));
  }

  @Post('commitments/:commitmentId/release')
  @HttpCode(200)
  async release(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('commitmentId') cid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.commitments.release(
        actor,
        id(cid),
        parseWith(ReleaseCommitmentRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('commitments/:commitmentId/cancellation')
  @HttpCode(200)
  async cancel(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('commitmentId') cid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.commitments.cancel(
        actor,
        id(cid),
        parseWith(CancelCommitmentRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Accruals and prepaids
  @Get('accruals')
  listAccruals(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.accruals.list(actor, parseWith(AccrualsQuery, query));
  }

  @Post('accruals/proposals')
  @HttpCode(201)
  async propose(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.accruals.propose(actor, parseWith(AsOfRequest, body), ctx(key, rid)),
    );
  }

  @Post('accruals/auto-reversals')
  @HttpCode(200)
  async autoReverse(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.accruals.reverseDue(actor, parseWith(AsOfRequest, body), ctx(key, rid)),
    );
  }

  @Post('accruals/exports')
  @HttpCode(200)
  async exportAccruals(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.accruals.export(actor, ctx(key, rid)));
  }

  @Post('accruals/:accrualId/approval')
  @HttpCode(200)
  async approveAccrual(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('accrualId') aid: string,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(res, await this.accruals.approve(actor, id(aid), ctx(key, rid)));
  }

  @Post('accruals/:accrualId/rejection')
  @HttpCode(200)
  async rejectAccrual(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('accrualId') aid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.accruals.reject(
        actor,
        id(aid),
        parseWith(RejectAccrualRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('prepaids')
  listPrepaids(@CurrentActor() actor: RequestActor) {
    return this.accruals.listPrepaids(actor);
  }

  @Post('prepaids/recognitions')
  @HttpCode(200)
  async recognize(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.accruals.recognize(actor, parseWith(AsOfRequest, body), ctx(key, rid)),
    );
  }

  // GL tie-out
  @Get('tie-outs')
  listTieOuts(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.tieouts.list(actor, parseWith(TieOutQuery, query));
  }

  @Post('tie-outs')
  @HttpCode(201)
  async createTieOut(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.tieouts.create(actor, parseWith(CreateTieOutRequest, body), ctx(key, rid)),
    );
  }

  @Get('tie-outs/:tieOutId')
  getTieOut(@CurrentActor() actor: RequestActor, @Param('tieOutId') tid: string) {
    return this.tieouts.get(actor, id(tid));
  }

  @Get('tie-outs/:tieOutId/export')
  exportTieOut(@CurrentActor() actor: RequestActor, @Param('tieOutId') tid: string) {
    return this.tieouts.export(actor, id(tid));
  }

  @Get('tie-outs/:tieOutId/lines/:lineId')
  getTieOutLine(
    @CurrentActor() actor: RequestActor,
    @Param('tieOutId') tid: string,
    @Param('lineId') lid: string,
  ) {
    return this.tieouts.line(actor, id(tid), id(lid));
  }

  @Post('tie-outs/:tieOutId/lines/:lineId/explanation')
  @HttpCode(200)
  async explain(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('tieOutId') tid: string,
    @Param('lineId') lid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.tieouts.explain(
        actor,
        id(tid),
        id(lid),
        parseWith(ExplainTieOutLineRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('tie-outs/:tieOutId/sign-off')
  @HttpCode(200)
  async signOff(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('tieOutId') tid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.tieouts.signOff(
        actor,
        id(tid),
        parseWith(SignOffTieOutRequest, body ?? {}),
        ctx(key, rid),
      ),
    );
  }

  // Events
  @Get('events')
  listEvents(@CurrentActor() actor: RequestActor) {
    return this.eventsClose.list(actor);
  }

  @Get('events/:eventId/reconciliation')
  getEvent(@CurrentActor() actor: RequestActor, @Param('eventId') eid: string) {
    return this.eventsClose.get(actor, id(eid));
  }

  @Post('events/:eventId/close')
  @HttpCode(200)
  async closeEvent(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('eventId') eid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.eventsClose.close(
        actor,
        id(eid),
        parseWith(CloseEventRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Over-budget requests
  @Post('over-budget-requests/:requestId/decision')
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('requestId') reqId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.queue.decideOverBudget(
        actor,
        id(reqId),
        parseWith(OverBudgetDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Actual lines (parameterized routes last)
  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.queue.list(actor, parseWith(ActualsQuery, query));
  }

  @Get(':actualId')
  get(@CurrentActor() actor: RequestActor, @Param('actualId') aid: string) {
    return this.queue.get(actor, id(aid));
  }

  @Post(':actualId/matches')
  @HttpCode(201)
  async match(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('actualId') aid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.queue.match(actor, id(aid), parseWith(MatchActualRequest, body), ctx(key, rid)),
    );
  }

  @Post(':actualId/exclusion')
  @HttpCode(200)
  async exclude(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('actualId') aid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.queue.exclude(
        actor,
        id(aid),
        parseWith(ExcludeActualRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post(':actualId/reversals')
  @HttpCode(200)
  async unmatch(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('actualId') aid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.queue.unmatch(
        actor,
        id(aid),
        parseWith(UnmatchActualRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post(':actualId/over-budget-requests')
  @HttpCode(201)
  async requestOverBudget(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('actualId') aid: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.queue.requestOverBudget(
        actor,
        id(aid),
        parseWith(CreateOverBudgetRequest, body),
        ctx(key, rid),
      ),
    );
  }
}
