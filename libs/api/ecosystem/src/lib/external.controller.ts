import {
  ApiProblem,
  IdempotencyKey,
  Public,
  RequestId,
  header,
  parseWith,
  type ApiRequest,
} from '@bf/api/core';
import {
  AutomationDraftRequestBody,
  BiDataset,
  McpToolCallRequest,
  type AutomationBalanceResult,
  type AutomationDraftRequestResult,
  type BiFeedPage,
  type McpToolCallResult,
  type McpToolListResult,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AssistantConnectorService } from './assistants.service';
import { AutomationConnectorService } from './automations.service';
import { BiConnectorService } from './bi.service';
import { EcosystemConnectionsService, type ConnectionIdentity } from './connections.service';

const UuidParam = z.uuid();
const FeedQuery = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict();

/**
 * Everything an outside tool calls directly. Authentication is a connection token rather than a
 * session, but the identity behind it is still a person: `authenticate` resolves their current roles
 * and owned budgets, so these routes are no wider than the app is for them.
 *
 * The routes are `@Public` only in the sense that the session guard does not run; each handler
 * authenticates its own token first and `PolicyService` still decides every record.
 */
@Controller()
export class EcosystemExternalController {
  constructor(
    private readonly connections: EcosystemConnectionsService,
    private readonly bi: BiConnectorService,
    private readonly assistants: AssistantConnectorService,
    private readonly automations: AutomationConnectorService,
  ) {}

  // BI feed (092a) ---------------------------------------------------------------------------------

  @Public()
  @Get('api/bi/v1/:dataset')
  async readFeed(
    @Req() req: ApiRequest,
    @Param('dataset') dataset: string,
    @Query() raw: unknown,
  ): Promise<BiFeedPage> {
    const identity = await this.identify(req, 'bi');
    const q = parseWith(FeedQuery, raw);
    return this.bi.feed(identity, parseWith(BiDataset, dataset), q);
  }

  // Model Context Protocol (092c) ---------------------------------------------------------------------

  @Public()
  @Post('api/mcp/v1/tools/list')
  @HttpCode(200)
  async listTools(@Req() req: ApiRequest): Promise<McpToolListResult> {
    return this.assistants.tools(await this.identify(req, 'assistant'));
  }

  @Public()
  @Post('api/mcp/v1/tools/call')
  @HttpCode(200)
  async callTool(@Req() req: ApiRequest, @Body() body: unknown): Promise<McpToolCallResult> {
    const identity = await this.identify(req, 'assistant');
    return this.assistants.call(identity, parseWith(McpToolCallRequest, body));
  }

  // No-code automation actions (092b) --------------------------------------------------------------------

  @Public()
  @Get('api/automation/v1/budgets/:budgetId/balance')
  async readBalance(
    @Req() req: ApiRequest,
    @Param('budgetId') budgetId: string,
  ): Promise<AutomationBalanceResult> {
    const identity = await this.identify(req, 'automation');
    return this.automations.balance(identity, parseWith(UuidParam, budgetId));
  }

  @Public()
  @Post('api/automation/v1/requests/drafts')
  @HttpCode(201)
  async createDraft(
    @Req() req: ApiRequest,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<AutomationDraftRequestResult> {
    const identity = await this.identify(req, 'automation');
    return this.automations.draftRequest(identity, parseWith(AutomationDraftRequestBody, body), {
      idempotencyKey,
      requestId,
    });
  }

  private identify(
    req: ApiRequest,
    kind: 'bi' | 'assistant' | 'automation',
  ): Promise<ConnectionIdentity> {
    const auth = header(req, 'authorization');
    if (!auth?.startsWith('Bearer '))
      throw new ApiProblem(
        401,
        'ECOSYSTEM_CONNECTION_INVALID',
        'Send your connection token as an Authorization: Bearer header.',
      );
    return this.connections.authenticate(auth.slice(7).trim(), kind);
  }
}
