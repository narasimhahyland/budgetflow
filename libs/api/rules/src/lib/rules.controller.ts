import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  ApproveDoaVersionRequest,
  BacktestRequest,
  CreateRuleRequest,
  ExceptionListQuery,
  PublishRuleRequest,
  ReorderRulesRequest,
  ResolveExceptionRequest,
  RestoreRuleVersionRequest,
  RetireRuleRequest,
  RuleListQuery,
  SaveDoaDraftRequest,
  SaveWorkflowRouteRequest,
  SingleSimulationRequest,
  TestWorkflowRouteRequest,
  UpdatePolicySectionRequest,
  UpdateRuleDraftRequest,
  UpdateThresholdTableRequest,
  type BacktestResponse,
  type DoaMatrixAdminView,
  type PolicyConfigsBundle,
  type PostSpendExceptionItem,
  type PostSpendExceptionList,
  type RuleDetail,
  type RuleList,
  type RulesDashboard,
  type RuleVersionDiff,
  type SingleSimulationResponse,
  type TemplatesAndThresholdsView,
  type TestWorkflowRouteResponse,
  type WorkflowRouteList,
  type WorkflowRouteView,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { DoaAdminService } from './doa-admin.service';
import { ExceptionsService } from './exceptions.service';
import { PolicyConfigService } from './policy-config.service';
import { RuleSimulationService } from './rule-simulation.service';
import { RulesService } from './rules.service';
import { WorkflowTestService } from './workflow-test.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const RuleId = z.uuid();
const DiffQuery = z
  .object({
    fromVersion: z.coerce.number().int().min(1).optional(),
    toVersion: z.coerce.number().int().min(1).optional(),
  })
  .strict();
const DoaQuery = z.object({ versionId: z.uuid().optional() }).strict();

@Controller('api/rules')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly simulation: RuleSimulationService,
    private readonly configs: PolicyConfigService,
    private readonly routeTest: WorkflowTestService,
    private readonly doa: DoaAdminService,
    private readonly exceptions: ExceptionsService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentActor() actor: RequestActor): Promise<RulesDashboard> {
    return this.rules.dashboard(actor);
  }

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<RuleList> {
    return this.rules.list(actor, parseWith(RuleListQuery, raw));
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleDetail> {
    const r = await this.rules.create(actor, parseWith(CreateRuleRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('reorder')
  @HttpCode(200)
  async reorder(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleList> {
    const r = await this.rules.reorder(actor, parseWith(ReorderRulesRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('simulate')
  @HttpCode(200)
  simulate(
    @CurrentActor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<SingleSimulationResponse> {
    return this.simulation.simulate(actor, parseWith(SingleSimulationRequest, body));
  }

  @Post('backtest')
  @HttpCode(200)
  backtest(@CurrentActor() actor: RequestActor, @Body() body: unknown): Promise<BacktestResponse> {
    return this.simulation.backtest(actor, parseWith(BacktestRequest, body));
  }

  @Get('templates-thresholds')
  templates(@CurrentActor() actor: RequestActor): Promise<TemplatesAndThresholdsView> {
    return this.configs.templatesAndThresholds(actor);
  }

  @Put('templates-thresholds')
  @HttpCode(200)
  async updateThresholds(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<TemplatesAndThresholdsView> {
    const r = await this.configs.updateThresholdTable(
      actor,
      parseWith(UpdateThresholdTableRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('routing')
  routes(@CurrentActor() actor: RequestActor): Promise<WorkflowRouteList> {
    return this.configs.listRoutes(actor);
  }

  @Put('routing')
  @HttpCode(200)
  async saveRoute(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WorkflowRouteView> {
    const r = await this.configs.saveRoute(actor, parseWith(SaveWorkflowRouteRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('routing/test')
  @HttpCode(200)
  testRoute(
    @CurrentActor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<TestWorkflowRouteResponse> {
    return this.routeTest.test(actor, parseWith(TestWorkflowRouteRequest, body));
  }

  @Get('doa-admin')
  doaAdmin(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<DoaMatrixAdminView> {
    return this.doa.view(actor, parseWith(DoaQuery, raw).versionId);
  }

  @Put('doa-admin')
  @HttpCode(200)
  async saveDoa(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DoaMatrixAdminView> {
    const r = await this.doa.saveDraft(actor, parseWith(SaveDoaDraftRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('doa-admin/approve')
  @HttpCode(200)
  async approveDoa(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DoaMatrixAdminView> {
    const r = await this.doa.approve(actor, parseWith(ApproveDoaVersionRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('policies')
  policies(@CurrentActor() actor: RequestActor): Promise<PolicyConfigsBundle> {
    return this.configs.policyConfigs(actor);
  }

  @Put('policies')
  @HttpCode(200)
  async updatePolicies(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<PolicyConfigsBundle> {
    const r = await this.configs.updatePolicyConfig(
      actor,
      parseWith(UpdatePolicySectionRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('exceptions')
  exceptionList(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<PostSpendExceptionList> {
    return this.exceptions.list(actor, parseWith(ExceptionListQuery, raw));
  }

  @Post('exceptions/:exceptionId/resolve')
  @HttpCode(200)
  async resolveException(
    @CurrentActor() actor: RequestActor,
    @Param('exceptionId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<PostSpendExceptionItem> {
    const r = await this.exceptions.resolve(
      actor,
      parseWith(RuleId, rawId),
      parseWith(ResolveExceptionRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Parameterised routes come last so they never shadow the fixed paths above.

  @Get(':ruleId')
  get(@CurrentActor() actor: RequestActor, @Param('ruleId') raw: string): Promise<RuleDetail> {
    return this.rules.get(actor, parseWith(RuleId, raw));
  }

  @Get(':ruleId/diff')
  diff(
    @CurrentActor() actor: RequestActor,
    @Param('ruleId') raw: string,
    @Query() rawQuery: unknown,
  ): Promise<RuleVersionDiff> {
    return this.rules.diff(actor, parseWith(RuleId, raw), parseWith(DiffQuery, rawQuery));
  }

  @Put(':ruleId/draft')
  @HttpCode(200)
  async updateDraft(
    @CurrentActor() actor: RequestActor,
    @Param('ruleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleDetail> {
    const r = await this.rules.updateDraft(
      actor,
      parseWith(RuleId, raw),
      parseWith(UpdateRuleDraftRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':ruleId/publish')
  @HttpCode(200)
  async publish(
    @CurrentActor() actor: RequestActor,
    @Param('ruleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleDetail> {
    const r = await this.rules.publish(
      actor,
      parseWith(RuleId, raw),
      parseWith(PublishRuleRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':ruleId/retire')
  @HttpCode(200)
  async retire(
    @CurrentActor() actor: RequestActor,
    @Param('ruleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleDetail> {
    const r = await this.rules.retire(
      actor,
      parseWith(RuleId, raw),
      parseWith(RetireRuleRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':ruleId/restore')
  @HttpCode(200)
  async restore(
    @CurrentActor() actor: RequestActor,
    @Param('ruleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RuleDetail> {
    const r = await this.rules.restore(
      actor,
      parseWith(RuleId, raw),
      parseWith(RestoreRuleVersionRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
