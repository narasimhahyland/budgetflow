import { eventFundingSources, type Tx } from '@bf/api/db';
import type { FundingSource } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

export type SourceRow = typeof eventFundingSources.$inferSelect;

export const asFundingSource = (s: SourceRow): FundingSource => ({
  id: s.id,
  fundedMinor: s.fundedMinor,
  consumedMinor: s.consumedMinor,
  returnedMinor: s.returnedMinor,
});

/**
 * The event funding sub-ledger: one row per source (own funds, each approved Inter-Director Budget
 * Contribution Request). It mirrors the earmarks held on the ledger; every change happens in the
 * same transaction as the journal that moves the money.
 */
@Injectable()
export class FundingSourcesService {
  async add(
    tx: Tx,
    s: {
      tenantId: string;
      eventId: string;
      kind: 'own' | 'contribution';
      budgetId: string;
      originBudgetId: string;
      requestId?: string | null;
      contributionRequestId?: string | null;
      mode: 'earmark' | 'transfer';
      fundedMinor: number;
      currency: string;
    },
  ): Promise<SourceRow> {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${eventFundingSources.seq}), 0) + 1` })
      .from(eventFundingSources)
      .where(eq(eventFundingSources.eventId, s.eventId));
    const [row] = await tx
      .insert(eventFundingSources)
      .values({
        tenantId: s.tenantId,
        eventId: s.eventId,
        kind: s.kind,
        budgetId: s.budgetId,
        originBudgetId: s.originBudgetId,
        requestId: s.requestId ?? null,
        contributionRequestId: s.contributionRequestId ?? null,
        mode: s.mode,
        seq: Number(next),
        fundedMinor: s.fundedMinor,
        currency: s.currency,
      })
      .returning();
    return row;
  }

  list(tx: Tx, eventId: string, opts: { lock?: boolean } = {}): Promise<SourceRow[]> {
    const q = tx
      .select()
      .from(eventFundingSources)
      .where(eq(eventFundingSources.eventId, eventId))
      .orderBy(asc(eventFundingSources.seq));
    return opts.lock ? q.for('update') : q;
  }

  listForEvents(tx: Tx, eventIds: readonly string[]): Promise<SourceRow[]> {
    if (!eventIds.length) return Promise.resolve([]);
    return tx
      .select()
      .from(eventFundingSources)
      .where(inArray(eventFundingSources.eventId, [...eventIds]))
      .orderBy(asc(eventFundingSources.seq));
  }

  async adjust(
    tx: Tx,
    id: string,
    delta: { consumedMinor?: number; returnedMinor?: number; status?: string },
  ): Promise<void> {
    await tx
      .update(eventFundingSources)
      .set({
        consumedMinor: sql`${eventFundingSources.consumedMinor} + ${delta.consumedMinor ?? 0}`,
        returnedMinor: sql`${eventFundingSources.returnedMinor} + ${delta.returnedMinor ?? 0}`,
        ...(delta.status ? { status: delta.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(eventFundingSources.id, id)));
  }
}
