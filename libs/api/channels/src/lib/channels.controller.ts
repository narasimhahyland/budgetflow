import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  Public,
  RequestId,
  type ApiRequest,
  type RequestActor,
} from '@bf/api/core';
import {
  ChatProvider,
  ChatWebhookInteractionRequest,
  CompleteChatLinkRequest,
  CreateChatLinkIntentRequest,
  CreateCommentRequest,
  CreatePushDeviceRequest,
  DiscussionItemType,
  FollowingQuery,
  MarkNotificationsRequest,
  NotificationChannel,
  NotificationsQuery,
  SendDigestTestRequest,
  TestChannelRequest,
  UpdateChatInstallationRequest,
  UpdateCommentRequest,
  UpdateDigestTemplateRequest,
  UpdateFollowRequest,
  UpdateNotificationSettingsRequest,
  type AdminChannelsView,
  type ChannelDeliveryLogView,
  type ChatAccountLinkView,
  type ChatApprovalCardView,
  type ChatInstallationView,
  type ChatLinkPreview,
  type ChatWebhookResponse,
  type CommentView,
  type DigestPreviewResponse,
  type DigestTemplateView,
  type DiscussionThread,
  type FollowedItemView,
  type FollowState,
  type NotificationsFeed,
  type NotificationSettingsView,
  type PushDevice,
  type TestChannelResponse,
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
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { ChannelsService } from './channels.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const UuidParam = z.uuid();
const TokenParam = z.string().min(10).max(500);
const DeliveriesQuery = z
  .object({
    channel: NotificationChannel.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
const DigestPreviewQuery = z.object({ personId: z.uuid().optional() }).strict();

@Controller('api')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  // Notifications & tasks (123) ----------------------------------------------------------------

  @Get('notifications')
  listNotifications(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<NotificationsFeed> {
    const q = parseWith(NotificationsQuery, raw);
    return this.channels.listNotifications(actor, q);
  }

  @Post('notifications/mark')
  @HttpCode(200)
  async markNotifications(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ updated: number; unreadCount: number }> {
    const r = await this.channels.markNotifications(
      actor,
      parseWith(MarkNotificationsRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Notification settings & push devices (059c) ------------------------------------------------

  @Get('me/notification-settings')
  getNotificationSettings(
    @CurrentActor() actor: RequestActor,
  ): Promise<NotificationSettingsView> {
    return this.channels.getNotificationSettings(actor);
  }

  @Patch('me/notification-settings')
  async updateNotificationSettings(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<NotificationSettingsView> {
    const r = await this.channels.updateNotificationSettings(
      actor,
      parseWith(UpdateNotificationSettingsRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('me/push-devices')
  @HttpCode(201)
  async registerPushDevice(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<PushDevice> {
    const r = await this.channels.registerPushDevice(
      actor,
      parseWith(CreatePushDeviceRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('me/push-devices/:id')
  async removePushDevice(
    @CurrentActor() actor: RequestActor,
    @Param('id') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ removed: boolean }> {
    const r = await this.channels.removePushDevice(actor, parseWith(UuidParam, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('me/notification-settings/test')
  @HttpCode(200)
  async sendTestNotification(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<TestChannelResponse> {
    const parsed = parseWith(TestChannelRequest, body);
    const r = await this.channels.sendTestNotification(actor, parsed.channel, {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  // Discussions, comments, mentions & follow (060a) --------------------------------------------

  @Get('discussions/:itemType/:itemId')
  getDiscussion(
    @CurrentActor() actor: RequestActor,
    @Param('itemType') rawType: string,
    @Param('itemId') rawId: string,
  ): Promise<DiscussionThread> {
    return this.channels.getDiscussion(
      actor,
      parseWith(DiscussionItemType, rawType),
      parseWith(UuidParam, rawId),
    );
  }

  @Post('discussions/:itemType/:itemId/comments')
  @HttpCode(201)
  async createComment(
    @CurrentActor() actor: RequestActor,
    @Param('itemType') rawType: string,
    @Param('itemId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<CommentView> {
    const r = await this.channels.createComment(
      actor,
      parseWith(DiscussionItemType, rawType),
      parseWith(UuidParam, rawId),
      parseWith(CreateCommentRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Patch('comments/:commentId')
  async updateComment(
    @CurrentActor() actor: RequestActor,
    @Param('commentId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<CommentView> {
    const r = await this.channels.updateComment(
      actor,
      parseWith(UuidParam, rawId),
      parseWith(UpdateCommentRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('comments/:commentId')
  async removeComment(
    @CurrentActor() actor: RequestActor,
    @Param('commentId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<CommentView> {
    const r = await this.channels.removeComment(actor, parseWith(UuidParam, rawId), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Put('discussions/:itemType/:itemId/follow')
  async updateFollow(
    @CurrentActor() actor: RequestActor,
    @Param('itemType') rawType: string,
    @Param('itemId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<FollowState> {
    const r = await this.channels.updateFollow(
      actor,
      parseWith(DiscussionItemType, rawType),
      parseWith(UuidParam, rawId),
      parseWith(UpdateFollowRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('me/following')
  listFollowedItems(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: FollowedItemView[] }> {
    return this.channels.listFollowedItems(actor, parseWith(FollowingQuery, raw));
  }

  // Admin channels, account linking & delivery logs (061e) ------------------------------------

  @Get('admin/channels')
  getAdminChannels(@CurrentActor() actor: RequestActor): Promise<AdminChannelsView> {
    return this.channels.getAdminChannels(actor);
  }

  @Patch('admin/channels/:provider')
  async updateChatInstallation(
    @CurrentActor() actor: RequestActor,
    @Param('provider') rawProvider: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ChatInstallationView> {
    const r = await this.channels.updateChatInstallation(
      actor,
      parseWith(ChatProvider, rawProvider),
      parseWith(UpdateChatInstallationRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('admin/channels/links/:id')
  async unlinkChatAccount(
    @CurrentActor() actor: RequestActor,
    @Param('id') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ unlinked: boolean }> {
    const r = await this.channels.unlinkChatAccount(actor, parseWith(UuidParam, rawId), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('channels/link-intent')
  @HttpCode(201)
  async createChatLinkIntent(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ChatLinkPreview> {
    const r = await this.channels.createChatLinkIntent(
      actor,
      parseWith(CreateChatLinkIntentRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('channels/link-preview')
  previewChatLink(
    @CurrentActor() actor: RequestActor,
    @Query('token') rawToken: string,
  ): Promise<ChatLinkPreview> {
    return this.channels.previewChatLink(actor, parseWith(TokenParam, rawToken));
  }

  @Post('channels/link-complete')
  @HttpCode(200)
  async completeChatLink(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ChatAccountLinkView> {
    const r = await this.channels.completeChatLink(
      actor,
      parseWith(CompleteChatLinkRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('channels/deliveries')
  listChannelDeliveries(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: ChannelDeliveryLogView[] }> {
    const q = parseWith(DeliveriesQuery, raw);
    return this.channels.listChannelDeliveries(actor, q);
  }

  // Slack & Teams cards and signed webhooks (061b, 061c, 061d) ---------------------------------

  @Get('channels/:provider/cards/:taskId')
  getChatApprovalCard(
    @CurrentActor() actor: RequestActor,
    @Param('provider') rawProvider: string,
    @Param('taskId') rawTaskId: string,
  ): Promise<ChatApprovalCardView> {
    return this.channels.getChatApprovalCard(
      actor,
      parseWith(ChatProvider, rawProvider),
      parseWith(UuidParam, rawTaskId),
    );
  }

  @Public()
  @Post('channels/webhooks/:provider')
  @HttpCode(200)
  handleChatWebhook(
    @Param('provider') rawProvider: string,
    @Req() req: ApiRequest & { rawBody?: Buffer },
    @RequestId() requestId: string | null,
    @Body() body: unknown,
  ): Promise<ChatWebhookResponse> {
    const provider = parseWith(ChatProvider, rawProvider);
    const parsed = parseWith(ChatWebhookInteractionRequest, body);
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    return this.channels.handleChatWebhook(provider, req.headers, rawBody, parsed, requestId);
  }

  // Role-based digest templates (064a) ---------------------------------------------------------

  @Get('digests/templates')
  listDigestTemplates(
    @CurrentActor() actor: RequestActor,
  ): Promise<{ items: DigestTemplateView[]; canManage: boolean }> {
    return this.channels.listDigestTemplates(actor);
  }

  @Get('digests/templates/:templateId')
  getDigestTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') rawId: string,
  ): Promise<DigestTemplateView> {
    return this.channels.getDigestTemplate(actor, parseWith(UuidParam, rawId));
  }

  @Patch('digests/templates/:templateId')
  async updateDigestTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DigestTemplateView> {
    const r = await this.channels.updateDigestTemplate(
      actor,
      parseWith(UuidParam, rawId),
      parseWith(UpdateDigestTemplateRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('digests/templates/:templateId/preview')
  previewDigestTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') rawId: string,
    @Query() rawQuery: unknown,
  ): Promise<DigestPreviewResponse> {
    const q = parseWith(DigestPreviewQuery, rawQuery);
    return this.channels.previewDigestTemplate(actor, parseWith(UuidParam, rawId), q.personId);
  }

  @Post('digests/templates/:templateId/test')
  @HttpCode(200)
  async sendDigestTest(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<TestChannelResponse> {
    const parsed = parseWith(SendDigestTestRequest, body);
    const r = await this.channels.sendDigestTest(
      actor,
      parseWith(UuidParam, rawId),
      parsed.channel ?? 'email',
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
