import {
  CurrentActor,
  IdempotencyKey,
  RequestId,
  header,
  parseWith,
  type ApiRequest,
  type RequestActor,
} from '@bf/api/core';
import {
  CreateAssistantConnectionRequest,
  CreateAutomationRequest,
  CreateBiConnectionRequest,
  CreateBookingRequest,
  CreateWidgetRequest,
  NoCodePlatform,
  RevokeConnectionRequest,
  UpdateAssistantConnectorRequest,
  UpdateBiConnectorRequest,
  UpdateNoCodePlatformRequest,
  UpdatePartnerRequest,
  UpdateWidgetRequest,
  type AssistantConnectorView,
  type AutomationConnectorView,
  type BiConnectorView,
  type BookingList,
  type BookingView,
  type EcosystemConnectionCreated,
  type EcosystemConnectionList,
  type EcosystemConnectionView,
  type MarketplaceCategory,
  type OfferList,
  type OfferView,
  type PartnerList,
  type PartnerSyncResult,
  type PartnerView,
  type WidgetContent,
  type WidgetList,
  type WidgetView,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { AssistantConnectorService } from './assistants.service';
import { AutomationConnectorService } from './automations.service';
import { BiConnectorService } from './bi.service';
import { EcosystemConnectionsService } from './connections.service';
import { MarketplaceService } from './marketplace.service';
import { WidgetsService } from './widgets.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const UuidParam = z.uuid();
const OffersQuery = z
  .object({
    city: z.string().trim().max(80).optional(),
    category: z.enum(['experiences', 'catering', 'gifts_and_kits']).optional(),
    people: z.coerce.number().int().min(1).max(100_000).optional(),
    maxPricePerHeadMinor: z.coerce.number().int().min(0).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

/**
 * The signed-in half of the ecosystem: configuring each surface, connecting a personal tool, and the
 * marketplace and widget reads a person makes from the app. The token-authenticated half (the BI
 * feed, the assistant tools and the automation actions) is in `external.controller.ts`.
 */
@Controller()
export class EcosystemController {
  constructor(
    private readonly bi: BiConnectorService,
    private readonly assistants: AssistantConnectorService,
    private readonly automations: AutomationConnectorService,
    private readonly marketplace: MarketplaceService,
    private readonly widgets: WidgetsService,
    private readonly connections: EcosystemConnectionsService,
  ) {}

  // BI connector (092a) --------------------------------------------------------------------------

  @Get('api/ecosystem/bi')
  getBi(@CurrentActor() actor: RequestActor): Promise<BiConnectorView> {
    return this.bi.view(actor);
  }

  @Patch('api/ecosystem/bi')
  async updateBi(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<BiConnectorView> {
    const r = await this.bi.update(actor, parseWith(UpdateBiConnectorRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/ecosystem/bi/connections')
  listBiConnections(@CurrentActor() actor: RequestActor): Promise<EcosystemConnectionList> {
    return this.connections.list(actor, 'bi');
  }

  @Post('api/ecosystem/bi/connections')
  @HttpCode(201)
  async createBiConnection(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EcosystemConnectionCreated> {
    const r = await this.bi.connect(actor, parseWith(CreateBiConnectionRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/ecosystem/bi/connections/:connectionId/revoke')
  revokeBiConnection(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') connectionId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<EcosystemConnectionView> {
    return this.revoke(actor, 'bi', connectionId, body, { idempotencyKey, requestId });
  }

  // Connector for AI assistants (092c) --------------------------------------------------------------

  @Get('api/ecosystem/assistants')
  getAssistants(@CurrentActor() actor: RequestActor): Promise<AssistantConnectorView> {
    return this.assistants.view(actor);
  }

  @Patch('api/ecosystem/assistants')
  async updateAssistants(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<AssistantConnectorView> {
    const r = await this.assistants.update(
      actor,
      parseWith(UpdateAssistantConnectorRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/ecosystem/assistants/connections')
  listAssistantConnections(@CurrentActor() actor: RequestActor): Promise<EcosystemConnectionList> {
    return this.connections.list(actor, 'assistant');
  }

  @Post('api/ecosystem/assistants/connections')
  @HttpCode(201)
  async createAssistantConnection(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EcosystemConnectionCreated> {
    const r = await this.assistants.connect(
      actor,
      parseWith(CreateAssistantConnectionRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/ecosystem/assistants/connections/:connectionId/revoke')
  revokeAssistantConnection(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') connectionId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<EcosystemConnectionView> {
    return this.revoke(actor, 'assistant', connectionId, body, { idempotencyKey, requestId });
  }

  // No-code connectors (092b) -------------------------------------------------------------------------

  @Get('api/ecosystem/automations')
  getAutomations(@CurrentActor() actor: RequestActor): Promise<AutomationConnectorView> {
    return this.automations.view(actor);
  }

  @Patch('api/ecosystem/automations/platforms/:platform')
  async updatePlatform(
    @CurrentActor() actor: RequestActor,
    @Param('platform') platform: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<AutomationConnectorView> {
    const r = await this.automations.setPlatform(
      actor,
      parseWith(NoCodePlatform, platform),
      parseWith(UpdateNoCodePlatformRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/ecosystem/automations/connections')
  listAutomations(@CurrentActor() actor: RequestActor): Promise<EcosystemConnectionList> {
    return this.connections.list(actor, 'automation');
  }

  @Post('api/ecosystem/automations/connections')
  @HttpCode(201)
  async createAutomation(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EcosystemConnectionCreated> {
    const r = await this.automations.connect(actor, parseWith(CreateAutomationRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/ecosystem/automations/connections/:connectionId/revoke')
  revokeAutomation(
    @CurrentActor() actor: RequestActor,
    @Param('connectionId') connectionId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<EcosystemConnectionView> {
    return this.revoke(actor, 'automation', connectionId, body, { idempotencyKey, requestId });
  }

  // Partner marketplace (092d) ---------------------------------------------------------------------------

  @Get('api/ecosystem/marketplace/partners')
  listPartners(@CurrentActor() actor: RequestActor): Promise<PartnerList> {
    return this.marketplace.partners(actor);
  }

  @Patch('api/ecosystem/marketplace/partners/:partnerId')
  async updatePartner(
    @CurrentActor() actor: RequestActor,
    @Param('partnerId') partnerId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<PartnerView> {
    const r = await this.marketplace.updatePartner(
      actor,
      parseWith(UuidParam, partnerId),
      parseWith(UpdatePartnerRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('api/ecosystem/marketplace/partners/:partnerId/sync')
  async syncPartner(
    @CurrentActor() actor: RequestActor,
    @Param('partnerId') partnerId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<PartnerSyncResult> {
    const r = await this.marketplace.sync(actor, parseWith(UuidParam, partnerId), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('api/marketplace/offers')
  listOffers(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<OfferList> {
    const q = parseWith(OffersQuery, raw);
    return this.marketplace.offers(actor, {
      ...q,
      category: q.category as MarketplaceCategory | undefined,
    });
  }

  @Get('api/marketplace/offers/:offerId')
  getOffer(
    @CurrentActor() actor: RequestActor,
    @Param('offerId') offerId: string,
  ): Promise<OfferView> {
    return this.marketplace.offer(actor, parseWith(UuidParam, offerId));
  }

  @Get('api/marketplace/bookings')
  listBookings(@CurrentActor() actor: RequestActor): Promise<BookingList> {
    return this.marketplace.bookings(actor);
  }

  @Post('api/marketplace/bookings')
  @HttpCode(201)
  async createBooking(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<BookingView> {
    const r = await this.marketplace.createBooking(actor, parseWith(CreateBookingRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Embeddable widgets (102d) -----------------------------------------------------------------------------

  @Get('api/ecosystem/widgets')
  listWidgets(@CurrentActor() actor: RequestActor): Promise<WidgetList> {
    return this.widgets.list(actor);
  }

  @Post('api/ecosystem/widgets')
  @HttpCode(201)
  async createWidget(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WidgetView> {
    const r = await this.widgets.create(actor, parseWith(CreateWidgetRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Patch('api/ecosystem/widgets/:widgetId')
  async updateWidget(
    @CurrentActor() actor: RequestActor,
    @Param('widgetId') widgetId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WidgetView> {
    const r = await this.widgets.update(
      actor,
      parseWith(UuidParam, widgetId),
      parseWith(UpdateWidgetRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('api/ecosystem/widgets/:widgetId')
  async deleteWidget(
    @CurrentActor() actor: RequestActor,
    @Param('widgetId') widgetId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WidgetView> {
    const r = await this.widgets.remove(actor, parseWith(UuidParam, widgetId), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  /**
   * The viewer's own content. The identity is the bearer token on this request and nothing else: the
   * widget id chooses the card, and the `Origin` header decides whether the host page may show it.
   * The response carries the same `frame-ancestors` policy the embed route is served with.
   */
  @Get('api/ecosystem/widgets/:widgetId/content')
  async getWidgetContent(
    @CurrentActor() actor: RequestActor,
    @Param('widgetId') widgetId: string,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<WidgetContent> {
    const content = await this.widgets.content(
      actor,
      parseWith(UuidParam, widgetId),
      header(req, 'origin') ?? null,
    );
    res.setHeader('Content-Security-Policy', content.frameAncestors);
    return content;
  }

  private async revoke(
    actor: RequestActor,
    kind: 'bi' | 'assistant' | 'automation',
    connectionId: string,
    body: unknown,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<EcosystemConnectionView> {
    const req = parseWith(RevokeConnectionRequest, body ?? {});
    const r = await this.connections.revoke(
      actor,
      kind,
      parseWith(UuidParam, connectionId),
      req.reason,
      ctx,
    );
    return r.body;
  }
}
