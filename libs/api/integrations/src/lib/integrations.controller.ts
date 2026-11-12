import {
  clientIpOf,
  CONFIG,
  CurrentActor,
  IdempotencyKey,
  parseWith,
  Public,
  RequestId,
  type ApiRequest,
  type AppConfig,
  type RequestActor,
} from '@bf/api/core';
import {
  AdaptivePlanImportRequest,
  ConnectRequest,
  CreateApiKeyRequest,
  CreatePushRequest,
  CreateScimTokenRequest,
  CreateWebhookEndpointRequest,
  DiscardMessagesRequest,
  InboundWebhookRequest,
  IntegrationMessagesQuery,
  PushKind,
  PutMappingsRequest,
  ReplaceCredentialRequest,
  ResolveDuplicateRequest,
  RetryMessagesRequest,
  RevokeApiKeyRequest,
  RotateApiKeyRequest,
  RunSyncRequest,
  ScimUserRequest,
  SyncRunsQuery,
  UpdateConnectionRequest,
  UpdateWebhookEndpointRequest,
  WebhookDeliveriesQuery,
  type AdaptivePlanPreview,
  type ApiKeyCreated,
  type ApiKeyList,
  type ApiKeyUsage,
  type ApiKeyView,
  type ConnectionDetail,
  type DuplicateGroupList,
  type DuplicateGroupView,
  type IdentityOverview,
  type InboundWebhookResult,
  type IntegrationMessageList,
  type IntegrationsHub,
  type MessageActionResult,
  type PushItemList,
  type PushItemView,
  type ScimTokenCreated,
  type SendTestPingResult,
  type NavanCustomFieldList,
  type SyncRunList,
  type SyncRunView,
  type TestConnectionResult,
  type WebhookDeliveryList,
  type WebhookEndpointCreated,
  type WebhookEndpointList,
  type WebhookEndpointView,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeysService } from './api-keys.service';
import { ConnectionsService } from './connections.service';
import { DuplicatesService } from './duplicates.service';
import { MessagesService } from './messages.service';
import { PlanImportService } from './plan-import.service';
import { PushesService } from './pushes.service';
import { ScimService } from './scim.service';
import { SyncService } from './sync.service';
import { WebhooksService } from './webhooks.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const UuidParam = z.uuid();
const PushQuery = z
  .object({ connectionId: z.uuid().optional(), kind: PushKind.optional() })
  .strict();
const DuplicatesQuery = z.object({ status: z.enum(['open', 'resolved']).optional() }).strict();

@Controller()
export class IntegrationsController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly connections: ConnectionsService,
    private readonly sync: SyncService,
    private readonly messages: MessagesService,
    private readonly pushes: PushesService,
    private readonly duplicates: DuplicatesService,
    private readonly planImport: PlanImportService,
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly scim: ScimService,
  ) {}

  // Connector hub and detail frame (092, 093-098, 094a) -----------------------------------------

  @Get('api/integrations')
  getHub(@CurrentActor() actor: RequestActor): Promise<IntegrationsHub> {
    return this.connections.hub(actor);
  }

  @Post('api/integrations')
  @HttpCode(201)
  async connect(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ConnectionDetail> {
    const r = await this.connections.connect(actor, parseWith(ConnectRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/integrations/connections/:connectionId')
  getConnection(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
  ): Promise<ConnectionDetail> {
    return this.connections.detail(actor, parseWith(UuidParam, raw));
  }

  @Patch('api/integrations/connections/:connectionId')
  async updateConnection(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ConnectionDetail> {
    const r = await this.connections.update(
      actor,
      parseWith(UuidParam, raw),
      parseWith(UpdateConnectionRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/connections/:connectionId/credential')
  @HttpCode(200)
  async replaceCredential(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ConnectionDetail> {
    const parsed = parseWith(ReplaceCredentialRequest, body);
    const r = await this.connections.replaceCredential(
      actor,
      parseWith(UuidParam, raw),
      parsed.credential,
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/connections/:connectionId/test')
  @HttpCode(200)
  testConnection(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
  ): Promise<TestConnectionResult> {
    return this.connections.test(actor, parseWith(UuidParam, raw));
  }

  @Delete('api/integrations/connections/:connectionId')
  async disconnect(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ disconnected: boolean }> {
    const r = await this.connections.disconnect(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Put('api/integrations/connections/:connectionId/mappings')
  async putMappings(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ConnectionDetail> {
    const r = await this.connections.putMappings(
      actor,
      parseWith(UuidParam, raw),
      parseWith(PutMappingsRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/integrations/connections/:connectionId/navan/custom-fields')
  listNavanCustomFields(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
  ): Promise<NavanCustomFieldList> {
    return this.connections.navanCustomFields(actor, parseWith(UuidParam, raw));
  }

  // Sync runs (099) -------------------------------------------------------------------------------

  @Post('api/integrations/connections/:connectionId/sync')
  @HttpCode(201)
  runSync(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<SyncRunView> {
    return this.sync.run(actor, parseWith(UuidParam, raw), parseWith(RunSyncRequest, body), {
      idempotencyKey,
      requestId,
    });
  }

  @Get('api/integrations/sync-runs')
  listSyncRuns(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<SyncRunList> {
    return this.sync.list(actor, parseWith(SyncRunsQuery, raw));
  }

  @Get('api/integrations/sync-runs/:runId')
  getSyncRun(
    @CurrentActor() actor: RequestActor,
    @Param('runId') raw: string,
  ): Promise<SyncRunView> {
    return this.sync.get(actor, parseWith(UuidParam, raw));
  }

  // Errors, retries and the dead letter (100) -----------------------------------------------------

  @Get('api/integrations/messages')
  listMessages(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<IntegrationMessageList> {
    return this.messages.list(actor, parseWith(IntegrationMessagesQuery, raw));
  }

  @Post('api/integrations/messages/retry')
  @HttpCode(200)
  retryMessages(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<MessageActionResult> {
    return this.messages.retry(actor, parseWith(RetryMessagesRequest, body), {
      idempotencyKey,
      requestId,
    });
  }

  @Post('api/integrations/messages/discard')
  @HttpCode(200)
  async discardMessages(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<MessageActionResult> {
    const r = await this.messages.discard(actor, parseWith(DiscardMessagesRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Pushes (99b, 096) -----------------------------------------------------------------------------

  @Get('api/integrations/pushes')
  listPushes(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<PushItemList> {
    return this.pushes.list(actor, parseWith(PushQuery, raw));
  }

  @Post('api/integrations/pushes')
  @HttpCode(201)
  createPush(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<PushItemView> {
    return this.pushes.create(actor, parseWith(CreatePushRequest, body), {
      idempotencyKey,
      requestId,
    });
  }

  // Cross-source duplicates (99a) -------------------------------------------------------------------

  @Get('api/integrations/duplicates')
  listDuplicates(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<DuplicateGroupList> {
    return this.duplicates.list(actor, parseWith(DuplicatesQuery, raw));
  }

  @Post('api/integrations/duplicates/:flagId/resolve')
  @HttpCode(200)
  async resolveDuplicate(
    @CurrentActor() actor: RequestActor,
    @Param('flagId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DuplicateGroupView> {
    const r = await this.duplicates.resolve(
      actor,
      parseWith(UuidParam, raw),
      parseWith(ResolveDuplicateRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Planning import preview (094a) --------------------------------------------------------------

  @Post('api/integrations/connections/:connectionId/plan-import/preview')
  @HttpCode(200)
  previewPlanImport(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') raw: string,
    @Body() body: unknown,
  ): Promise<AdaptivePlanPreview> {
    return this.planImport.preview(
      actor,
      parseWith(UuidParam, raw),
      parseWith(AdaptivePlanImportRequest, body),
    );
  }

  // Identity, single sign-on and SCIM (098) ------------------------------------------------------

  @Get('api/integrations/identity')
  getIdentity(@CurrentActor() actor: RequestActor): Promise<IdentityOverview> {
    return this.scim.overview(actor);
  }

  @Post('api/integrations/identity/tokens')
  @HttpCode(201)
  async createScimToken(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ScimTokenCreated> {
    const parsed = parseWith(CreateScimTokenRequest, body);
    const r = await this.scim.createToken(actor, parsed.expiresInDays, {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('api/integrations/identity/tokens/:tokenId')
  async revokeScimToken(
    @CurrentActor() actor: RequestActor,
    @Param('tokenId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ revoked: boolean }> {
    const r = await this.scim.revokeToken(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Public()
  @Post('scim/v2/Users')
  @HttpCode(200)
  provisionScimUser(
    @Req() req: ApiRequest,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ) {
    const auth = req.headers['authorization'];
    return this.scim.provision(
      Array.isArray(auth) ? auth[0] : auth,
      parseWith(ScimUserRequest, body),
      // The connection's own address; X-Forwarded-For only from a trusted proxy (see client-ip.ts).
      clientIpOf(req, this.config.TRUSTED_PROXY_CIDRS),
      requestId,
    );
  }

  // API keys (101) ---------------------------------------------------------------------------------

  @Get('api/integrations/api-keys')
  listApiKeys(@CurrentActor() actor: RequestActor): Promise<ApiKeyList> {
    return this.keys.list(actor);
  }

  @Post('api/integrations/api-keys')
  @HttpCode(201)
  async createApiKey(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ApiKeyCreated> {
    const r = await this.keys.create(actor, parseWith(CreateApiKeyRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/api-keys/:keyId/rotate')
  @HttpCode(201)
  async rotateApiKey(
    @CurrentActor() actor: RequestActor,
    @Param('keyId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ApiKeyCreated> {
    const parsed = parseWith(RotateApiKeyRequest, body);
    const r = await this.keys.rotate(actor, parseWith(UuidParam, raw), parsed.overlapDays, {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/api-keys/:keyId/revoke')
  @HttpCode(200)
  async revokeApiKey(
    @CurrentActor() actor: RequestActor,
    @Param('keyId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ApiKeyView> {
    const parsed = parseWith(RevokeApiKeyRequest, body);
    const r = await this.keys.revoke(actor, parseWith(UuidParam, raw), parsed.confirmName, {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/integrations/api-keys/:keyId/usage')
  getApiKeyUsage(
    @CurrentActor() actor: RequestActor,
    @Param('keyId') raw: string,
  ): Promise<ApiKeyUsage> {
    return this.keys.usage(actor, parseWith(UuidParam, raw));
  }

  // Outbound webhooks (101) --------------------------------------------------------------------------

  @Get('api/integrations/webhook-endpoints')
  listWebhookEndpoints(@CurrentActor() actor: RequestActor): Promise<WebhookEndpointList> {
    return this.webhooks.listEndpoints(actor);
  }

  @Post('api/integrations/webhook-endpoints')
  @HttpCode(201)
  async createWebhookEndpoint(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WebhookEndpointCreated> {
    const r = await this.webhooks.createEndpoint(
      actor,
      parseWith(CreateWebhookEndpointRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Patch('api/integrations/webhook-endpoints/:endpointId')
  async updateWebhookEndpoint(
    @CurrentActor() actor: RequestActor,
    @Param('endpointId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WebhookEndpointView> {
    const r = await this.webhooks.updateEndpoint(
      actor,
      parseWith(UuidParam, raw),
      parseWith(UpdateWebhookEndpointRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('api/integrations/webhook-endpoints/:endpointId')
  async deleteWebhookEndpoint(
    @CurrentActor() actor: RequestActor,
    @Param('endpointId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ removed: boolean }> {
    const r = await this.webhooks.deleteEndpoint(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/webhook-endpoints/:endpointId/rotate-secret')
  @HttpCode(200)
  async rotateWebhookSecret(
    @CurrentActor() actor: RequestActor,
    @Param('endpointId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WebhookEndpointCreated> {
    const r = await this.webhooks.rotateSecret(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/integrations/webhook-endpoints/:endpointId/test')
  @HttpCode(200)
  sendWebhookTestPing(
    @CurrentActor() actor: RequestActor,
    @Param('endpointId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
  ): Promise<SendTestPingResult> {
    return this.webhooks.sendTestPing(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
  }

  @Get('api/integrations/webhook-deliveries')
  listWebhookDeliveries(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<WebhookDeliveryList> {
    return this.webhooks.listDeliveries(actor, parseWith(WebhookDeliveriesQuery, raw));
  }

  @Post('api/integrations/webhook-deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  redeliverWebhook(
    @CurrentActor() actor: RequestActor,
    @Param('deliveryId') raw: string,
  ): Promise<SendTestPingResult> {
    return this.webhooks.redeliver(actor, parseWith(UuidParam, raw));
  }

  // Inbound provider callbacks ---------------------------------------------------------------------

  @Public()
  @Post('api/integrations/webhooks/:tenantId/:connectionId')
  @HttpCode(200)
  receiveProviderWebhook(
    @Param('tenantId') rawTenant: string,
    @Param('connectionId') rawConnection: string,
    @Req() req: ApiRequest & { rawBody?: Buffer },
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<InboundWebhookResult> {
    const parsed = parseWith(InboundWebhookRequest, body);
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    return this.webhooks.receive(
      parseWith(UuidParam, rawTenant),
      parseWith(UuidParam, rawConnection),
      req.headers,
      rawBody,
      parsed,
      requestId,
    );
  }
}
