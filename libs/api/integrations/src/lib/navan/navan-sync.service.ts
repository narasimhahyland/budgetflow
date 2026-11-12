import { AuditService } from '@bf/api/audit';
import { ApiProblem, DB, nowUtc, todayUtc, type RequestActor } from '@bf/api/core';
import {
  actuals,
  budgets,
  costCenters,
  events,
  glAccounts,
  integrationConnections,
  integrationMappings,
  integrationPushes,
  people,
  syncRuns,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { DocumentsService } from '@bf/api/documents';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { ExceptionsService } from '@bf/api/rules';
import {
  type NavanSettings,
  type SyncObject,
  type SyncDirection,
  type SyncStatus,
} from '@bf/contracts';
import { acceptsNewActivity, availableOf, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { objectSpec, type InboundRecord } from '../connectors';
import {
  ConnectionsService,
  type ConnectionRow,
  type ConnectorContext,
} from '../connections.service';
import {
  CONNECTOR_SCOPES,
  connectorActor,
  SyncService,
  type ApplyOutcome,
  type NavanRunJob,
} from '../sync.service';
import {
  emptyStats,
  NavanClient,
  type NavanCallStats,
  type NavanConnection,
  type NavanOperation,
} from './navan-client';
import { navanConnectionOf, navanSettingsOf } from './navan-settings';
import { navanToRecord, type NavanTransaction, type NavanUser } from './navan-mapping';
import {
  NAVAN_TRANSACTION_TYPES,
  navanDefaultStart,
  navanNextCursor,
  navanWindows,
  parseNavanStart,
} from './navan-windows';

/** Event statuses whose code may still take spend in Navan. */
const SPENDABLE_EVENT_STATUSES = new Set([
  'approved',
  'funded',
  'in_progress',
  'completed',
  'reconciling',
]);

type OptionKind = 'event_code' | 'cost_center';

interface RunResult {
  status: SyncStatus;
  read: number;
  outcome: ApplyOutcome;
  nextCursor: string | null;
}

interface DesiredOption {
  value: string;
  label: string;
  active: boolean;
  eventId: string | null;
  why: string;
}

const empty = (): ApplyOutcome => ({
  applied: 0,
  duplicates: 0,
  failed: 0,
  importBatchId: null,
  note: null,
});

/** The actor a Navan job runs as: the person who started it (or the system), with connector scopes. */
function workerActor(tenantId: string, job?: NavanRunJob['actor']): RequestActor {
  return {
    tenantId,
    personId: job?.personId ?? null,
    roles: [],
    ownedBudgetPaths: [],
    subject: 'connector:navan',
    displayName: job?.displayName ?? 'BudgetFlow',
    tenantName: '',
    reportingCurrency: (job?.reportingCurrency ?? 'USD') as CurrencyCode,
    memberships: [],
    serviceScopes: CONNECTOR_SCOPES,
  };
}

/**
 * Phase 16a: everything BudgetFlow does with Navan, run in the worker.
 *
 * Inbound, transactions of every type are read by modified-date windows of at most 93 days, page by
 * page, and become one actuals review batch per run (the Phase 6 path: source references are unique,
 * cross-source duplicates against other card feeds are flagged before matching, matching proposes
 * by event code and cost center). Receipts are copied into the DocumentStore while their presigned
 * links are valid; expired links are looked up again in bulk. Users map to people by email.
 *
 * Outbound, event codes and cost centers are published as options of the mapped list fields through
 * Navan's async batch jobs, and an option is switched off while its budget does not accept spend
 * (frozen, set to zero, exhausted, expired, closed) and on again when it does. Coding is written
 * back by batch PATCH. Navan's ERP sync status is set only when BudgetFlow is the system of record.
 *
 * Nothing here approves anything in Navan: Navan approves trips and expenses under its own policy,
 * and spend above the remaining budget becomes a post-spend exception for Finance.
 */
@Injectable()
export class NavanSyncService {
  private readonly log = new Logger('NavanSync');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly connections: ConnectionsService,
    private readonly sync: SyncService,
    private readonly client: NavanClient,
    private readonly exceptions: ExceptionsService,
    private readonly documents: DocumentsService,
    private readonly ledgerReads: LedgerReads,
    private readonly audit: AuditService,
  ) {}

  navanConnection(row: ConnectionRow, credential: string): NavanConnection {
    return navanConnectionOf(row, credential);
  }

  // Jobs --------------------------------------------------------------------------------------

  /** Runs one queued run. A run that is no longer `running` was finished already: a replay is a no-op. */
  async execute(job: NavanRunJob): Promise<void> {
    const loaded = await withTenant(
      this.db,
      { tenantId: job.tenantId, subject: 'system:worker' },
      async (tx) => {
        const [run] = await tx.select().from(syncRuns).where(eq(syncRuns.id, job.runId));
        if (!run || run.status !== 'running') return null;
        const row = await this.connections.rowOrFail(tx, run.connectionId);
        return { run, row, context: await this.connections.contextFor(tx, row) };
      },
    );
    if (!loaded) return;
    await this.runLoaded(
      workerActor(job.tenantId, job.actor),
      loaded.run,
      loaded.row,
      loaded.context,
      job.requestId,
      job.windowEnd ? new Date(job.windowEnd) : nowUtc(),
    );
  }

  /**
   * A budget control changed (worker job on `budget.control_changed`): republish the event-code
   * options of the events on that budget. The run is diff-based, so only options whose state changed
   * are sent; a replay sends nothing.
   */
  async refreshForBudget(tenantId: string, budgetId: string): Promise<void> {
    const prepared = await withTenant(
      this.db,
      { tenantId, subject: 'system:worker' },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.provider, 'navan'),
              isNull(integrationConnections.disconnectedAt),
            ),
          );
        if (!row || row.pausedAt) return null;
        const settings = navanSettingsOf(row);
        if (!settings.expenseWrite || !settings.eventCodeFieldId) return null;
        const affected = await tx
          .select({ id: events.id })
          .from(events)
          .where(eq(events.budgetId, budgetId))
          .limit(1);
        if (affected.length === 0) return null;
        const [run] = await tx
          .insert(syncRuns)
          .values({
            tenantId,
            connectionId: row.id,
            object: 'event_codes',
            direction: 'outbound',
            mode: row.mode,
            status: 'running',
            cursor: null,
            idempotencyKey: `navan-control:${row.id}:${budgetId}:${Date.now()}`,
            triggeredBy: null,
          })
          .returning();
        return { run, row, context: await this.connections.contextFor(tx, row) };
      },
    );
    if (!prepared) return;
    await this.runLoaded(
      workerActor(tenantId),
      prepared.run,
      prepared.row,
      prepared.context,
      null,
      nowUtc(),
    );
  }

  private async runLoaded(
    actor: RequestActor,
    run: typeof syncRuns.$inferSelect,
    row: ConnectionRow,
    context: ConnectorContext,
    requestId: string | null,
    windowEnd: Date,
  ): Promise<void> {
    const object = run.object as SyncObject;
    const direction = run.direction as SyncDirection;
    const stats = emptyStats();
    let result: RunResult = {
      status: 'succeeded',
      read: 0,
      outcome: empty(),
      nextCursor: run.cursor,
    };
    let errorSummary: string | null = null;
    try {
      const conn = this.navanConnection(row, context.credential);
      const key = `${object}:${direction}`;
      if (key === 'transactions:inbound')
        result = await this.pullTransactions(
          actor,
          run,
          row,
          context,
          conn,
          stats,
          requestId,
          windowEnd,
        );
      else if (key === 'users:inbound') result = await this.pullUsers(actor, run, row, conn, stats);
      else if (key === 'event_codes:outbound')
        result = await this.publishOptions(actor, run, row, conn, 'event_code', stats, requestId);
      else if (key === 'cost_centers:outbound')
        result = await this.publishOptions(actor, run, row, conn, 'cost_center', stats, requestId);
      else if (key === 'transactions:outbound')
        result = await this.writeBack(run, row, conn, stats);
      else
        throw new ApiProblem(
          422,
          'CONNECTOR_OBJECT_UNSUPPORTED',
          `Navan does not exchange ${object} ${direction}.`,
        );
    } catch (e) {
      errorSummary = e instanceof ApiProblem ? e.detail : 'The Navan run could not be completed.';
      if (!(e instanceof ApiProblem))
        this.log.error(`navan run ${run.id} failed`, e instanceof Error ? e.stack : String(e));
      result = { ...result, status: 'failed' };
      await this.sync.recordFailure(actor, {
        connectionId: row.id,
        syncRunId: run.id,
        direction,
        item: `Navan ${object} ${direction} run`,
        error: errorSummary,
        statusCode: e instanceof ApiProblem ? Number(e.params?.statusCode ?? 0) || null : null,
        payload: { object, direction, cursor: run.cursor, ...stats },
        idempotencyKey: `sync:${run.id}`,
      });
    }
    await this.sync.finish(actor, {
      runId: run.id,
      connectionId: row.id,
      object,
      direction,
      status: result.status,
      read: result.read,
      outcome: result.outcome,
      nextCursor: result.nextCursor,
      errorSummary,
      requestId,
    });
  }

  // Inbound: transactions -----------------------------------------------------------------------

  private async pullTransactions(
    actor: RequestActor,
    run: typeof syncRuns.$inferSelect,
    row: ConnectionRow,
    context: ConnectorContext,
    conn: NavanConnection,
    stats: NavanCallStats,
    requestId: string | null,
    now: Date,
  ): Promise<RunResult> {
    const settings = navanSettingsOf(row);
    const start = parseNavanStart(run.cursor) ?? navanDefaultStart(now);
    const windows = navanWindows(start, now);
    const byId = new Map<string, NavanTransaction>();
    for (const type of NAVAN_TRANSACTION_TYPES) {
      for (const w of windows) {
        for await (const page of this.client.pages<NavanTransaction>(
          conn,
          `/${type}`,
          { modifiedFrom: w.from, modifiedTo: w.to },
          settings.pageSize,
          stats,
        )) {
          for (const t of page) {
            const prev = byId.get(t.id);
            if (!prev || prev.modifiedAt < t.modifiedAt) byId.set(t.id, t);
          }
        }
      }
    }

    // Receipt links last seven days; a link that has lapsed is fetched again through the bulk lookup.
    const stale = [...byId.values()]
      .filter((t) => t.receipt?.expiresAt && Date.parse(t.receipt.expiresAt) <= Date.now())
      .map((t) => t.id);
    if (stale.length) {
      for (const fresh of await this.client.lookup<NavanTransaction>(conn, stale, stats)) {
        const t = byId.get(fresh.id);
        if (t) byId.set(fresh.id, { ...t, receipt: fresh.receipt ?? null });
      }
    }

    const transactions = [...byId.values()].sort(
      (a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.id.localeCompare(b.id),
    );
    const records: InboundRecord[] = transactions.map((t) =>
      navanToRecord(t, { mappings: context.mappings, eventCodeFieldId: settings.eventCodeFieldId }),
    );
    const spec = objectSpec('navan', 'transactions', 'inbound')!;
    const applyActor = connectorActor(actor, 'navan');
    const outcome =
      records.length > 0
        ? await this.sync.apply(applyActor, context, spec, records, run.id, {
            idempotencyKey: `navan:${run.id}`,
            requestId,
          })
        : { ...empty(), note: 'Navan returned no transactions in this window.' };

    const notes: string[] = [
      `${windows.length} window(s) of at most 93 days, ${stats.pages} page(s), ${stats.rateLimited} rate-limit wait(s).`,
    ];
    if (outcome.importBatchId) {
      const lines = await withTenant(
        this.db,
        { tenantId: actor.tenantId, subject: actor.subject },
        (tx) =>
          tx
            .select({ id: actuals.id, sourceRef: actuals.sourceRef })
            .from(actuals)
            .where(eq(actuals.importBatchId, outcome.importBatchId!)),
      );
      const people = await this.peopleFor(actor, row, transactions);
      const byRef = new Map(transactions.map((t) => [t.id, t]));
      const receipts = await this.copyReceipts(applyActor, row, lines, byRef, run.id, requestId);
      if (receipts.stored || receipts.failed)
        notes.push(
          `${receipts.stored} receipt(s) stored${receipts.failed ? `, ${receipts.failed} could not be fetched` : ''}.`,
        );
      const personByActual = new Map<string, { personId: string | null; name: string }>();
      for (const l of lines) {
        const t = byRef.get(l.sourceRef);
        const p = t?.user ? people.get(t.user.id ?? '') : undefined;
        if (p) personByActual.set(l.id, p);
      }
      const raised = await this.exceptions.raiseOverBudget(
        applyActor,
        { actualIds: lines.map((l) => l.id), sourceLabel: 'Navan', people: personByActual },
        { requestId },
      );
      if (raised.raised)
        notes.push(
          `${raised.raised} line(s) above the remaining budget went to the post-spend exception queue.`,
        );
    }
    if (outcome.note) notes.push(outcome.note);
    let status: SyncStatus = 'succeeded';
    if (outcome.failed > 0 || outcome.duplicates > 0) status = 'partly_succeeded';
    if (outcome.applied === 0 && outcome.failed > 0) status = 'failed';
    return {
      status,
      read: transactions.length,
      outcome: { ...outcome, note: notes.join(' ') },
      nextCursor: navanNextCursor(start, now),
    };
  }

  /** Navan users by id to BudgetFlow people, from the person mappings, then by email. */
  private async peopleFor(
    actor: RequestActor,
    row: ConnectionRow,
    transactions: readonly NavanTransaction[],
  ): Promise<Map<string, { personId: string | null; name: string }>> {
    const users = new Map<string, string>();
    for (const t of transactions)
      if (t.user?.id && t.user.email) users.set(t.user.id, t.user.email.toLowerCase());
    if (users.size === 0) return new Map();
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const mapped = await tx
        .select({
          external: integrationMappings.externalValue,
          personId: integrationMappings.internalId,
        })
        .from(integrationMappings)
        .where(
          and(eq(integrationMappings.connectionId, row.id), eq(integrationMappings.kind, 'person')),
        );
      const personOf = new Map(mapped.map((m) => [m.external, m.personId]));
      const rows = await tx
        .select({ id: people.id, email: people.email, name: people.displayName })
        .from(people);
      const byId = new Map(rows.map((p) => [p.id, p]));
      const byEmail = new Map(rows.map((p) => [p.email.toLowerCase(), p]));
      const out = new Map<string, { personId: string | null; name: string }>();
      for (const [userId, email] of users) {
        const mappedId = personOf.get(userId);
        const p = (mappedId ? byId.get(mappedId) : undefined) ?? byEmail.get(email);
        out.set(userId, p ? { personId: p.id, name: p.name } : { personId: null, name: email });
      }
      return out;
    });
  }

  /** Copies each line's receipt into the DocumentStore, keyed by the Navan transaction id. */
  private async copyReceipts(
    actor: RequestActor,
    row: ConnectionRow,
    lines: { id: string; sourceRef: string }[],
    byRef: Map<string, NavanTransaction>,
    runId: string,
    requestId: string | null,
  ): Promise<{ stored: number; failed: number }> {
    let stored = 0;
    let failed = 0;
    for (const l of lines) {
      const t = byRef.get(l.sourceRef);
      if (!t?.receipt?.url) continue;
      const got = await this.client.download(t.receipt.url);
      const contentType = (t.receipt.contentType ?? got.contentType).split(';')[0].trim();
      const result = got.ok
        ? await this.documents.importFromSource(
            actor,
            {
              ownerType: 'actual',
              ownerId: l.id,
              sourceKey: `navan-${t.id}`,
              kind: 'receipt',
              fileName: `Navan receipt ${t.id}.${contentType === 'application/pdf' ? 'pdf' : contentType === 'image/jpeg' ? 'jpg' : 'png'}`,
              contentType,
              body: got.body,
            },
            { requestId },
          )
        : { stored: false, documentId: null, reason: got.message };
      if (result.stored) stored++;
      else if (!result.documentId) {
        failed++;
        await this.sync.recordFailure(actor, {
          connectionId: row.id,
          syncRunId: runId,
          direction: 'inbound',
          item: `Navan receipt for ${t.id}`,
          error: result.reason ?? 'The receipt could not be stored.',
          statusCode: null,
          payload: { transactionId: t.id, actualId: l.id },
          idempotencyKey: `navan-receipt:${row.id}:${t.id}`,
          errorClass: 'validation',
        });
      }
    }
    return { stored, failed };
  }

  // Inbound: users ------------------------------------------------------------------------------

  /** Maps Navan users to people by email; a user with no BudgetFlow person is reported, not created. */
  private async pullUsers(
    actor: RequestActor,
    run: typeof syncRuns.$inferSelect,
    row: ConnectionRow,
    conn: NavanConnection,
    stats: NavanCallStats,
  ): Promise<RunResult> {
    const settings = navanSettingsOf(row);
    const users: NavanUser[] = [];
    for await (const page of this.client.pages<NavanUser>(
      conn,
      '/users',
      {},
      settings.pageSize,
      stats,
    ))
      users.push(...page);
    const { matched, unmatched } = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const rows = await tx.select({ id: people.id, email: people.email }).from(people);
        const byEmail = new Map(rows.map((p) => [p.email.toLowerCase(), p.id]));
        await tx
          .delete(integrationMappings)
          .where(
            and(
              eq(integrationMappings.connectionId, row.id),
              eq(integrationMappings.kind, 'person'),
            ),
          );
        const misses: NavanUser[] = [];
        let hits = 0;
        for (const u of users) {
          const personId = byEmail.get((u.email ?? '').toLowerCase());
          if (!personId) {
            misses.push(u);
            continue;
          }
          hits++;
          await tx.insert(integrationMappings).values({
            tenantId: actor.tenantId,
            connectionId: row.id,
            kind: 'person',
            externalValue: u.id,
            internalId: personId,
            internalValue: u.email,
            approved: true,
          });
        }
        return { matched: hits, unmatched: misses };
      },
    );
    for (const u of unmatched) {
      await this.sync.recordFailure(actor, {
        connectionId: row.id,
        syncRunId: run.id,
        direction: 'inbound',
        item: `Navan user ${u.id}`,
        error: `No BudgetFlow person has the email ${u.email}; their spend shows the email until one does.`,
        statusCode: null,
        payload: { userId: u.id },
        idempotencyKey: `navan-user:${row.id}:${u.id}`,
        errorClass: 'mapping',
      });
    }
    return {
      status: unmatched.length ? 'partly_succeeded' : 'succeeded',
      read: users.length,
      outcome: {
        ...empty(),
        applied: matched,
        failed: unmatched.length,
        note: `${matched} Navan user(s) mapped to people by email; ${unmatched.length} without a BudgetFlow person.`,
      },
      nextCursor: null,
    };
  }

  // Outbound: options ---------------------------------------------------------------------------

  private async requireWrite(row: ConnectionRow, conn: NavanConnection): Promise<NavanSettings> {
    const settings = navanSettingsOf(row);
    if (!settings.expenseWrite) {
      throw new ApiProblem(
        409,
        'NAVAN_WRITE_SCOPE_MISSING',
        'Expense: Write is off for this Navan connection, so BudgetFlow only reads. Ask Navan to grant the scope, then turn it on in the field mapping.',
      );
    }
    if (!(await this.client.hasWriteScope(conn))) {
      throw new ApiProblem(
        409,
        'NAVAN_WRITE_SCOPE_MISSING',
        'Navan did not grant the Expense: Write scope to these credentials. Ask the Navan account team to add it; BudgetFlow never sends a scope parameter, which would strip it.',
      );
    }
    return settings;
  }

  /** What each option should be in Navan right now, with the reason a person reads on the Push tab. */
  private async desiredOptions(tx: Tx, kind: OptionKind): Promise<DesiredOption[]> {
    if (kind === 'cost_center') {
      const today = todayUtc();
      const rows = await tx.select().from(costCenters).orderBy(asc(costCenters.code));
      return rows.map((c) => {
        const active = !c.validTo || String(c.validTo) >= today;
        return {
          value: c.code,
          label: c.name,
          active,
          eventId: null,
          why: active ? 'Cost center is open.' : 'Cost center has ended.',
        };
      });
    }
    const rows = await tx
      .select({ e: events, b: budgets })
      .from(events)
      .leftJoin(budgets, eq(budgets.id, events.budgetId))
      .orderBy(asc(events.eventCode));
    const budgetIds = [...new Set(rows.map((r) => r.b?.id).filter((x): x is string => Boolean(x)))];
    const balances = await this.ledgerReads.balances(tx, budgetIds);
    return rows.map(({ e, b }) => {
      let why = 'Event and budget accept spend.';
      let active = SPENDABLE_EVENT_STATUSES.has(e.status);
      if (!active) why = `Event is ${e.status.replace('_', ' ')}.`;
      else if (!b) {
        active = false;
        why = 'Event has no budget.';
      } else {
        const accepts = acceptsNewActivity(b.status);
        if (!accepts.ok) {
          active = false;
          why = accepts.error.message;
        } else if (availableOf(balances.get(b.id)!.budget, toPostingBudget(b).control.basis) <= 0) {
          active = false;
          why = 'This budget has no money left for new requests.';
        }
      }
      return { value: e.eventCode, label: e.name, active, eventId: e.id, why };
    });
  }

  private async publishOptions(
    actor: RequestActor,
    run: typeof syncRuns.$inferSelect,
    row: ConnectionRow,
    conn: NavanConnection,
    kind: OptionKind,
    stats: NavanCallStats,
    requestId: string | null,
  ): Promise<RunResult> {
    const settings = await this.requireWrite(row, conn);
    const fieldId = kind === 'event_code' ? settings.eventCodeFieldId : settings.costCenterFieldId;
    const label = kind === 'event_code' ? 'event code' : 'cost center';
    if (!fieldId) {
      throw new ApiProblem(
        409,
        'NAVAN_FIELD_NOT_MAPPED',
        `Choose the Navan field that holds the ${label} in the field mapping first.`,
      );
    }
    const plan = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const desired = await this.desiredOptions(tx, kind);
        const existing = await tx
          .select()
          .from(integrationPushes)
          .where(and(eq(integrationPushes.connectionId, row.id), eq(integrationPushes.kind, kind)));
        const byRef = new Map(existing.map((p) => [p.reference, p]));
        const ops: { op: NavanOperation; want: DesiredOption; pushId: string; before: string }[] =
          [];
        for (const want of desired) {
          const have = byRef.get(want.value);
          const wantStatus = want.active ? 'pushed' : 'disabled';
          if (!have && !want.active) continue; // never publish an option nobody may use
          if (have && have.status === wantStatus) continue;
          const pushId =
            have?.id ??
            (
              await tx
                .insert(integrationPushes)
                .values({
                  tenantId: actor.tenantId,
                  connectionId: row.id,
                  kind,
                  eventId: want.eventId,
                  reference: want.value,
                  status: 'pending',
                  idempotencyKey: `navan-option:${row.id}:${kind}:${want.value}`,
                })
                .returning({ id: integrationPushes.id })
            )[0].id;
          const created = !have || have.status === 'pending' || !have.pushedAt;
          ops.push({
            op: {
              action: created ? 'CREATE' : 'UPDATE',
              value: want.value,
              label: want.label,
              active: want.active,
            },
            want,
            pushId,
            before: have?.status ?? 'new',
          });
        }
        return { desired, ops };
      },
    );
    if (plan.ops.length === 0) {
      return {
        status: 'succeeded',
        read: plan.desired.length,
        outcome: { ...empty(), note: `Every ${label} option in Navan already matches BudgetFlow.` },
        nextCursor: null,
      };
    }
    const results = await this.client.runOptionJobs(
      conn,
      fieldId,
      plan.ops.map((o) => o.op),
      stats,
    );
    const resultOf = new Map(results.map((r) => [r.value, r]));
    let applied = 0;
    let failed = 0;
    let created = 0;
    let disabled = 0;
    let enabled = 0;
    for (const o of plan.ops) {
      const r = resultOf.get(o.op.value);
      const ok = r?.status === 'SUCCEEDED';
      const after = ok ? (o.want.active ? 'pushed' : 'disabled') : 'failed';
      await withTenant(
        this.db,
        { tenantId: actor.tenantId, subject: actor.subject },
        async (tx) => {
          await tx
            .update(integrationPushes)
            .set({
              status: after,
              externalId: ok ? `${fieldId}:${o.op.value}` : null,
              lastError: ok ? null : (r?.error ?? 'Navan did not report a result for this option.'),
              pushedAt: ok ? new Date() : null,
            })
            .where(eq(integrationPushes.id, o.pushId));
          if (ok) {
            await this.audit.append(tx, {
              tenantId: actor.tenantId,
              actorPersonId: actor.personId,
              actorSubject: actor.subject,
              action: 'integration.navan_option_changed',
              resourceType: 'integration_push',
              resourceId: o.pushId,
              requestId,
              reason: o.want.why,
              changes: {
                kind: { from: null, to: kind },
                reference: { from: null, to: o.op.value },
                status: { from: o.before, to: after },
                runId: { from: null, to: run.id },
              },
            });
          }
        },
      );
      if (!ok) {
        failed++;
        await this.sync.recordFailure(actor, {
          connectionId: row.id,
          syncRunId: run.id,
          direction: 'outbound',
          item: `Navan ${label} option ${o.op.value}`,
          error: r?.error ?? 'Navan did not report a result for this option.',
          statusCode: null,
          payload: { pushId: o.pushId, value: o.op.value, active: o.op.active },
          idempotencyKey: `navan-option:${row.id}:${kind}:${o.op.value}`,
          errorClass: 'validation',
        });
        continue;
      }
      applied++;
      if (o.op.action === 'CREATE') created++;
      else if (o.want.active) enabled++;
      else disabled++;
    }
    return {
      status: failed === 0 ? 'succeeded' : applied === 0 ? 'failed' : 'partly_succeeded',
      read: plan.desired.length,
      outcome: {
        ...empty(),
        applied,
        failed,
        note: `${created} ${label} option(s) created, ${disabled} switched off, ${enabled} switched back on, through ${Math.ceil(plan.ops.length / 5000)} Navan batch job(s).`,
      },
      nextCursor: null,
    };
  }

  // Outbound: coding write-back -----------------------------------------------------------------

  /**
   * Writes BudgetFlow's coding (GL code, cost center, event code) back onto the Navan transactions
   * it matched since the last write-back, by batch PATCH of at most 100. Navan's ERP sync status is
   * left alone unless BudgetFlow is the system of record.
   */
  private async writeBack(
    run: typeof syncRuns.$inferSelect,
    row: ConnectionRow,
    conn: NavanConnection,
    stats: NavanCallStats,
  ): Promise<RunResult> {
    const settings = await this.requireWrite(row, conn);
    const since = parseNavanStart(run.cursor);
    const rows = await withTenant(
      this.db,
      { tenantId: row.tenantId, subject: 'connector:navan' },
      (tx) =>
        tx
          .select({
            ref: actuals.sourceRef,
            matchedAt: actuals.matchedAt,
            eventCode: actuals.eventCode,
            gl: glAccounts.code,
            cc: costCenters.code,
          })
          .from(actuals)
          .innerJoin(syncRuns, eq(syncRuns.importBatchId, actuals.importBatchId))
          .leftJoin(glAccounts, eq(glAccounts.id, actuals.glAccountId))
          .leftJoin(costCenters, eq(costCenters.id, actuals.costCenterId))
          .where(
            and(
              eq(syncRuns.connectionId, row.id),
              eq(actuals.source, 'travel'),
              inArray(actuals.matchStatus, ['matched', 'partially_matched']),
              since ? gt(actuals.matchedAt, since) : undefined,
            ),
          )
          .orderBy(asc(actuals.matchedAt), asc(actuals.sourceRef)),
    );
    const items = rows.map((r) => ({
      id: r.ref,
      ...(r.gl ? { glCode: r.gl } : {}),
      ...(r.cc ? { hrFields: { costCenter: r.cc } } : {}),
      ...(settings.eventCodeFieldId && r.eventCode
        ? { customFields: [{ fieldId: settings.eventCodeFieldId, value: r.eventCode }] }
        : {}),
      // Navan's ERP sync status belongs to the system of record; only then is it marked synced.
      ...(settings.systemOfRecord ? { erpSyncStatus: 'SYNCED' } : {}),
    }));
    const last = rows.at(-1)?.matchedAt ?? null;
    if (items.length === 0) {
      return {
        status: 'succeeded',
        read: 0,
        outcome: { ...empty(), note: 'No newly matched Navan transaction to write back.' },
        nextCursor: run.cursor,
      };
    }
    const calls = await this.client.patchTransactions(conn, items, settings.writeBatchSize, stats);
    return {
      status: 'succeeded',
      read: items.length,
      outcome: {
        ...empty(),
        applied: items.length,
        note: `${items.length} transaction(s) written back in ${calls} call(s) of at most ${Math.min(settings.writeBatchSize, 100)}; ERP sync status ${settings.systemOfRecord ? 'set to synced, because BudgetFlow is the system of record' : 'left untouched'}.`,
      },
      nextCursor: last ? last.toISOString() : run.cursor,
    };
  }
}
