import type { Tx } from '@bf/api/db';
import type { BenefitSpend } from '@bf/domain';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Cap usage read from the ledger (gap A2). A request's live consumption is the sum of its ledger lines
 * in the pre-encumbered, encumbered and actual buckets, in the reporting currency at the rates the
 * postings locked: submitting adds it, approving moves it, releases, rejections and withdrawals take
 * it back out, so only live spend counts. Reads run inside the caller's transaction, so RLS scopes
 * them to the tenant.
 */

const uuidArray = (ids: readonly string[]): SQL =>
  sql`array[${sql.join(
    [...new Set(ids)].map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;

const textArray = (values: readonly string[]): SQL =>
  sql`array[${sql.join(
    [...new Set(values)].map((v) => sql`${v}::text`),
    sql`, `,
  )}]::text[]`;

/**
 * Live consumption of one request, in the reporting currency: its own lines and those of the
 * commitments raised for it (matched by the commitment's request, which is set before the request
 * row learns its commitment id). Lines that carry the request id but belong to another commitment
 * (event spending drawn from an event-funding request's hold) are not its consumption.
 */
const CONSUMPTION = sql`(
  select coalesce(sum(l.reporting_amount_minor), 0)
  from ledger_lines l
  where ((l.request_id = r.id and l.commitment_id is null)
      or l.commitment_id in (select c.id from commitments c where c.request_id = r.id))
    and l.account in ('pre_encumbered', 'encumbered', 'actual')
)`;

/**
 * A request counts in the cap year it was submitted in (the one being decided counts in the current
 * year), so a release posted after the year turns never lowers the next year's total.
 */
const IN_WINDOW = (window: CapWindow, includeRequestId?: string) =>
  includeRequestId
    ? sql`and ((r.submitted_at at time zone 'UTC')::date between ${window.fromDate}::date and ${window.toDate}::date or r.id = ${includeRequestId}::uuid)`
    : sql`and (r.submitted_at at time zone 'UTC')::date between ${window.fromDate}::date and ${window.toDate}::date`;

export interface CapWindow {
  fromDate: string;
  toDate: string;
}

/**
 * Live spends in the window that name a benefit recipient, in the given spend types. With
 * `recipientIds`, only requests naming at least one of them (the cap check); without, every one (the
 * "employees nearest cap" list).
 */
export async function benefitSpends(
  tx: Tx,
  opts: {
    spendTypes: readonly string[];
    window: CapWindow;
    recipientIds?: readonly string[];
    /** The request being decided: counted whatever its submission date. */
    includeRequestId?: string;
  },
): Promise<BenefitSpend[]> {
  if (!opts.spendTypes.length) return [];
  if (opts.recipientIds && !opts.recipientIds.length) return [];
  const recipients = opts.recipientIds
    ? sql`and r.benefit_recipient_ids && ${uuidArray(opts.recipientIds)}`
    : sql``;
  const res = await tx.execute(sql`
    select r.id, r.benefit_recipient_ids::text[] as recipients, coalesce(r.non_employee_count, 0) as others,
      ${CONSUMPTION}::bigint as minor
    from requests r
    where cardinality(r.benefit_recipient_ids) > 0
      and r.kind in ('spending', 'over_budget')
      and lower(r.spend_type) = any(${textArray(opts.spendTypes.map((t) => t.toLowerCase()))})
      ${recipients}
      ${IN_WINDOW(opts.window, opts.includeRequestId)}
  `);
  return (res.rows as { id: string; recipients: string[]; others: number; minor: string }[])
    .map((row) => ({
      requestId: row.id,
      recipientIds: row.recipients ?? [],
      nonEmployeeCount: Number(row.others),
      reportingMinor: Number(row.minor),
    }))
    .filter((s) => s.reportingMinor > 0);
}

/** The requester's live consumption over requests submitted since `since`, plus the one being decided. */
export async function requesterRecentTotal(
  tx: Tx,
  opts: { requesterId: string; since: Date; includeRequestId: string },
): Promise<number> {
  const res = await tx.execute(sql`
    select coalesce(sum(${CONSUMPTION}), 0)::bigint as minor
    from requests r
    where r.requester_person_id = ${opts.requesterId}::uuid
      and (r.submitted_at >= ${opts.since.toISOString()}::timestamptz or r.id = ${opts.includeRequestId}::uuid)
  `);
  return Number((res.rows[0] as { minor?: string } | undefined)?.minor ?? 0);
}

/**
 * Serializes cap decisions per person: two requests for the same recipient cannot both pass the cap
 * by deciding at the same time. Locks are taken in id order, so concurrent decisions never deadlock.
 */
export async function lockCapPeople(tx: Tx, tenantId: string, personIds: readonly string[]) {
  for (const id of [...new Set(personIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cap:${tenantId}:${id}`}))`);
  }
}

/**
 * The cap year containing `day`, one for the whole tenant so a person's cap is the same whichever
 * entity's budget pays: the group fiscal year when there is one, else the earliest-starting year.
 * Submission, approval and the "employees nearest cap" list all use it.
 */
export async function capWindowOn(tx: Tx, day: string): Promise<CapWindow | null> {
  const res = await tx.execute(sql`
    select start_date::text as "fromDate", end_date::text as "toDate" from fiscal_years
    where ${day}::date between start_date and end_date
    order by (group_fiscal_year_id is null) desc, start_date, id
    limit 1
  `);
  return (res.rows[0] as unknown as CapWindow | undefined) ?? null;
}
