import { productAnalyticsEvents, withTenant, type Db, type Tx } from '@bf/api/db';
import { DB, type RequestActor } from '@bf/api/core';
import type {
  AnalyticsEventName,
  RecordAnalyticsRequest,
  RecordAnalyticsResponse,
} from '@bf/contracts';
import type { Actor } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

type ServerEventName = Exclude<AnalyticsEventName, 'session.started' | 'page.viewed'>;
type Properties = Record<string, string | number | boolean>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Clock skew tolerated for client times in the future. */
const SKEW_MS = 5 * 60 * 1000;

/**
 * Row id derived from tenant, subject and the client's event id: retries store once, and an id
 * chosen in one tenant can never collide with (and silently drop) another tenant's event.
 */
function rowId(tenantId: string, subject: string, eventId: string): string {
  const h = createHash('sha256').update(`${tenantId}:${subject}:${eventId}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Product analytics capture (separate from the audit trail): web events and server-side command events. */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    actor: RequestActor,
    input: RecordAnalyticsRequest,
    now = new Date(),
  ): Promise<RecordAnalyticsResponse> {
    const rows = input.events.map((e) => {
      const client = e.occurredAt ? new Date(e.occurredAt) : null;
      const age = client ? now.getTime() - client.getTime() : NaN;
      const trusted = client && age <= DAY_MS && age >= -SKEW_MS;
      return {
        id: rowId(actor.tenantId, actor.subject, e.id),
        tenantId: actor.tenantId,
        occurredAt: trusted ? client : now,
        actorPersonId: actor.personId,
        name: e.name,
        properties: { ...('properties' in e ? e.properties : {}), source: 'web' },
      };
    });
    const inserted = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) =>
        tx
          .insert(productAnalyticsEvents)
          .values(rows)
          .onConflictDoNothing({ target: productAnalyticsEvents.id })
          .returning({ id: productAnalyticsEvents.id }),
    );
    return { accepted: inserted.length, duplicates: rows.length - inserted.length };
  }

  /** For commands in later phases: records a server-side event inside the command's transaction. */
  async track(
    tx: Tx,
    actor: Actor,
    name: ServerEventName,
    properties: Properties = {},
    occurredAt?: Date,
  ) {
    await tx.insert(productAnalyticsEvents).values({
      tenantId: actor.tenantId,
      ...(occurredAt ? { occurredAt } : {}),
      actorPersonId: actor.personId,
      name,
      properties: { ...properties, source: 'api' },
    });
  }
}
