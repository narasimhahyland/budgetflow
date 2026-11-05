import { BUDGET_CONTROL_TOPIC, BudgetControlConsumer } from '@bf/api/contributions';
import { DB } from '@bf/api/core';
import { outboxMessages, tenants, withTenant, type Db } from '@bf/api/db';
import { LEDGER_CHECK_TOPIC, RebuildService } from '@bf/api/integrity';
import { EMAIL_TOPIC, NotificationsService, type EmailPayload } from '@bf/api/notifications';
import { BUDGET_THRESHOLD_TOPIC, BudgetAlertsConsumer, type ThresholdCrossed } from '@bf/api/spend';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';

const NIGHTLY = 'integrity.nightly';
const DEAD_LETTER = 'integrity.dead-letter';
const BUDGET_EVENT_TOPICS = ['budget.change_requested'] as const;

/**
 * Drains the transactional outbox into pg-boss and runs jobs. Jobs are idempotent (keyed by a business
 * id), retry with exponential backoff, and end in a dead-letter queue. Every job sets the tenant context.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private boss?: PgBoss;
  private timer?: NodeJS.Timeout;
  private draining = false;
  ready = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rebuild: RebuildService,
    private readonly notifications: NotificationsService,
    private readonly controls: BudgetControlConsumer,
    private readonly alerts: BudgetAlertsConsumer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: 'pgboss' });
    boss.on('error', (e: Error) => this.log.error(`pg-boss: ${e.message}`));
    await boss.start();
    await boss.createQueue(DEAD_LETTER);
    await boss.createQueue(LEDGER_CHECK_TOPIC, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    await boss.createQueue(NIGHTLY, {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    // Budget change requests (Phase 4) only drain until approver notifications land.
    for (const topic of BUDGET_EVENT_TOPICS)
      await boss.createQueue(topic, { deadLetter: DEAD_LETTER });
    await boss.work<{ tenantId: string; checkRunId: string }>(LEDGER_CHECK_TOPIC, async (jobs) => {
      for (const job of jobs) {
        const outcome = await this.rebuild.run(job.data.tenantId, job.data.checkRunId);
        this.log.log(`ledger check ${job.data.checkRunId}: ${outcome}`);
      }
    });
    for (const topic of [EMAIL_TOPIC, BUDGET_CONTROL_TOPIC, BUDGET_THRESHOLD_TOPIC]) {
      await boss.createQueue(topic, {
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        deadLetter: DEAD_LETTER,
      });
    }
    const fast = { batchSize: 10, pollingIntervalSeconds: 0.5, burstWhenBatchFull: true } as const;
    await boss.work<EmailPayload>(EMAIL_TOPIC, fast, async (jobs) => {
      for (const job of jobs) await this.notifications.deliver(job.data);
    });
    await boss.work<{ tenantId: string; budgetId: string; unfitRequestIds?: string[] }>(
      BUDGET_CONTROL_TOPIC,
      fast,
      async (jobs) => {
        for (const job of jobs)
          await this.controls.handle(
            job.data.tenantId,
            job.data.budgetId,
            job.data.unfitRequestIds ?? [],
          );
      },
    );
    await boss.work<ThresholdCrossed>(BUDGET_THRESHOLD_TOPIC, fast, async (jobs) => {
      for (const job of jobs) await this.alerts.handle(job.data);
    });
    await boss.work(NIGHTLY, async () => {
      const n = await this.rebuild.runNightly();
      this.log.log(`nightly ledger rebuild check ran for ${n} tenant(s)`);
    });
    await boss.schedule(
      NIGHTLY,
      process.env.NIGHTLY_LEDGER_CHECK_CRON ?? '0 2 * * *',
      {},
      { tz: 'UTC' },
    );
    this.boss = boss;
    this.timer = setInterval(
      () => void this.drainOutbox(),
      Number(process.env.OUTBOX_POLL_MS ?? 1000),
    );
    this.ready = true;
    this.log.log(
      'worker ready: outbox drain, email, budget-control, budget-alert and integrity jobs running',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }

  /** Publishes unpublished outbox rows per tenant; the job's singleton key makes publication idempotent. */
  async drainOutbox(): Promise<void> {
    if (this.draining || !this.boss) return;
    this.draining = true;
    try {
      const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
      for (const t of all) {
        await withTenant(this.db, { tenantId: t.id, subject: 'system:worker' }, async (tx) => {
          const pending = await tx
            .select()
            .from(outboxMessages)
            .where(and(isNull(outboxMessages.publishedAt), eq(outboxMessages.tenantId, t.id)))
            .orderBy(asc(outboxMessages.createdAt))
            .limit(50)
            .for('update', { skipLocked: true });
          for (const m of pending) {
            try {
              await this.boss!.send(
                m.topic,
                { tenantId: m.tenantId, ...(m.payload as object) },
                { singletonKey: m.id },
              );
              await tx
                .update(outboxMessages)
                .set({ publishedAt: new Date(), attempts: sql`${outboxMessages.attempts} + 1` })
                .where(eq(outboxMessages.id, m.id));
            } catch (e) {
              await tx
                .update(outboxMessages)
                .set({
                  attempts: sql`${outboxMessages.attempts} + 1`,
                  lastError: (e as Error).message.slice(0, 500),
                })
                .where(eq(outboxMessages.id, m.id));
            }
          }
        });
      }
    } catch (e) {
      this.log.error(`outbox drain failed: ${(e as Error).message}`);
    } finally {
      this.draining = false;
    }
  }
}
