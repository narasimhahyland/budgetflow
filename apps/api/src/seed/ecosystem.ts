import { CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import { integrationsConfig, newBearerSecret, sha256Hex } from '@bf/api/integrations';
import {
  P16_CONNECTIONS,
  P16_PARTNERS,
  P16_PARTNER_VENDORS,
  P16_SURFACES,
  P16_WIDGETS,
  TENANTS,
  userById,
} from '@bf/seed';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';

@Module({ imports: [CoreModule] })
class EcosystemSeedModule {}

const DAY_MS = 86_400_000;

/**
 * Phase 16 deterministic seed: the BI connector and the connector for AI assistants on, Zapier
 * allowed and the other platforms not, three marketplace partners and two embeddable widgets, plus
 * one personal connection of each kind so the admin screens are not empty.
 *
 * Expiry dates are computed from the moment the seed runs, never written as fixed timestamps, so a
 * stack seeded today and a stack seeded in six months both show live connections rather than a
 * screen full of expired ones.
 */
export async function seedEcosystem(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(EcosystemSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    const admin = userById('integration-admin');
    const partnerBase = integrationsConfig().mockBaseUrl;
    await s.withTenant(db, { tenantId: TENANTS.acme, subject: 'seed:p16' }, async (tx) => {
      // Partner vendors first: a partner cannot be enabled without an approved vendor behind it.
      for (const v of P16_PARTNER_VENDORS) {
        await tx
          .insert(s.vendors)
          .values({
            id: v.id,
            tenantId: TENANTS.acme,
            name: v.name,
            status: v.status,
            category: v.category,
            country: v.country,
            erpVendorId: v.erpVendorId,
          })
          .onConflictDoNothing();
      }

      for (const [surface, config] of Object.entries(P16_SURFACES)) {
        const { enabled, ...rest } = config as { enabled: boolean } & Record<string, unknown>;
        await tx
          .insert(s.ecosystemSurfaces)
          .values({
            tenantId: TENANTS.acme,
            surface,
            enabled,
            config: rest,
            updatedBy: admin.personId,
          })
          .onConflictDoNothing();
      }

      // The 113a switch the assistant connector also needs; without it the tools refuse.
      await tx
        .insert(s.featureFlags)
        .values({ tenantId: TENANTS.acme, key: 'ai.mcp', enabled: true })
        .onConflictDoNothing();

      for (const p of P16_PARTNERS) {
        await tx
          .insert(s.marketplacePartners)
          .values({
            id: p.id,
            tenantId: TENANTS.acme,
            name: p.name,
            slug: p.slug,
            categories: p.categories,
            cities: p.cities,
            vendorId: p.vendorId,
            mode: 'mock',
            status: p.status,
            baseUrl: partnerBase,
            createdBy: admin.personId,
          })
          .onConflictDoNothing();
      }

      for (const w of P16_WIDGETS) {
        await tx
          .insert(s.embeddedWidgets)
          .values({
            id: w.id,
            tenantId: TENANTS.acme,
            name: w.name,
            kind: w.kind,
            allowedOrigins: w.allowedOrigins,
            showAmounts: w.showAmounts,
            eventCount: w.eventCount,
            createdBy: admin.personId,
          })
          .onConflictDoNothing();
      }

      for (const c of P16_CONNECTIONS) {
        const [existing] = await tx
          .select({ id: s.ecosystemConnections.id })
          .from(s.ecosystemConnections)
          .where(eq(s.ecosystemConnections.id, c.id));
        if (existing) continue;
        const person = userById(c.userId);
        // A fresh token every seed run, and only its hash is kept: nothing in the repository or in
        // the seed output is a usable credential. Scenarios make their own connections.
        const { secret, prefix } = newBearerSecret(
          c.kind === 'bi' ? 'bi' : c.kind === 'assistant' ? 'mcp' : 'auto',
          TENANTS.acme,
        );
        await tx.insert(s.ecosystemConnections).values({
          id: c.id,
          tenantId: TENANTS.acme,
          kind: c.kind,
          personId: person.personId,
          personSubject: person.subject,
          clientKey: c.clientKey,
          label: c.label,
          tokenPrefix: prefix,
          tokenHash: sha256Hex(secret),
          grants: c.grants,
          consentText: c.consentText,
          expiresAt: new Date(Date.now() + c.lifetimeDays * DAY_MS),
        });
      }
    });
  } finally {
    await ctx.close();
  }
}
