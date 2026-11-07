import {
  CurrentActor,
  IdempotencyKey,
  RequestId,
  parseWith,
  type RequestActor,
} from '@bf/api/core';
import {
  AddScenarioChangeRequest,
  ApproveSummaryRequest,
  ArchiveScenarioRequest,
  CreateScenarioRequest,
  CreateWalletClaimRequest,
  DraftCommentaryRequest,
  DraftSummaryRequest,
  EditSummarySectionRequest,
  GiveRecognitionRequest,
  GrantRecognitionAllowanceRequest,
  PayWalletClaimRequest,
  PromoteScenarioRequest,
  RecognitionDecisionRequest,
  RedeemRecognitionRequest,
  RegenerateSectionRequest,
  SayThanksRequest,
  SubmitCommentaryRequest,
  UpsertRecognitionAwardTypeRequest,
  UpsertWalletProgramRequest,
  WalletClaimDecisionRequest,
} from '@bf/contracts';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { NarrativesService } from './narratives.service';
import { OutcomesService } from './outcomes.service';
import { RecognitionService } from './recognition.service';
import { ScenariosService } from './scenarios.service';
import type { CommandContext } from './support';
import { WalletsService } from './wallets.service';

const Uuid = z.uuid();
const SectionKey = z.enum(['headline', 'variances', 'risks', 'engagement']);
const ScenarioQuery = z
  .object({ status: z.enum(['draft', 'promoted', 'archived']).optional() })
  .strict();
const CompareQuery = z.object({ ids: z.string().max(200) }).strict();
const SummaryQuery = z
  .object({ status: z.enum(['ai_draft', 'edited', 'approved']).optional() })
  .strict();
const OutcomesQuery = z
  .object({ fiscalYearId: Uuid.optional(), regionOrgUnitId: Uuid.optional() })
  .strict();
const LeaderboardQuery = z
  .object({
    period: z.enum(['month', 'quarter', 'year']).optional(),
    locationOrgUnitId: Uuid.optional(),
  })
  .strict();
const ClaimQuery = z
  .object({
    status: z.enum(['submitted', 'approved', 'paid', 'returned', 'cancelled']).optional(),
    programId: Uuid.optional(),
  })
  .strict();
const FeedQuery = z.object({ scope: z.enum(['all', 'mine']).optional() }).strict();

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

/** What-if scenarios, drafted narratives, outcome analytics, wallets and recognition (Phase 15). */
@Controller('api')
export class ExtendedController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly narratives: NarrativesService,
    private readonly outcomes: OutcomesService,
    private readonly wallets: WalletsService,
    private readonly recognition: RecognitionService,
  ) {}

  // Scenarios (031a) ---------------------------------------------------------------------

  @Get('scenarios')
  listScenarios(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.scenarios.list(actor, parseWith(ScenarioQuery, query));
  }

  @Post('scenarios')
  async createScenario(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.scenarios.create(actor, parseWith(CreateScenarioRequest, body), ctx(key, rid)),
    );
  }

  /** `compare` is matched before `:scenarioId` so the literal path is not read as an id. */
  @Get('scenarios/compare')
  compareScenarios(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    const { ids } = parseWith(CompareQuery, query);
    return this.scenarios.compare(
      actor,
      ids
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => id(v)),
    );
  }

  @Get('scenarios/:scenarioId')
  getScenario(@CurrentActor() actor: RequestActor, @Param('scenarioId') scenarioId: string) {
    return this.scenarios.get(actor, id(scenarioId));
  }

  @Get('scenarios/:scenarioId/impact')
  getScenarioImpact(@CurrentActor() actor: RequestActor, @Param('scenarioId') scenarioId: string) {
    return this.scenarios.impact(actor, id(scenarioId));
  }

  @Post('scenarios/:scenarioId/changes')
  async addScenarioChange(
    @CurrentActor() actor: RequestActor,
    @Param('scenarioId') scenarioId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.scenarios.addChange(
        actor,
        id(scenarioId),
        parseWith(AddScenarioChangeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Delete('scenarios/:scenarioId/changes/:changeId')
  async removeScenarioChange(
    @CurrentActor() actor: RequestActor,
    @Param('scenarioId') scenarioId: string,
    @Param('changeId') changeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.scenarios.removeChange(actor, id(scenarioId), id(changeId), ctx(key, rid)),
    );
  }

  @Post('scenarios/:scenarioId/promote')
  async promoteScenario(
    @CurrentActor() actor: RequestActor,
    @Param('scenarioId') scenarioId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.scenarios.promote(
        actor,
        id(scenarioId),
        parseWith(PromoteScenarioRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('scenarios/:scenarioId/archive')
  async archiveScenario(
    @CurrentActor() actor: RequestActor,
    @Param('scenarioId') scenarioId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.scenarios.archive(
        actor,
        id(scenarioId),
        parseWith(ArchiveScenarioRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Insights: drafted narratives (011b) and analytics (015c, 122a) -----------------------

  @Get('insights/summaries')
  listSummaries(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.narratives.list(actor, parseWith(SummaryQuery, query));
  }

  @Post('insights/summaries')
  async draftSummary(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.draft(actor, parseWith(DraftSummaryRequest, body), ctx(key, rid)),
    );
  }

  @Get('insights/summaries/:summaryId')
  getSummary(@CurrentActor() actor: RequestActor, @Param('summaryId') summaryId: string) {
    return this.narratives.get(actor, id(summaryId));
  }

  @Put('insights/summaries/:summaryId/sections/:sectionKey')
  async editSummarySection(
    @CurrentActor() actor: RequestActor,
    @Param('summaryId') summaryId: string,
    @Param('sectionKey') sectionKey: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.editSection(
        actor,
        id(summaryId),
        parseWith(SectionKey, sectionKey),
        parseWith(EditSummarySectionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('insights/summaries/:summaryId/sections/:sectionKey/regenerate')
  async regenerateSummarySection(
    @CurrentActor() actor: RequestActor,
    @Param('summaryId') summaryId: string,
    @Param('sectionKey') sectionKey: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.regenerate(
        actor,
        id(summaryId),
        parseWith(SectionKey, sectionKey),
        parseWith(RegenerateSectionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('insights/summaries/:summaryId/approve')
  async approveSummary(
    @CurrentActor() actor: RequestActor,
    @Param('summaryId') summaryId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.approve(
        actor,
        id(summaryId),
        parseWith(ApproveSummaryRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('insights/commentary')
  async draftCommentary(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.draftCommentary(
        actor,
        parseWith(DraftCommentaryRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('insights/commentary/:commentaryId/submit')
  async submitCommentary(
    @CurrentActor() actor: RequestActor,
    @Param('commentaryId') commentaryId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.narratives.submitCommentary(
        actor,
        id(commentaryId),
        parseWith(SubmitCommentaryRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('insights/outcomes')
  getOutcomes(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.outcomes.linkage(actor, parseWith(OutcomesQuery, query));
  }

  @Get('insights/participation-leaderboard')
  getLeaderboard(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.outcomes.leaderboard(actor, parseWith(LeaderboardQuery, query));
  }

  // Wallets (120b) ------------------------------------------------------------------------

  @Get('wallets/programs')
  listWalletPrograms(@CurrentActor() actor: RequestActor) {
    return this.wallets.listPrograms(actor);
  }

  @Put('wallets/programs')
  async upsertWalletProgram(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.wallets.upsertProgram(
        actor,
        parseWith(UpsertWalletProgramRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('wallets/claims')
  listWalletClaims(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.wallets.listClaims(actor, parseWith(ClaimQuery, query));
  }

  @Post('wallets/claims')
  async createWalletClaim(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.wallets.createClaim(
        actor,
        parseWith(CreateWalletClaimRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('wallets/claims/:claimId/decision')
  async decideWalletClaim(
    @CurrentActor() actor: RequestActor,
    @Param('claimId') claimId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.wallets.decideClaim(
        actor,
        id(claimId),
        parseWith(WalletClaimDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('wallets/claims/:claimId/pay')
  async payWalletClaim(
    @CurrentActor() actor: RequestActor,
    @Param('claimId') claimId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.wallets.payClaim(
        actor,
        id(claimId),
        parseWith(PayWalletClaimRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('wallets')
  getMyWallets(@CurrentActor() actor: RequestActor) {
    return this.wallets.myWallets(actor);
  }

  // Recognition (120a, 122b) ---------------------------------------------------------------

  @Get('recognition')
  getRecognitionFeed(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.recognition.feed(actor, parseWith(FeedQuery, query));
  }

  @Put('recognition/award-types')
  async upsertAwardType(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.upsertAwardType(
        actor,
        parseWith(UpsertRecognitionAwardTypeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('recognition/allowances')
  async grantAllowance(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.grantAllowance(
        actor,
        parseWith(GrantRecognitionAllowanceRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('recognition/awards')
  async giveRecognition(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.give(actor, parseWith(GiveRecognitionRequest, body), ctx(key, rid)),
    );
  }

  @Post('recognition/awards/:awardId/decision')
  async decideRecognition(
    @CurrentActor() actor: RequestActor,
    @Param('awardId') awardId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.decide(
        actor,
        id(awardId),
        parseWith(RecognitionDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('recognition/awards/:awardId/redeem')
  async redeemRecognition(
    @CurrentActor() actor: RequestActor,
    @Param('awardId') awardId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.redeem(
        actor,
        id(awardId),
        parseWith(RedeemRecognitionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('recognition/thanks')
  async sayThanks(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.recognition.sayThanks(actor, parseWith(SayThanksRequest, body), ctx(key, rid)),
    );
  }

  @Get('recognition/organizers/:personId')
  getOrganizerRecognition(
    @CurrentActor() actor: RequestActor,
    @Param('personId') personId: string,
  ) {
    return this.recognition.organizer(actor, id(personId));
  }
}
