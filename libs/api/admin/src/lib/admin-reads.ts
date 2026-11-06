import { ApiProblem, PolicyService, type RequestActor } from '@bf/api/core';
import { people, tenantSettings, type Tx } from '@bf/api/db';
import {
  BRANDING_DEFAULTS,
  DOCUMENT_KIND_DEFAULTS,
  NOTIFICATION_DEFAULTS,
  QUIET_HOURS_DEFAULTS,
  SESSION_DEFAULTS,
  type Action,
  type BrandingSettings,
  type DocumentKindSettings,
  type NotificationChannel,
  type QuietHoursSettings,
  type SessionSettings,
} from '@bf/domain';
import { eq, inArray } from 'drizzle-orm';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

/** Every administration endpoint authorizes against the tenant resource. */
export function assertTenant(
  policy: PolicyService,
  actor: RequestActor,
  action: Action,
  what = 'administration area',
): void {
  policy.assert(actor, action, { kind: 'tenant', tenantId: actor.tenantId }, what);
}

export function canTenant(policy: PolicyService, actor: RequestActor, action: Action): boolean {
  return policy.can(actor, action, { kind: 'tenant', tenantId: actor.tenantId }).allowed;
}

/** First action the actor holds, or a 403 naming none of them. */
export function assertAnyTenant(
  policy: PolicyService,
  actor: RequestActor,
  actions: readonly Action[],
): Action {
  const held = actions.find((a) => canTenant(policy, actor, a));
  if (!held) throw ApiProblem.forbidden();
  return held;
}

/** Display names for the people referenced by a list, so responses never carry bare ids. */
export async function personNames(
  tx: Tx,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: people.id, displayName: people.displayName })
    .from(people)
    .where(inArray(people.id, unique));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/**
 * The administration sections stored in `tenant_settings.settings` under `admin`. Anything the tenant
 * has not changed falls back to the defaults in `libs/domain`.
 */
export interface StoredAdminSettings {
  branding: BrandingSettings;
  notificationChannels: Record<string, NotificationChannel[]>;
  quietHours: QuietHoursSettings;
  documentKinds: Record<string, Omit<DocumentKindSettings, 'kind' | 'name' | 'usedOn'>>;
  security: SessionSettings;
}

type SettingsBlob = Record<string, unknown> & { admin?: Partial<StoredAdminSettings> };

export async function readAdminSettings(tx: Tx, tenantId: string): Promise<StoredAdminSettings> {
  const [row] = await tx
    .select({ settings: tenantSettings.settings })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  const stored = ((row?.settings ?? {}) as SettingsBlob).admin ?? {};
  return {
    branding: { ...BRANDING_DEFAULTS, ...(stored.branding ?? {}) },
    notificationChannels: {
      ...Object.fromEntries(
        NOTIFICATION_DEFAULTS.map((d) => [d.type, [...d.defaultChannels] as NotificationChannel[]]),
      ),
      ...(stored.notificationChannels ?? {}),
    },
    quietHours: { ...QUIET_HOURS_DEFAULTS, ...(stored.quietHours ?? {}) },
    documentKinds: {
      ...Object.fromEntries(
        DOCUMENT_KIND_DEFAULTS.map((k) => [
          k.kind,
          {
            allowedContentTypes: [...k.allowedContentTypes],
            maxBytes: k.maxBytes,
            downloadAllowed: k.downloadAllowed,
            inlinePreview: k.inlinePreview,
          },
        ]),
      ),
      ...(stored.documentKinds ?? {}),
    },
    security: { ...SESSION_DEFAULTS, ...(stored.security ?? {}) },
  };
}

/** Writes one section back, leaving the rest of `tenant_settings.settings` untouched. */
export async function writeAdminSection<K extends keyof StoredAdminSettings>(
  tx: Tx,
  tenantId: string,
  section: K,
  value: StoredAdminSettings[K],
): Promise<void> {
  const [row] = await tx
    .select({ settings: tenantSettings.settings })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  const blob = (row?.settings ?? {}) as SettingsBlob;
  const next: SettingsBlob = { ...blob, admin: { ...(blob.admin ?? {}), [section]: value } };
  if (row) {
    await tx
      .update(tenantSettings)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(tenantSettings.tenantId, tenantId));
    return;
  }
  await tx.insert(tenantSettings).values({ tenantId, settings: next });
}
