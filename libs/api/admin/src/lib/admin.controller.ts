import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  AdminDecisionRequest,
  BreakGlassDecisionRequest,
  CancelMaintenanceNoticeRequest,
  CreateMaintenanceNoticeRequest,
  CreateOwnerInvitesRequest,
  GrantRoleRequest,
  LegalHoldDecisionRequest,
  PlaceLegalHoldRequest,
  RequestBreakGlassRequest,
  RevokeBreakGlassRequest,
  RevokeRoleRequest,
  StartRetentionRunRequest,
  SwitchFeatureFlagRequest,
  UpdateBrandingRequest,
  UpdateDocumentSettingsRequest,
  UpdateNotificationDefaultsRequest,
  UpdateRetentionPolicyRequest,
  UpdateSecuritySettingsRequest,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { CommandContext } from './admin-reads';
import { AdminSettingsService } from './admin-settings.service';
import { BreakGlassService } from './break-glass.service';
import { ExperienceService } from './experience.service';
import { FeatureFlagsService } from './feature-flags.service';
import { RetentionService } from './retention.service';
import { SystemHealthService } from './system-health.service';
import { UserAdminService } from './user-admin.service';

const Uuid = z.uuid();
const FlagKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
  .max(100);
const CategoryKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(60);
const RoleFilter = z
  .object({ search: z.string().max(120).optional(), role: z.string().max(40).optional() })
  .strict();
const HoldQuery = z.object({ status: z.string().max(25).optional() }).strict();
const FlagQuery = z.object({ key: FlagKey.optional() }).strict();
const NoticeQuery = z.object({ activeOnly: z.enum(['true', 'false']).optional() }).strict();
const ActivityQuery = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    types: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

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

/** Administration: settings, feature flags, retention and legal holds, users and roles, health. */
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly flags: FeatureFlagsService,
    private readonly retention: RetentionService,
    private readonly users: UserAdminService,
    private readonly health: SystemHealthService,
    private readonly experience: ExperienceService,
    private readonly breakGlass: BreakGlassService,
  ) {}

  // Settings ------------------------------------------------------------------------------------

  @Get('settings')
  readSettings(@CurrentActor() actor: RequestActor) {
    return this.settings.read(actor);
  }

  @Put('settings/branding')
  async updateBranding(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.updateBranding(
        actor,
        parseWith(UpdateBrandingRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Put('settings/notifications')
  async updateNotifications(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.updateNotifications(
        actor,
        parseWith(UpdateNotificationDefaultsRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Put('settings/documents')
  async updateDocuments(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.updateDocuments(
        actor,
        parseWith(UpdateDocumentSettingsRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Put('settings/security')
  async updateSecurity(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.settings.updateSecurity(
        actor,
        parseWith(UpdateSecuritySettingsRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Break-glass access (112) --------------------------------------------------------------------

  @Get('break-glass')
  listBreakGlass(@CurrentActor() actor: RequestActor) {
    return this.breakGlass.list(actor);
  }

  @Post('break-glass')
  async requestBreakGlass(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.breakGlass.request(
        actor,
        parseWith(RequestBreakGlassRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('break-glass/:grantId/decision')
  async decideBreakGlass(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.breakGlass.decide(
        actor,
        id(grantId),
        parseWith(BreakGlassDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('break-glass/:grantId/revocation')
  async revokeBreakGlass(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.breakGlass.revoke(
        actor,
        id(grantId),
        parseWith(RevokeBreakGlassRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Feature flags -------------------------------------------------------------------------------

  @Get('features')
  featureFlags(@CurrentActor() actor: RequestActor) {
    return this.flags.list(actor);
  }

  @Get('features/history')
  featureFlagHistory(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.flags.history(actor, parseWith(FlagQuery, query));
  }

  @Post('features/changes/:changeId/decision')
  @HttpCode(201)
  async decideFlagChange(
    @CurrentActor() actor: RequestActor,
    @Param('changeId') changeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.flags.decide(
        actor,
        id(changeId),
        parseWith(AdminDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('features/:key/switch')
  @HttpCode(201)
  async switchFlag(
    @CurrentActor() actor: RequestActor,
    @Param('key') flagKey: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.flags.switch(
        actor,
        parseWith(FlagKey, flagKey),
        parseWith(SwitchFeatureFlagRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Retention and legal holds ---------------------------------------------------------------------

  @Get('retention/policies')
  retentionPolicies(@CurrentActor() actor: RequestActor) {
    return this.retention.listPolicies(actor);
  }

  @Put('retention/policies/:category')
  async updateRetentionPolicy(
    @CurrentActor() actor: RequestActor,
    @Param('category') category: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.retention.updatePolicy(
        actor,
        parseWith(CategoryKey, category),
        parseWith(UpdateRetentionPolicyRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('retention/changes/:changeId/decision')
  @HttpCode(201)
  async decideRetentionChange(
    @CurrentActor() actor: RequestActor,
    @Param('changeId') changeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.retention.decidePolicyChange(
        actor,
        id(changeId),
        parseWith(AdminDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('retention/holds')
  legalHolds(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.retention.listHolds(actor, parseWith(HoldQuery, query));
  }

  @Post('retention/holds')
  @HttpCode(201)
  async placeHold(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.retention.placeHold(actor, parseWith(PlaceLegalHoldRequest, body), ctx(key, rid)),
    );
  }

  @Post('retention/holds/:holdId/decision')
  @HttpCode(201)
  async decideHold(
    @CurrentActor() actor: RequestActor,
    @Param('holdId') holdId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.retention.decideHold(
        actor,
        id(holdId),
        parseWith(LegalHoldDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('retention/runs')
  retentionRuns(@CurrentActor() actor: RequestActor) {
    return this.retention.listRuns(actor);
  }

  @Get('retention/runs/:runId')
  retentionRun(@CurrentActor() actor: RequestActor, @Param('runId') runId: string) {
    return this.retention.getRun(actor, id(runId));
  }

  @Post('retention/runs')
  @HttpCode(201)
  async startRetentionRun(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.retention.startRun(
        actor,
        parseWith(StartRetentionRunRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Users, roles and invites ------------------------------------------------------------------------

  @Get('users')
  users_(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    const parsed = parseWith(RoleFilter, query);
    return this.users.list(actor, parsed as { search?: string; role?: never });
  }

  @Get('users/:membershipId')
  user(@CurrentActor() actor: RequestActor, @Param('membershipId') membershipId: string) {
    return this.users.get(actor, id(membershipId));
  }

  @Post('users/:membershipId/role-grants')
  @HttpCode(201)
  async grantRole(
    @CurrentActor() actor: RequestActor,
    @Param('membershipId') membershipId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.users.grant(
        actor,
        id(membershipId),
        parseWith(GrantRoleRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('users/:membershipId/role-revocations')
  @HttpCode(201)
  async revokeRole(
    @CurrentActor() actor: RequestActor,
    @Param('membershipId') membershipId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.users.revoke(
        actor,
        id(membershipId),
        parseWith(RevokeRoleRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('role-grants/changes/:changeId/decision')
  @HttpCode(201)
  async decideRoleGrant(
    @CurrentActor() actor: RequestActor,
    @Param('changeId') changeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.users.decideGrant(
        actor,
        id(changeId),
        parseWith(AdminDecisionRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('owner-invites')
  ownerInvites(@CurrentActor() actor: RequestActor) {
    return this.users.listInvites(actor);
  }

  @Post('owner-invites')
  @HttpCode(201)
  async createOwnerInvites(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.users.createInvites(
        actor,
        parseWith(CreateOwnerInvitesRequest, body),
        ctx(key, rid),
      ),
    );
  }

  // Health, maintenance notices and setup ------------------------------------------------------------

  @Get('health')
  systemHealth(@CurrentActor() actor: RequestActor) {
    return this.health.health(actor);
  }

  @Get('maintenance-notices')
  maintenanceNotices(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.health.listNotices(actor, parseWith(NoticeQuery, query));
  }

  @Post('maintenance-notices')
  @HttpCode(201)
  async createMaintenanceNotice(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.health.createNotice(
        actor,
        parseWith(CreateMaintenanceNoticeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Post('maintenance-notices/:noticeId/cancellation')
  @HttpCode(201)
  async cancelMaintenanceNotice(
    @CurrentActor() actor: RequestActor,
    @Param('noticeId') noticeId: string,
    @IdempotencyKey() key: string,
    @RequestId() rid: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return replayed(
      res,
      await this.health.cancelNotice(
        actor,
        id(noticeId),
        parseWith(CancelMaintenanceNoticeRequest, body),
        ctx(key, rid),
      ),
    );
  }

  @Get('setup-checklist')
  setupChecklist(@CurrentActor() actor: RequestActor) {
    return this.experience.setupChecklist(actor);
  }
}

/** The person's own experience endpoints: which capabilities they see, and what they did. */
@Controller('api/me')
export class MeAdminController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly experience: ExperienceService,
  ) {}

  @Get('features')
  features(@CurrentActor() actor: RequestActor) {
    return this.flags.effective(actor);
  }

  @Get('activity')
  activity(@CurrentActor() actor: RequestActor, @Query() query: unknown) {
    return this.experience.myActivity(actor, parseWith(ActivityQuery, query));
  }
}
