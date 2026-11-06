import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AdminSettings,
  BrandingSettings as BrandingContract,
  DocumentSettings,
  NotificationSettings,
  SecuritySettings,
  UpdateBrandingRequest,
  UpdateDocumentSettingsRequest,
  UpdateNotificationDefaultsRequest,
  UpdateSecuritySettingsRequest,
} from '@bf/contracts';
import {
  ALLOWED_CONTENT_TYPES,
  DOCUMENT_KIND_DEFAULTS,
  MAX_DOCUMENT_BYTES,
  NOTIFICATION_DEFAULTS,
  validateBranding,
  validateDocumentKind,
  validateNotificationDefault,
  validateQuietHours,
  validateSessionSettings,
  type NotificationChannel,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import {
  assertAnyTenant,
  assertTenant,
  canTenant,
  readAdminSettings,
  writeAdminSection,
  type CommandContext,
  type StoredAdminSettings,
} from './admin-reads';

const SSO_NOTE =
  'People sign in through Hyland single sign-on; local accounts are for test and service users only.';
const MFA_NOTE =
  'Optional per user (company decision). People turn multi-factor authentication on in their profile.';
const BREAK_GLASS_NOTE =
  'The platform operator cannot see financial data. In an emergency they request time-limited, read-only access that an Organization Admin must approve, and everything they do is audited.';
const DOCUMENT_NOTE =
  'Who can see a document always follows the record it belongs to. These rules only narrow downloads; there are no public links.';

/** Company settings: branding (102b), notification defaults (109), documents (110), security (112). */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /** Actions that may change each section, so the UI can hide what the API would refuse. */
  private allowedActions(actor: RequestActor): string[] {
    const actions: string[] = [];
    if (canTenant(this.policy, actor, 'tenant.settings.manage')) {
      actions.push('branding', 'notifications', 'security');
    }
    if (
      canTenant(this.policy, actor, 'tenant.settings.manage') ||
      canTenant(this.policy, actor, 'master_data.manage')
    ) {
      actions.push('documents');
    }
    return actions;
  }

  read(actor: RequestActor): Promise<AdminSettings> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const stored = await readAdminSettings(tx, actor.tenantId);
      return {
        branding: stored.branding,
        notifications: this.notificationsView(stored),
        documents: this.documentsView(stored),
        security: this.securityView(stored),
        allowedActions: this.allowedActions(actor),
      };
    });
  }

  private notificationsView(stored: StoredAdminSettings): NotificationSettings {
    return {
      defaults: NOTIFICATION_DEFAULTS.map((d) => ({
        type: d.type,
        name: d.name,
        audience: d.audience,
        required: d.required,
        channels: stored.notificationChannels[d.type] ?? [...d.defaultChannels],
        allowOptOut: d.allowOptOut,
      })),
      quietHours: {
        ...stored.quietHours,
        heldChannels: [...stored.quietHours.heldChannels],
      },
    };
  }

  private documentsView(stored: StoredAdminSettings): DocumentSettings {
    return {
      kinds: DOCUMENT_KIND_DEFAULTS.map((k) => {
        const s = stored.documentKinds[k.kind];
        return {
          kind: k.kind,
          name: k.name,
          usedOn: k.usedOn,
          allowedContentTypes: [...(s?.allowedContentTypes ?? k.allowedContentTypes)],
          maxBytes: s?.maxBytes ?? k.maxBytes,
          downloadAllowed: s?.downloadAllowed ?? k.downloadAllowed,
          inlinePreview: s?.inlinePreview ?? k.inlinePreview,
        };
      }),
      allowedContentTypeList: [...ALLOWED_CONTENT_TYPES],
      maxBytesLimit: MAX_DOCUMENT_BYTES,
      note: DOCUMENT_NOTE,
    };
  }

  private securityView(stored: StoredAdminSettings): SecuritySettings {
    return {
      identityProviderName: 'Hyland single sign-on',
      singleSignOnConnected: true,
      multiFactorPolicy: MFA_NOTE,
      idleTimeoutMinutes: stored.security.idleTimeoutMinutes,
      maxSessionHours: stored.security.maxSessionHours,
      localAccountsForServiceUsersOnly: stored.security.localAccountsForServiceUsersOnly,
      biometricUnlockAllowed: stored.security.biometricUnlockAllowed,
      breakGlassNote: `${SSO_NOTE} ${BREAK_GLASS_NOTE}`,
    };
  }

  private async auditSection(
    tx: Tx,
    actor: RequestActor,
    ctx: CommandContext,
    section: string,
    changes: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: `admin.settings.${section}_changed`,
      resourceType: 'tenant_settings',
      resourceId: actor.tenantId,
      requestId: ctx.requestId,
      reason,
      changes,
    });
  }

  updateBranding(actor: RequestActor, req: UpdateBrandingRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.settings.branding',
        request: req,
        status: 200,
      },
      async (tx): Promise<BrandingContract> => {
        assertTenant(this.policy, actor, 'tenant.settings.manage');
        const stored = await readAdminSettings(tx, actor.tenantId);
        const next = {
          programName: req.programName,
          tagline: req.tagline,
          emailFooter: req.emailFooter,
          accentColor: req.accentColor,
        };
        const check = validateBranding(next);
        if (!check.ok) throw new ApiProblem(422, check.code, check.message);
        await writeAdminSection(tx, actor.tenantId, 'branding', next);
        await this.auditSection(
          tx,
          actor,
          ctx,
          'branding',
          { branding: { from: stored.branding, to: next } },
          req.reason,
        );
        return next;
      },
    );
  }

  updateNotifications(
    actor: RequestActor,
    req: UpdateNotificationDefaultsRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.settings.notifications',
        request: req,
        status: 200,
      },
      async (tx): Promise<NotificationSettings> => {
        assertTenant(this.policy, actor, 'tenant.settings.manage');
        const stored = await readAdminSettings(tx, actor.tenantId);
        const channels: Record<string, NotificationChannel[]> = { ...stored.notificationChannels };
        for (const row of req.defaults) {
          const definition = NOTIFICATION_DEFAULTS.find((d) => d.type === row.type);
          if (!definition) throw ApiProblem.notFound(`notification type ${row.type}`);
          const check = validateNotificationDefault(definition, row.channels);
          if (!check.ok) throw new ApiProblem(409, check.code, check.message);
          channels[row.type] = [...row.channels];
        }
        if (req.quietHours) {
          const check = validateQuietHours(req.quietHours);
          if (!check.ok) throw new ApiProblem(422, check.code, check.message);
          await writeAdminSection(tx, actor.tenantId, 'quietHours', req.quietHours);
        }
        await writeAdminSection(tx, actor.tenantId, 'notificationChannels', channels);
        await this.auditSection(
          tx,
          actor,
          ctx,
          'notifications',
          {
            types: req.defaults.map((d) => ({
              type: d.type,
              from: stored.notificationChannels[d.type] ?? [],
              to: d.channels,
            })),
            quietHours: req.quietHours
              ? { from: stored.quietHours, to: req.quietHours }
              : undefined,
          },
          req.reason,
        );
        const after = await readAdminSettings(tx, actor.tenantId);
        return this.notificationsView(after);
      },
    );
  }

  updateDocuments(actor: RequestActor, req: UpdateDocumentSettingsRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.settings.documents',
        request: req,
        status: 200,
      },
      async (tx): Promise<DocumentSettings> => {
        assertAnyTenant(this.policy, actor, ['tenant.settings.manage', 'master_data.manage']);
        const stored = await readAdminSettings(tx, actor.tenantId);
        const kinds = { ...stored.documentKinds };
        for (const row of req.kinds) {
          const definition = DOCUMENT_KIND_DEFAULTS.find((k) => k.kind === row.kind);
          if (!definition) throw ApiProblem.notFound(`document kind ${row.kind}`);
          const check = validateDocumentKind({ ...definition, ...row });
          if (!check.ok) throw new ApiProblem(422, check.code, check.message);
          kinds[row.kind] = {
            allowedContentTypes: [...row.allowedContentTypes],
            maxBytes: row.maxBytes,
            downloadAllowed: row.downloadAllowed,
            inlinePreview: row.inlinePreview,
          };
        }
        await writeAdminSection(tx, actor.tenantId, 'documentKinds', kinds);
        await this.auditSection(
          tx,
          actor,
          ctx,
          'documents',
          {
            kinds: req.kinds.map((k) => ({
              kind: k.kind,
              from: stored.documentKinds[k.kind],
              to: {
                allowedContentTypes: k.allowedContentTypes,
                maxBytes: k.maxBytes,
                downloadAllowed: k.downloadAllowed,
                inlinePreview: k.inlinePreview,
              },
            })),
          },
          req.reason,
        );
        const after = await readAdminSettings(tx, actor.tenantId);
        return this.documentsView(after);
      },
    );
  }

  updateSecurity(actor: RequestActor, req: UpdateSecuritySettingsRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.settings.security',
        request: req,
        status: 200,
      },
      async (tx): Promise<SecuritySettings> => {
        assertTenant(this.policy, actor, 'tenant.settings.manage');
        const stored = await readAdminSettings(tx, actor.tenantId);
        const next = {
          idleTimeoutMinutes: req.idleTimeoutMinutes,
          maxSessionHours: req.maxSessionHours,
          localAccountsForServiceUsersOnly: req.localAccountsForServiceUsersOnly,
          biometricUnlockAllowed: req.biometricUnlockAllowed,
        };
        const check = validateSessionSettings(next);
        if (!check.ok) throw new ApiProblem(422, check.code, check.message);
        await writeAdminSection(tx, actor.tenantId, 'security', next);
        await this.auditSection(
          tx,
          actor,
          ctx,
          'security',
          { security: { from: stored.security, to: next } },
          req.reason,
        );
        const after = await readAdminSettings(tx, actor.tenantId);
        return this.securityView(after);
      },
    );
  }
}
