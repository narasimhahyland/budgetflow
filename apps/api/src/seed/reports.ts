import { CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import { P10_EXPORT, P10_SAVED_VIEWS, P10_SCHEDULE_RUN, P10_SCHEDULES, TENANTS } from '@bf/seed';
import { nextRunAt } from '@bf/domain';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Module({ imports: [CoreModule] })
class ReportsSeedModule {}

const LAST_RUN = new Date('2026-11-02T02:30:00Z');

/**
 * Phase 10 deterministic seed: saved report views, the three scheduled deliveries of screen 091
 * with one delivered run, and the export that run produced.
 */
export async function seedReports(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(ReportsSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    await s.withTenant(db, { tenantId: TENANTS.acme, subject: 'seed:p10' }, async (tx) => {
      await tx
        .insert(s.reportSavedViews)
        .values(P10_SAVED_VIEWS.map((v) => ({ ...v, filters: v.filters as object })))
        .onConflictDoNothing();

      await tx
        .insert(s.reportSchedules)
        .values(
          P10_SCHEDULES.map((sch) => ({
            ...sch,
            filters: sch.filters as object,
            formats: [...sch.formats],
            channels: sch.channels.map((c) => ({ ...c })),
            recipientPersonIds: [...sch.recipientPersonIds],
            lastRunAt: sch.lastRunStatus ? LAST_RUN : null,
            nextRunAt: nextRunAt(
              {
                frequency: sch.frequency,
                weekday: sch.weekday,
                dayOfMonth: sch.dayOfMonth,
                sendTime: sch.sendTime,
                timezone: sch.timezone,
              },
              LAST_RUN,
            ),
          })),
        )
        .onConflictDoNothing();

      await tx
        .insert(s.reportExports)
        .values({
          ...P10_EXPORT,
          filters: P10_EXPORT.filters as object,
          requestedAt: LAST_RUN,
          expiresAt: new Date(LAST_RUN.getTime() + 7 * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();

      await tx
        .insert(s.reportScheduleRuns)
        .values({
          ...P10_SCHEDULE_RUN,
          runAt: LAST_RUN,
          skipped: [] as object[],
          exportIds: [...P10_SCHEDULE_RUN.exportIds],
        })
        .onConflictDoNothing();
    });
  } finally {
    await ctx.close();
  }
}
