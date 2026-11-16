import { csvCell } from '@bf/api/actuals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { evidencePacks, outboxMessages, people, withTenant, type Db, type Tx } from '@bf/api/db';
import { S3DocumentStore } from '@bf/api/documents';
import type {
  CreateEvidencePackRequest,
  EvidenceContent,
  EvidencePack,
  EvidencePackDownload,
} from '@bf/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { plainDecimal } from './export-files';
import { textPdf, zipStore } from './file-writers';

export const EVIDENCE_PACK_TOPIC = 'reports.evidence-pack';
export interface EvidencePackJob {
  tenantId: string;
  packId: string;
}

const PACK_DAYS = 7;
const DOWNLOAD_TTL = 300;
/** Above this many bytes of original documents the pack leaves them out and says so (spec: 2 GB). */
const DOCUMENT_BYTES_LIMIT = 2 * 1024 * 1024 * 1024;
const SYSTEM = 'system:worker';

type PackRow = typeof evidencePacks.$inferSelect;
/** Rows of the pack's raw reads: written straight into CSV cells, so their shape is the query's. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;
type Q = (q: ReturnType<typeof sql>) => Promise<Rec[]>;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const csv = (headers: string[], rows: unknown[][]) =>
  Buffer.from(
    [
      headers.map(csvCell).join(','),
      ...rows.map((r) => r.map((v) => csvCell(v == null ? '' : String(v))).join(',')),
    ].join('\n') + '\n',
  );
const ids = (list: readonly string[]) =>
  sql.join(
    (list.length ? list : ['00000000-0000-0000-0000-000000000000']).map((id) => sql`${id}::uuid`),
    sql`, `,
  );
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

/**
 * One-click evidence pack (088a). The API records the request; the worker assembles a ZIP from
 * the tenant's own rows under RLS (approvals with DoA limits and channels, the audit extract with a
 * hash-chain verification, contributions and recharges, commitments, actuals, original documents,
 * exceptions) plus a manifest of SHA-256 fingerprints. It moves no money. Generation and every
 * download are audited.
 */
@Injectable()
export class EvidencePacksService {
  private readonly log = new Logger('EvidencePacks');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly store: S3DocumentStore,
  ) {}

  private can(actor: RequestActor, action: 'evidence.generate' | 'audit.read') {
    return this.policy.can(actor, action, { kind: 'tenant', tenantId: actor.tenantId }).allowed;
  }

  private assertCanSee(actor: RequestActor): void {
    if (!this.can(actor, 'evidence.generate') && !this.can(actor, 'audit.read'))
      throw ApiProblem.forbidden('Evidence packs are for auditors and finance roles.');
  }

  private async dto(tx: Tx, actor: RequestActor, row: PackRow): Promise<EvidencePack> {
    const [who] = row.requestedByPersonId
      ? await tx
          .select({ name: people.displayName })
          .from(people)
          .where(eq(people.id, row.requestedByPersonId))
      : [];
    const expired = row.status === 'ready' && row.expiresAt.getTime() < nowUtc().getTime();
    return {
      id: row.id,
      subjectType: row.subjectType as EvidencePack['subjectType'],
      subjectId: row.subjectId,
      subjectLabel: row.subjectLabel,
      contents: row.contents as EvidenceContent[],
      includeAttendees: row.includeAttendees,
      status: expired ? 'expired' : (row.status as EvidencePack['status']),
      step: row.step,
      counts: (row.counts ?? {}) as Record<string, number>,
      requestedByName: who?.name ?? null,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      manifest: (row.manifest ?? []) as EvidencePack['manifest'],
      manifestSha256: row.manifestSha256,
      chain: (row.chain ?? null) as EvidencePack['chain'],
      error: row.error,
      canDownload: row.status === 'ready' && !expired && this.can(actor, 'audit.read'),
    };
  }

  /** The subject's label, when the viewer may read it; 404 otherwise (RLS and policy). */
  private async subject(
    tx: Tx,
    actor: RequestActor,
    type: 'event' | 'budget',
    id: string,
  ): Promise<string> {
    if (type === 'event') {
      const [e] = (
        await tx.execute<{ name: string; code: string | null }>(
          sql`select name, event_code as code from events where id = ${id}::uuid`,
        )
      ).rows;
      if (
        !e ||
        !this.policy.can(actor, 'event.read', { kind: 'tenant', tenantId: actor.tenantId }).allowed
      )
        throw ApiProblem.notFound('event');
      return e.code ? `${e.name} (${e.code})` : e.name;
    }
    const [b] = (
      await tx.execute<{ name: string; path: string; code: string | null }>(
        sql`select name, path, code from budgets where id = ${id}::uuid`,
      )
    ).rows;
    if (
      !b ||
      !this.policy.can(actor, 'budget.read', {
        kind: 'budget',
        tenantId: actor.tenantId,
        id,
        path: b.path,
      }).allowed
    )
      throw ApiProblem.notFound('budget');
    return b.code ? `${b.name} (${b.code})` : b.name;
  }

  create(
    actor: RequestActor,
    req: CreateEvidencePackRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<EvidencePack>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'reports.evidence_pack.generate',
        request: req,
        status: 202,
      },
      async (tx) => {
        if (!this.can(actor, 'evidence.generate'))
          throw ApiProblem.forbidden(
            'Evidence packs are generated by the Auditor, Finance Controller and Finance Admin.',
          );
        const label = await this.subject(tx, actor, req.subjectType, req.subjectId);
        const contents = [...new Set(req.contents)];
        const [row] = await tx
          .insert(evidencePacks)
          .values({
            tenantId: actor.tenantId,
            subjectType: req.subjectType,
            subjectId: req.subjectId,
            subjectLabel: label,
            contents,
            includeAttendees: req.includeAttendees,
            status: 'queued',
            requestedByPersonId: actor.personId,
            requestedAt: nowUtc(),
            expiresAt: new Date(nowUtc().getTime() + PACK_DAYS * 24 * 60 * 60 * 1000),
          })
          .returning();
        await tx.insert(outboxMessages).values({
          tenantId: actor.tenantId,
          topic: EVIDENCE_PACK_TOPIC,
          payload: { tenantId: actor.tenantId, packId: row.id },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'evidence_pack.requested',
          resourceType: 'evidence_pack',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            subject: { from: null, to: `${req.subjectType}:${req.subjectId}` },
            contents: { from: null, to: contents },
            includeAttendees: { from: null, to: req.includeAttendees },
          },
        });
        return this.dto(tx, actor, row);
      },
    );
  }

  list(actor: RequestActor): Promise<{ items: EvidencePack[]; canGenerate: boolean }> {
    this.assertCanSee(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(evidencePacks)
        .orderBy(desc(evidencePacks.requestedAt), desc(evidencePacks.id))
        .limit(100);
      const items: EvidencePack[] = [];
      for (const r of rows) items.push(await this.dto(tx, actor, r));
      return { items, canGenerate: this.can(actor, 'evidence.generate') };
    });
  }

  private async row(tx: Tx, id: string): Promise<PackRow> {
    const [row] = await tx.select().from(evidencePacks).where(eq(evidencePacks.id, id));
    if (!row) throw ApiProblem.notFound('evidence pack');
    return row;
  }

  get(actor: RequestActor, id: string): Promise<EvidencePack> {
    this.assertCanSee(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) =>
      this.dto(tx, actor, await this.row(tx, id)),
    );
  }

  /** A five-minute signed link to the ZIP; each link handed out is audited with the manifest fingerprint. */
  download(
    actor: RequestActor,
    id: string,
    ctx: { requestId: string | null },
  ): Promise<EvidencePackDownload> {
    if (!this.can(actor, 'audit.read'))
      throw ApiProblem.forbidden('Downloading an evidence pack needs audit access.');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.row(tx, id);
      if (row.status !== 'ready' || !row.storageKey || !row.fileName)
        throw new ApiProblem(409, 'CONFLICT', `This pack is ${row.status}; it has no file yet.`);
      if (row.expiresAt.getTime() < nowUtc().getTime())
        throw new ApiProblem(409, 'CONFLICT', 'This pack has expired; generate it again.');
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'evidence_pack.downloaded',
        resourceType: 'evidence_pack',
        resourceId: row.id,
        requestId: ctx.requestId,
        changes: { manifestSha256: { from: null, to: row.manifestSha256 } },
      });
      return {
        url: this.store.downloadUrl(row.storageKey, row.fileName, DOWNLOAD_TTL),
        fileName: row.fileName,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000).toISOString(),
      };
    });
  }

  // Worker side -----------------------------------------------------------------------------------

  /** Assembles the pack. Idempotent on the pack id: a pack already ready or failed is left alone. */
  async render(job: EvidencePackJob): Promise<void> {
    const ctx = { tenantId: job.tenantId, subject: SYSTEM };
    const row = await withTenant(this.db, ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(evidencePacks)
        .where(eq(evidencePacks.id, job.packId))
        .for('update');
      if (!r || r.status !== 'queued') return null;
      await tx
        .update(evidencePacks)
        .set({ status: 'running', step: 'collecting' })
        .where(eq(evidencePacks.id, r.id));
      return r;
    });
    if (!row) return;
    let step = 'collecting';
    try {
      const { files, counts, chain } = await withTenant(this.db, ctx, async (tx) => {
        const q: Q = async (query) => (await tx.execute(query)).rows as Rec[];
        return this.collect(tx, q, row, (s) => (step = s));
      });
      step = 'packaging';
      const manifest = files.map((f) => ({
        name: f.name,
        sizeBytes: f.body.length,
        sha256: sha(f.body),
      }));
      const manifestBody = Buffer.from(
        JSON.stringify({ pack: row.id, subject: row.subjectLabel, files: manifest }, null, 2),
      );
      const zip = zipStore([...files, { name: 'manifest.json', body: manifestBody }], row.id);
      const storageKey = `tenants/${row.tenantId}/evidence-packs/${row.id}.zip`;
      const fileName = `evidence-pack-${safeName(row.subjectLabel)}.zip`;
      step = 'storing';
      await this.store.put(storageKey, 'application/zip', zip);
      await withTenant(this.db, ctx, async (tx) => {
        await tx
          .update(evidencePacks)
          .set({
            status: 'ready',
            step: null,
            counts,
            storageKey,
            fileName,
            sizeBytes: zip.length,
            manifest,
            manifestSha256: sha(manifestBody),
            chain,
            completedAt: nowUtc(),
          })
          .where(eq(evidencePacks.id, row.id));
        await this.audit.append(tx, {
          tenantId: row.tenantId,
          actorPersonId: null,
          actorSubject: SYSTEM,
          action: 'evidence_pack.generated',
          resourceType: 'evidence_pack',
          resourceId: row.id,
          requestId: null,
          changes: {
            status: { from: 'running', to: 'ready' },
            manifestSha256: { from: null, to: sha(manifestBody) },
            chainValid: { from: null, to: chain.valid },
          },
        });
      });
    } catch (e) {
      this.log.error(`evidence pack ${row.id} failed at ${step}: ${(e as Error).message}`);
      await withTenant(this.db, ctx, (tx) =>
        tx
          .update(evidencePacks)
          .set({ status: 'failed', step, error: `Failed while ${step}.` })
          .where(eq(evidencePacks.id, row.id)),
      );
    }
  }

  private async collect(tx: Tx, q: Q, row: PackRow, setStep: (s: string) => void) {
    const want = new Set(row.contents as EvidenceContent[]);
    const files: { name: string; body: Buffer }[] = [];
    const counts: Record<string, number> = {};
    const isEvent = row.subjectType === 'event';
    const subjectId = row.subjectId;

    const [event] = isEvent
      ? await q(
          sql`select e.*, b.name as budget_name from events e left join budgets b on b.id = e.budget_id where e.id = ${subjectId}::uuid`,
        )
      : [];
    const [budget] = !isEvent
      ? await q(
          sql`select b.*, le.code as entity_code from budgets b join legal_entities le on le.id = b.legal_entity_id where b.id = ${subjectId}::uuid`,
        )
      : [];
    const requestIds = (
      await q(
        isEvent
          ? sql`select id from requests where event_id = ${subjectId}::uuid`
          : sql`select id from requests where budget_id = ${subjectId}::uuid`,
      )
    ).map((r) => String(r.id));
    const contributionIds = (
      await q(
        isEvent
          ? sql`select id from contribution_requests where event_id = ${subjectId}::uuid`
          : sql`select id from contribution_requests where giver_budget_id = ${subjectId}::uuid or receiver_budget_id = ${subjectId}::uuid`,
      )
    ).map((r) => String(r.id));
    const commitments = await q(
      isEvent
        ? sql`select c.*, b.name as budget_name from commitments c left join budgets b on b.id = c.budget_id where c.event_id = ${subjectId}::uuid or c.request_id in (${ids(requestIds)}) order by c.created_at, c.id`
        : sql`select c.*, b.name as budget_name from commitments c left join budgets b on b.id = c.budget_id where c.budget_id = ${subjectId}::uuid order by c.created_at, c.id`,
    );
    const commitmentIds = commitments.map((c) => String(c.id));

    if (want.has('approvals')) {
      setStep('approvals');
      const rows = await q(sql`
        select coalesce(r.ref, c.ref) as ref, i.subject_type, t.step_no, t.resolver, ap.display_name as approver,
               dp.display_name as on_behalf_of, a.action, a.approved_minor, t.doa_limit_minor, t.doa_currency,
               a.channel::text as channel, a.reason_code, a.reason, a.created_at::text as decided_at,
               i.explanation->'ruleVersions' as rule_versions
        from approval_actions a
        join approval_tasks t on t.id = a.task_id
        join approval_instances i on i.id = t.instance_id
        join people ap on ap.id = a.actor_person_id
        left join people dp on dp.id = a.on_behalf_of_person_id
        left join requests r on i.subject_type = 'request' and r.id = i.subject_id
        left join contribution_requests c on i.subject_type = 'contribution' and c.id = i.subject_id
        where i.subject_id in (${ids([...requestIds, ...contributionIds])})
        order by a.created_at, a.id`);
      counts['approvals'] = rows.length;
      files.push({
        name: 'approvals.csv',
        body: csv(
          [
            'Reference',
            'Subject',
            'Step',
            'Resolver',
            'Approver',
            'On behalf of',
            'Decision',
            'Approved amount (minor)',
            'DoA limit',
            'Channel',
            'Reason code',
            'Reason',
            'Decided at',
            'Rule versions',
          ],
          rows.map((r) => [
            r.ref,
            r.subject_type,
            r.step_no,
            r.resolver,
            r.approver,
            r.on_behalf_of,
            r.action,
            r.approved_minor,
            r.doa_limit_minor != null && r.doa_currency
              ? `${plainDecimal(Number(r.doa_limit_minor), String(r.doa_currency))} ${r.doa_currency}`
              : '',
            r.channel,
            r.reason_code,
            r.reason,
            r.decided_at,
            r.rule_versions ? JSON.stringify(r.rule_versions) : '',
          ]),
        ),
      });
    }

    let chain: NonNullable<EvidencePack['chain']> = {
      valid: true,
      fromSeq: null,
      toSeq: null,
      brokenAt: null,
      checked: 0,
    };
    if (want.has('audit_trail')) {
      setStep('audit trail');
      const resources = [
        { type: row.subjectType, ids: [subjectId] },
        { type: 'request', ids: requestIds },
        { type: 'contribution', ids: contributionIds },
        { type: 'commitment', ids: commitmentIds },
      ].filter((r) => r.ids.length);
      const rows = await q(sql`
        select seq, occurred_at::text as at, coalesce(p.display_name, e.actor_subject) as actor, action,
               resource_type, resource_id, reason, hash
        from audit_events e left join people p on p.id = e.actor_person_id
        where ${sql.join(
          resources.map(
            (r) =>
              sql`(resource_type = ${r.type} and resource_id in (${sql.join(
                r.ids.map((i) => sql`${i}`),
                sql`, `,
              )}))`,
          ),
          sql` or `,
        )}
        order by seq`);
      const verified = await this.audit.verify(tx);
      chain = {
        valid: verified.valid,
        fromSeq: rows.length ? Number(rows[0].seq) : null,
        toSeq: rows.length ? Number(rows[rows.length - 1].seq) : null,
        brokenAt: verified.valid ? null : (verified.firstBrokenSeq ?? null),
        checked: verified.checked,
      };
      counts['auditEntries'] = rows.length;
      files.push({
        name: 'audit-trail.csv',
        body: csv(
          ['Sequence', 'At', 'Actor', 'Action', 'Resource type', 'Resource id', 'Reason', 'Hash'],
          rows.map((r) => [
            r.seq,
            r.at,
            r.actor,
            r.action,
            r.resource_type,
            r.resource_id,
            r.reason,
            r.hash,
          ]),
        ),
      });
    }

    if (want.has('contributions')) {
      setStep('contributions');
      const rows = await q(sql`
        select c.ref, g.name as giver, rb.name as receiver, c.status, c.mode, c.requested_minor, c.approved_minor, c.currency,
               rs.status as recharge_status, rs.amount_minor as recharge_minor, rs.markup_minor, rs.tax_approved_at::text as tax_approved_at
        from contribution_requests c
        join budgets g on g.id = c.giver_budget_id
        join budgets rb on rb.id = c.receiver_budget_id
        left join recharge_schedules rs on rs.contribution_request_id = c.id
        where c.id in (${ids(contributionIds)}) order by c.created_at, c.id`);
      counts['contributions'] = rows.length;
      files.push({
        name: 'contributions-and-recharges.csv',
        body: csv(
          [
            'Inter-Director Budget Contribution Request',
            'Giving budget',
            'Receiving budget',
            'Status',
            'Mode',
            'Requested',
            'Approved',
            'Currency',
            'Recharge status',
            'Recharge amount',
            'Markup',
            'Tax approved at',
          ],
          rows.map((r) => {
            const cur = String(r.currency);
            const m = (v: unknown) => (v == null ? '' : plainDecimal(Number(v), cur));
            return [
              r.ref,
              r.giver,
              r.receiver,
              r.status,
              r.mode,
              m(r.requested_minor),
              m(r.approved_minor),
              cur,
              r.recharge_status,
              m(r.recharge_minor),
              m(r.markup_minor),
              r.tax_approved_at,
            ];
          }),
        ),
      });
    }

    if (want.has('commitments')) {
      setStep('commitments');
      counts['commitments'] = commitments.length;
      files.push({
        name: 'commitments.csv',
        body: csv(
          [
            'Commitment',
            'Budget',
            'Status',
            'Description',
            'Amount',
            'Consumed',
            'Released',
            'Currency',
            'Service start',
            'Service end',
          ],
          commitments.map((c) => {
            const cur = String(c.currency);
            return [
              c.id,
              c.budget_name,
              c.status,
              c.description,
              plainDecimal(Number(c.amount_minor), cur),
              plainDecimal(Number(c.consumed_minor), cur),
              plainDecimal(Number(c.released_minor), cur),
              cur,
              c.service_start,
              c.service_end,
            ];
          }),
        ),
      });
    }

    let documentBytes = 0;
    if (want.has('actuals')) {
      setStep('actuals');
      const eventCode = event?.event_code ? String(event.event_code) : null;
      const rows = await q(sql`
        select source_ref, source::text as source, transaction_date::text as date, merchant,
               transaction_amount_minor, transaction_currency, reporting_amount_minor, reporting_currency,
               fx_effect_minor, match_status::text as match_status
        from actuals
        where matched_commitment_id in (${ids(commitmentIds)})
          ${isEvent ? (eventCode ? sql`or event_code = ${eventCode}` : sql``) : sql`or matched_budget_id = ${subjectId}::uuid`}
        order by transaction_date, source_ref`);
      counts['actuals'] = rows.length;
      files.push({
        name: 'actuals.csv',
        body: csv(
          [
            'Reference',
            'Source',
            'Date',
            'Merchant',
            'Amount',
            'Currency',
            'Reporting amount',
            'Reporting currency',
            'FX effect (reported separately)',
            'Match status',
          ],
          rows.map((r) => [
            r.source_ref,
            r.source,
            r.date,
            r.merchant,
            plainDecimal(Number(r.transaction_amount_minor), String(r.transaction_currency)),
            r.transaction_currency,
            plainDecimal(Number(r.reporting_amount_minor), String(r.reporting_currency)),
            r.reporting_currency,
            plainDecimal(Number(r.fx_effect_minor ?? 0), String(r.reporting_currency)),
            r.match_status,
          ]),
        ),
      });
      const docs = await q(sql`
        select id, owner_type, file_name, storage_key, size_bytes from documents
        where status = 'available' and (
          (owner_type = 'event' and owner_id = ${subjectId}::uuid and ${isEvent})
          or (owner_type = 'request' and owner_id in (${ids(requestIds)}))
          or (owner_type = 'contribution' and owner_id in (${ids(contributionIds)}))
          or (owner_type = 'commitment' and owner_id in (${ids(commitmentIds)})))
        order by created_at, id`);
      const total = docs.reduce((s, d) => s + Number(d.size_bytes), 0);
      counts['documents'] = 0;
      if (total <= DOCUMENT_BYTES_LIMIT)
        for (const d of docs) {
          const body = await this.store.read(String(d.storage_key));
          documentBytes += body.length;
          files.push({
            name: `documents/${String(d.id).slice(0, 8)}-${safeName(String(d.file_name))}`,
            body,
          });
          counts['documents'] += 1;
        }
    }

    if (want.has('exceptions')) {
      setStep('exceptions');
      const rows = await q(sql`
        select 'post-spend' as kind, type, status, summary, resolution, created_at::text as at from post_spend_exceptions
         where source_id in (${ids([...requestIds, ...commitmentIds])}) ${isEvent ? sql`` : sql`or budget_id = ${subjectId}::uuid`}
        union all
        select 'integrity flag', kind::text, status::text, resource_type, null, raised_at::text from integrity_flags
         where resource_id in (${sql.join(
           [...requestIds, subjectId].map((i) => sql`${i}`),
           sql`, `,
         )})
        order by at`);
      counts['exceptions'] = rows.length;
      files.push({
        name: 'exceptions.csv',
        body: csv(
          ['Kind', 'Type', 'Status', 'Summary', 'Resolution', 'Raised at'],
          rows.map((r) => [r.kind, r.type, r.status, r.summary, r.resolution, r.at]),
        ),
      });
    }

    if (want.has('comments')) {
      setStep('comments');
      const rows = await q(sql`
        select c.created_at::text as at, p.display_name as author, c.body
        from comments c left join people p on p.id = c.author_person_id
        where c.removed_at is null and c.item_id in (${ids([subjectId, ...requestIds, ...contributionIds])}) order by c.created_at, c.id`);
      counts['comments'] = rows.length;
      files.push({
        name: 'comments.csv',
        body: csv(
          ['At', 'Author', 'Comment'],
          rows.map((r) => [r.at, r.author, r.body]),
        ),
      });
    }

    if (isEvent && row.includeAttendees) {
      setStep('attendees');
      const rows = await q(sql`
        select coalesce(p.display_name, ep.guest_name) as name, le.code as entity, cc.code as cost_center, ep.attendance_status::text as attendance
        from event_participants ep left join people p on p.id = ep.person_id
        left join legal_entities le on le.id = ep.employing_entity_id
        left join cost_centers cc on cc.id = ep.cost_center_id
        where ep.event_id = ${subjectId}::uuid order by name`);
      counts['attendees'] = rows.length;
      // Needs and survey answers are never included.
      files.push({
        name: 'attendees.csv',
        body: csv(
          ['Name', 'Employing entity', 'Cost center', 'Attendance'],
          rows.map((r) => [r.name, r.entity, r.cost_center, r.attendance]),
        ),
      });
    }

    if (want.has('summary') || want.has('reconciliation')) {
      setStep('summary');
      const lines: string[] = [
        `Evidence pack: ${row.subjectLabel}`,
        `Generated ${nowUtc().toISOString()}`,
        '',
      ];
      if (event) {
        const cur = String(event.currency);
        lines.push(
          `Event status: ${event.status}`,
          `Dates: ${String(event.starts_at ?? '').slice(0, 10)} to ${String(event.ends_at ?? '').slice(0, 10)}`,
          `Estimate: ${plainDecimal(Number(event.estimate_minor ?? 0), cur)} ${cur}; own funds ${plainDecimal(Number(event.own_funds_minor ?? 0), cur)} ${cur}`,
          `Funding budget: ${event.budget_name ?? 'none'}`,
        );
        if (!row.includeAttendees) {
          const [c] = await q(
            sql`select count(*)::int as n from event_participants where event_id = ${subjectId}::uuid`,
          );
          lines.push(`Attendees: ${Number(c?.n ?? 0)} (counts only)`);
        }
        if (want.has('reconciliation')) lines.push(`Closed at: ${event.closed_at ?? 'not closed'}`);
      }
      if (budget) {
        const bal = await q(
          sql`select account, sum(budget_amount_minor)::text as amount from ledger_lines where budget_id = ${subjectId}::uuid group by account order by account`,
        );
        const cur = String(budget.currency);
        lines.push(
          `Budget status: ${budget.status}`,
          `Legal entity: ${budget.entity_code}`,
          `Ledger buckets (${cur}):`,
        );
        for (const b of bal)
          lines.push(
            `  ${String(b.account).replace(/_/g, ' ')}: ${plainDecimal(Number(b.amount), cur)}`,
          );
      }
      const [fx] = await q(
        sql`select coalesce(sum(fx_effect_minor), 0)::text as fx from actuals where matched_commitment_id in (${ids(commitmentIds)})`,
      );
      lines.push(
        '',
        `FX effect (reported separately, never part of spend): ${plainDecimal(Number(fx?.fx ?? 0), 'USD')}`,
      );
      lines.push(
        '',
        'Pending (pre-encumbered), committed (encumbered) and actual are listed separately in the CSV files.',
      );
      if (!chain.valid)
        lines.push(
          '',
          `Audit chain verification failed at entry ${chain.brokenAt}. See the audit log.`,
        );
      else if (want.has('audit_trail'))
        lines.push(
          '',
          `Audit chain verified: ${chain.checked} entries; this extract covers ${chain.fromSeq ?? '-'} to ${chain.toSeq ?? '-'}.`,
        );
      lines.push(
        '',
        `Contents: ${[...want].join(', ')}`,
        `Counts: ${Object.entries(counts)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}`,
      );
      files.unshift({ name: 'summary.pdf', body: textPdf(lines, `Evidence pack ${row.id}`) });
    }
    counts['documentBytes'] = documentBytes;
    return { files, counts, chain };
  }
}
