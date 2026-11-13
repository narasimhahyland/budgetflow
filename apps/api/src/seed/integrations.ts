import { CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import {
  encryptSecret,
  integrationsConfig,
  newBearerSecret,
  sha256Hex,
} from '@bf/api/integrations';
import {
  P12_API_KEY,
  P12_CONNECTIONS,
  P12_IDS,
  P12_MAPPINGS,
  P12_WEBHOOK_ENDPOINT,
  TENANTS,
  userById,
} from '@bf/seed';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Module({ imports: [CoreModule] })
class IntegrationsSeedModule {}

/**
 * Phase 12 deterministic seed: connected systems in Mock mode, their mappings, one connection whose
 * credentials the provider rejects, a scoped API key and a webhook endpoint aimed at the mock
 * receiver. Credentials are dev-only placeholders, stored encrypted and referenced by id.
 */
export async function seedIntegrations(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(IntegrationsSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    const admin = userById('integration-admin');
    const mockBase = integrationsConfig().mockBaseUrl;
    await s.withTenant(db, { tenantId: TENANTS.acme, subject: 'seed:p12' }, async (tx) => {
      for (const c of P12_CONNECTIONS) {
        const enc = encryptSecret(c.credential);
        await tx
          .insert(s.integrationSecrets)
          .values({
            id: c.secretId,
            tenantId: TENANTS.acme,
            purpose: `connector:${c.provider}`,
            ...enc,
          })
          .onConflictDoNothing();
        await tx
          .insert(s.integrationConnections)
          .values({
            id: c.id,
            tenantId: TENANTS.acme,
            provider: c.provider,
            category: c.category,
            displayName: c.displayName,
            mode: c.mode,
            status: c.status,
            attention: c.attention,
            baseUrl: null,
            accountRef: c.accountRef,
            secretRef: c.secretId,
            secretSetAt: new Date('2026-11-02T09:00:00Z'),
            secretSetBy: admin.personId,
            settings: c.settings,
            schedules: c.schedules.map((x) => ({ ...x, nextRunAt: null })),
            cursors: {},
            createdBy: admin.personId,
          })
          .onConflictDoNothing();
      }

      for (const m of P12_MAPPINGS) {
        await tx
          .insert(s.integrationMappings)
          .values({
            tenantId: TENANTS.acme,
            connectionId: m.connectionId,
            kind: m.kind,
            externalValue: m.externalValue,
            internalValue: m.internalValue,
            approved: true,
          })
          .onConflictDoNothing();
      }

      // The widget's secret is generated at seed time and never printed: only its hash is stored.
      const key = newBearerSecret('live', TENANTS.acme);
      await tx
        .insert(s.apiKeys)
        .values({
          id: P12_API_KEY.id,
          tenantId: TENANTS.acme,
          kind: 'public_api',
          name: P12_API_KEY.name,
          prefix: key.prefix,
          keyHash: sha256Hex(key.secret),
          scopes: [...P12_API_KEY.scopes],
          ownerPersonId: admin.personId,
          allowedCidrs: [],
          rateLimitPerMinute: P12_API_KEY.rateLimitPerMinute,
          // Fixed, see SEED_CREDENTIAL_EXPIRES_AT in @bf/seed.
          expiresAt: new Date(P12_API_KEY.expiresAt),
          createdBy: admin.personId,
        })
        .onConflictDoNothing();

      const webhookSecret = newBearerSecret('live', TENANTS.acme);
      const encWebhook = encryptSecret(webhookSecret.secret);
      await tx
        .insert(s.integrationSecrets)
        .values({
          id: P12_IDS.secrets.financeHubWebhook,
          tenantId: TENANTS.acme,
          purpose: 'webhook',
          ...encWebhook,
        })
        .onConflictDoNothing();
      await tx
        .insert(s.webhookEndpoints)
        .values({
          id: P12_WEBHOOK_ENDPOINT.id,
          tenantId: TENANTS.acme,
          url: `${mockBase}${P12_WEBHOOK_ENDPOINT.path}`,
          description: P12_WEBHOOK_ENDPOINT.description,
          events: [...P12_WEBHOOK_ENDPOINT.events],
          status: 'active',
          secretRef: P12_IDS.secrets.financeHubWebhook,
          createdBy: admin.personId,
        })
        .onConflictDoNothing();
    });
  } finally {
    await ctx.close();
  }
}
