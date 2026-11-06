import { OWNER_INVITED_TOPIC, RETENTION_SWEEP_TOPIC, RetentionService } from '@bf/api/admin';
import { SLA_SWEEP_TOPIC, SlaSweepService } from '@bf/api/approvals';
import { BUDGET_CONTROL_TOPIC, BudgetControlConsumer } from '@bf/api/contributions';
import { CHANNEL_DELIVER_TOPIC, ChannelsService, type ChannelDeliverJob } from '@bf/api/channels';
import { DB } from '@bf/api/core';
import { WebhooksService } from '@bf/api/integrations';
import { outboxMessages, tenants, withTenant, type Db } from '@bf/api/db';
import { LEDGER_CHECK_TOPIC, RebuildService } from '@bf/api/integrity';
import { EMAIL_TOPIC, NotificationsService, type EmailPayload } from '@bf/api/notifications';
import {
  BOARD_PACK_TOPIC,
  BoardPackService,
  REPORT_DELIVER_TOPIC,
  REPORT_SWEEP_TOPIC,
  ReportDeliveryService,
  type BoardPackJob,
  type ReportDeliverJob,
} from '@bf/api/reports';
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
  private webhookTimer?: NodeJS.Timeout;
  private draining = false;
  private deliveringWebhooks = false;
  ready = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rebuild: RebuildService,
    private readonly notifications: NotificationsService,
    private readonly controls: BudgetControlConsumer,
    private readonly alerts: BudgetAlertsConsumer,
    private readonly channels: ChannelsService,
    private readonly slaSweep: SlaSweepService,
    private readonly reportDelivery: ReportDeliveryService,
    private readonly boardPacks: BoardPackService,
    private readonly webhooks: WebhooksService,
    private readonly retention: RetentionService,
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
    for (const topic of [
      EMAIL_TOPIC,
      BUDGET_CONTROL_TOPIC,
      BUDGET_THRESHOLD_TOPIC,
      CHANNEL_DELIVER_TOPIC,
      REPORT_DELIVER_TOPIC,
      BOARD_PACK_TOPIC,
    ]) {
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
    await boss.work<ChannelDeliverJob>(CHANNEL_DELIVER_TOPIC, fast, async (jobs) => {
      for (const job of jobs) await this.channels.deliverChannelJob(job.data);
    });
    // Scheduled report delivery (screen 091): render with the owner's scope, email the recipients
    // who may see the same data, post headline figures to the allowed channels.
    await boss.work<ReportDeliverJob>(REPORT_DELIVER_TOPIC, fast, async (jobs) => {
      for (const job of jobs) await this.reportDelivery.deliver(job.data);
    });
    // Board and FP&A pack generation (16a): renders the pages into the DocumentStore. Keyed by the
    // generation id, and a generation already `ready` is left alone, so a replay is a no-op.
    await boss.work<BoardPackJob>(BOARD_PACK_TOPIC, fast, async (jobs) => {
      for (const job of jobs) await this.boardPacks.render(job.data);
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
    // Escalates approvals that passed their service level to the next delegation-of-authority step.
    await boss.createQueue(SLA_SWEEP_TOPIC, {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    await boss.work(SLA_SWEEP_TOPIC, async () => {
      const escalated = await this.slaSweep.runForAllTenants();
      this.log.log(`SLA sweep escalated ${escalated} overdue approval(s)`);
    });
    await boss.schedule(
      SLA_SWEEP_TOPIC,
      process.env.SLA_SWEEP_CRON ?? '*/30 * * * *',
      {},
      { tz: 'UTC' },
    );
    // Queues the scheduled report deliveries that fell due.
    await boss.createQueue(REPORT_SWEEP_TOPIC, {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    await boss.work(REPORT_SWEEP_TOPIC, async () => {
      const queued = await this.reportDelivery.sweepAllTenants();
      if (queued) this.log.log(`queued ${queued} scheduled report delivery job(s)`);
    });
    await boss.schedule(
      REPORT_SWEEP_TOPIC,
      process.env.REPORT_SWEEP_CRON ?? '*/5 * * * *',
      {},
      { tz: 'UTC' },
    );
    // Nightly data retention (111): fixed scope, legal holds always win, append-only run report.
    await boss.createQueue(RETENTION_SWEEP_TOPIC, {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    await boss.work(RETENTION_SWEEP_TOPIC, async () => {
      const n = await this.retention.runNightly();
      this.log.log(`nightly retention run ran for ${n} tenant(s)`);
    });
    await boss.schedule(
      RETENTION_SWEEP_TOPIC,
      process.env.RETENTION_SWEEP_CRON ?? '0 1 * * *',
      {},
      { tz: 'UTC' },
    );
    // Bulk owner invitations (103a): the invitation itself grants nothing.
    await boss.createQueue(OWNER_INVITED_TOPIC, {
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      deadLetter: DEAD_LETTER,
    });
    await boss.work<{
      tenantId: string;
      inviteId: string;
      email: string;
      displayName: string;
      proposedRole: string;
      expiresAt: string;
    }>(OWNER_INVITED_TOPIC, fast, async (jobs) => {
      for (const job of jobs) {
        const { tenantId, inviteId, email, displayName, proposedRole, expiresAt } = job.data;
        await this.notifications.deliver({
          tenantId,
          to: email,
          toName: displayName,
          subject: 'You have been invited to BudgetFlow',
          text: `Hello ${displayName}, you have been invited to BudgetFlow as ${proposedRole}. Sign in with your Hyland account before ${expiresAt.slice(0, 10)}.`,
          html: `<p>Hello ${displayName},</p><p>You have been invited to BudgetFlow as ${proposedRole}. Sign in with your Hyland account before ${expiresAt.slice(0, 10)}.</p>`,
          kind: 'owner_invite',
          subjectType: 'owner_invite',
          subjectId: inviteId,
        });
      }
    });
    this.boss = boss;
    this.timer = setInterval(
      () => void this.drainOutbox(),
      Number(process.env.OUTBOX_POLL_MS ?? 1000),
    );
    // Phase 12: deliveries the outbox drain created, plus anything due for a retry (101). A timer
    // rather than a queued job, so a delivery is never looked for before its row is committed.
    this.webhookTimer = setInterval(
      () => void this.deliverWebhooks(),
      Number(process.env.WEBHOOK_POLL_MS ?? 2000),
    );
    this.ready = true;
    this.log.log(
      'worker ready: outbox drain, email, budget-control, budget-alert and integrity jobs running',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.webhookTimer) clearInterval(this.webhookTimer);
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }

  /** Sends webhook deliveries that are pending or due for a retry. */
  async deliverWebhooks(): Promise<void> {
    if (this.deliveringWebhooks) return;
    this.deliveringWebhooks = true;
    try {
      const sent = await this.webhooks.deliverDue();
      if (sent > 0) this.log.log(`delivered ${sent} webhook(s) to customer endpoints`);
    } catch (e) {
      this.log.error(`webhook delivery failed: ${(e as Error).message}`);
    } finally {
      this.deliveringWebhooks = false;
    }
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
              // Phase 12 reuses this drain: subscribed customer endpoints get a pending delivery,
              // written in the same transaction and sent by the webhook timer.
              await this.webhooks.fanOutFromOutbox(
                tx,
                m.tenantId,
                m.topic,
                m.payload as Record<string, unknown>,
                m.createdAt,
              );
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
