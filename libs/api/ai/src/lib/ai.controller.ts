import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AiEvaluationRunRequest,
  AiFeature,
  AiFeedbackRequest,
  AiMatchSuggestionRunRequest,
  AiSettings,
  AiSuggestionDecisionRequest,
  AiFeatureSwitchRequest,
  AllocationSuggestionRequest,
  AnomalyScanRequest,
  AskRequest,
  ExtractionRequest,
  OutlookRunRequest,
  PolicyExplainRequest,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { AiEvaluationsService } from './evals/evaluations.service';
import { AiAllocationService } from './features/allocation.service';
import { AiAnomalyService } from './features/anomaly.service';
import { AiAskService } from './features/ask.service';
import { AiExtractionService } from './features/extraction.service';
import { AiMatchingService } from './features/matching.service';
import { AiOutlookService } from './features/outlook.service';
import { AiPolicyAssistantService } from './features/policy-assistant.service';
import { AiQueryLogService } from './query-log.service';
import { AiSettingsService, type CommandContext } from './settings.service';
import { AiSuggestionsService } from './suggestions.service';

const Uuid = z.uuid();
const id = (v: string) => parseWith(Uuid, v);
const ctx = (idempotencyKey: string, requestId: string | null): CommandContext => ({
  idempotencyKey,
  requestId,
});

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

function replayed<T>(res: ResponseLike, r: { replayed: boolean; body: T }): T {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
}

const OutlookQuery = z
  .object({
    category: z.enum(['likely_overspend', 'likely_unused', 'on_track', 'no_history']).optional(),
    ownedOnly: z.coerce.boolean().optional(),
  })
  .strict();
const MatchQuery = z
  .object({ status: z.enum(['open', 'accepted', 'rejected', 'dismissed', 'stale']).optional() })
  .strict();
const FlagQuery = z
  .object({
    status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
    kind: z
      .enum([
        'possible_split',
        'possible_duplicate',
        'receipt_reused',
        'unusual_cost_per_head',
        'unusual_vendor',
      ])
      .optional(),
  })
  .strict();
const LogQuery = z
  .object({
    feature: AiFeature.optional(),
    outcome: z
      .enum([
        'answered',
        'suggested',
        'accepted',
        'dismissed',
        'rejected',
        'refused_out_of_scope',
        'refused_action',
        'discarded_unreliable',
        'disabled',
        'rate_limited',
        'failed',
      ])
      .optional(),
    suggestionId: Uuid.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

/**
 * The AI layer (011a, 016b, 017c, 022d, 061f, 069a, 080f, 113a, 121a). Nothing here posts to the
 * ledger, approves a request, moves budget or changes a control: the endpoints answer, suggest and
 * record what a person decided, and the work itself runs through the ordinary commands.
 */
@Controller('api/ai')
export class AiController {
  constructor(
    private readonly askService: AiAskService,
    private readonly policyAssistant: AiPolicyAssistantService,
    private readonly allocation: AiAllocationService,
    private readonly outlook: AiOutlookService,
    private readonly matching: AiMatchingService,
    private readonly anomalies: AiAnomalyService,
    private readonly extraction: AiExtractionService,
    private readonly suggestions: AiSuggestionsService,
    private readonly settings: AiSettingsService,
    private readonly log: AiQueryLogService,
    private readonly evaluations: AiEvaluationsService,
  ) {}

  @Post('ask')
  @HttpCode(200)
  ask(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.askService.ask(actor, parseWith(AskRequest, body));
  }

  @Get('conversations')
  conversations(@CurrentActor() actor: RequestActor) {
    return this.askService.conversations(actor);
  }

  @Get('conversations/:conversationId')
  conversation(@CurrentActor() actor: RequestActor, @Param('conversationId') cid: string) {
    return this.askService.conversation_(actor, id(cid));
  }

  @Delete('conversations/:conversationId')
  deleteConversation(
    @CurrentActor() actor: RequestActor,
    @Param('conversationId') cid: string,
    @IdempotencyKey() _key: string,
  ) {
    return this.askService.deleteConversation(actor, id(cid));
  }

  @Post('policy-explain')
  @HttpCode(200)
  explain(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.policyAssistant.explain(actor, parseWith(PolicyExplainRequest, body));
  }

  @Post('allocation-suggestion')
  @HttpCode(200)
  suggestAllocation(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.allocation.suggest(actor, parseWith(AllocationSuggestionRequest, body));
  }

  @Post('outlook/run')
  @HttpCode(200)
  runOutlook(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.outlook.run(actor, parseWith(OutlookRunRequest, body ?? {}));
  }

  @Get('outlook')
  listOutlook(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.outlook.list(actor, parseWith(OutlookQuery, query));
  }

  @Get('outlook/:budgetId')
  budgetOutlook(@CurrentActor() actor: RequestActor, @Param('budgetId') budgetId: string) {
    return this.outlook.forBudget(actor, id(budgetId));
  }

  @Post('matching-suggestions/run')
  @HttpCode(200)
  runMatching(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.matching.run(actor, parseWith(AiMatchSuggestionRunRequest, body ?? {}));
  }

  @Get('matching-suggestions')
  listMatching(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.matching.list(actor, parseWith(MatchQuery, query));
  }

  @Post('anomaly-flags/scan')
  @HttpCode(200)
  scanAnomalies(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.anomalies.scan(actor, parseWith(AnomalyScanRequest, body ?? {}));
  }

  @Get('anomaly-flags')
  listAnomalies(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.anomalies.list(actor, parseWith(FlagQuery, query));
  }

  @Post('extractions')
  @HttpCode(200)
  extract(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.extraction.extract(actor, parseWith(ExtractionRequest, body));
  }

  @Post('suggestions/:suggestionId/decision')
  @HttpCode(201)
  async decide(
    @CurrentActor() actor: RequestActor,
    @Param('suggestionId') suggestionId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.suggestions.decide(
        actor,
        id(suggestionId),
        parseWith(AiSuggestionDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('suggestions/:suggestionId/feedback')
  @HttpCode(200)
  rate(
    @CurrentActor() actor: RequestActor,
    @Param('suggestionId') suggestionId: string,
    @Body() body: unknown,
  ) {
    return this.suggestions.rateFor(actor, id(suggestionId), parseWith(AiFeedbackRequest, body));
  }

  @Get('settings')
  getSettings(@CurrentActor() actor: RequestActor) {
    return this.settings.view(actor);
  }

  @Put('settings')
  async updateSettings(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.updateSettings(actor, parseWith(AiSettings, body), ctx(key, rid)),
    );
  }

  @Post('features/:feature/switch')
  @HttpCode(201)
  async switchFeature(
    @CurrentActor() actor: RequestActor,
    @Param('feature') feature: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.switchFeature(
        actor,
        parseWith(AiFeature, feature),
        parseWith(AiFeatureSwitchRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('features/:feature/finance-confirmation')
  @HttpCode(201)
  async confirmFeature(
    @CurrentActor() actor: RequestActor,
    @Param('feature') feature: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.confirmFinanceFeature(
        actor,
        parseWith(AiFeature, feature),
        ctx(key, rid),
      ),
    );
  }

  @Get('query-log')
  queryLog(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.log.listFor(actor, parseWith(LogQuery, query));
  }

  @Post('evaluations/run')
  @HttpCode(200)
  runEvaluations(@CurrentActor() actor: RequestActor, @Body() body: unknown) {
    return this.evaluations.run(actor, parseWith(AiEvaluationRunRequest, body ?? {}).feature);
  }

  @Get('accuracy')
  accuracy(@CurrentActor() actor: RequestActor) {
    return this.evaluations.accuracy(actor);
  }
}
