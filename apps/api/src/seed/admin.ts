import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import {
  ADMIN_FEATURE_FLAGS,
  ADMIN_LEGAL_HOLDS,
  ADMIN_MAINTENANCE_NOTICE,
  ADMIN_OWNER_INVITES,
  ADMIN_PENDING_FLAG_CHANGE,
  TENANTS,
} from '@bf/seed';
import { RETENTION_CATALOG } from '@bf/domain';
import type { INestApplicationContext } from '@nestjs/common';

const T = TENANTS.acme;

/**
 * Phase 14 fixtures: retention periods at their provisional defaults, the capability switches with
 * one pilot and one money-affecting change waiting for the Finance Controller, an active and a
 * released legal hold, a planned maintenance notice and two owner invitations.
 * Idempotent: fixed ids with ON CONFLICT DO NOTHING.
 */
export async function seedAdmin(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  await withTenant(db, { tenantId: T, subject: 'seed' }, async (tx) => {
    await tx
      .insert(s.retentionPolicies)
      .values(
        RETENTION_CATALOG.map((c) => ({
          tenantId: T,
          category: c.category,
          periodDays: c.defaultPeriodDays,
          action: c.action,
          minimumDays: c.minimumDays,
          locked: c.locked,
          signoffStatus: 'provisional',
          signoffNote:
            'Provisional default from the product. Finance and legal still have to sign this period off.',
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(s.featureFlags)
      .values([...ADMIN_FEATURE_FLAGS])
      .onConflictDoNothing();

    await tx
      .insert(s.adminChangeRequests)
      .values([{ ...ADMIN_PENDING_FLAG_CHANGE }])
      .onConflictDoNothing();

    await tx
      .insert(s.legalHolds)
      .values(
        ADMIN_LEGAL_HOLDS.map((h) => ({
          ...h,
          confirmedAt: new Date('2026-11-01T09:00:00.000Z'),
          releasedAt: h.status === 'released' ? new Date('2026-11-03T09:00:00.000Z') : null,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(s.maintenanceNotices)
      .values([
        {
          ...ADMIN_MAINTENANCE_NOTICE,
          startsAt: new Date(ADMIN_MAINTENANCE_NOTICE.startsAt),
          endsAt: new Date(ADMIN_MAINTENANCE_NOTICE.endsAt),
          showFrom: new Date(ADMIN_MAINTENANCE_NOTICE.showFrom),
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.ownerInvites)
      .values(ADMIN_OWNER_INVITES.map((i) => ({ ...i, expiresAt: new Date(i.expiresAt) })))
      .onConflictDoNothing();
  });
}
