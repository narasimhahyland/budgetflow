import { z } from 'zod';
import { Id, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Audit ----------------------------------------------------------------------------------------
export const AuditEvent = named(
  'AuditEvent',
  z
    .object({
      id: Id,
      seq: z.int(),
      occurredAt: IsoDateTime,
      actorPersonId: Id.nullable(),
      actorSubject: z.string().nullable(),
      onBehalfOfPersonId: Id.nullable(),
      action: z.string(),
      resourceType: z.string(),
      resourceId: z.string(),
      legalEntityId: Id.nullable(),
      requestId: z.string().nullable(),
      reason: z.string().nullable(),
      changes: z.record(z.string(), z.unknown()),
      prevHash: z.string().length(64),
      hash: z.string().length(64),
    })
    .strict(),
);

export const AuditEventList = named(
  'AuditEventList',
  z.object({ items: z.array(AuditEvent), nextCursor: z.string().nullable() }).strict(),
);

export const AuditEventQuery = z
  .object({
    resourceType: z.string().max(50).optional(),
    resourceId: z.string().max(100).optional(),
    action: z.string().max(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const AuditVerification = named(
  'AuditVerification',
  z
    .object({
      valid: z.boolean(),
      checked: z.int(),
      firstBrokenSeq: z.int().nullable(),
      reason: z.string().nullable(),
      verifiedAt: IsoDateTime,
    })
    .strict(),
);

export type AuditEvent = z.infer<typeof AuditEvent>;
export type AuditEventList = z.infer<typeof AuditEventList>;
export type AuditVerification = z.infer<typeof AuditVerification>;

export const auditEndpoints = {
  listAuditEvents: {
    operationId: 'listAuditEvents',
    method: 'get',
    path: '/api/audit/events',
    summary: 'Hash-chained audit events',
    tags: ['audit'],
    auth: true,
    query: AuditEventQuery,
    response: { status: 200, schema: AuditEventList },
    errors: [400, 401, 403],
  },
  verifyAuditChain: {
    operationId: 'verifyAuditChain',
    method: 'get',
    path: '/api/audit/verification',
    summary: "Verify the tenant's audit hash chain",
    tags: ['audit'],
    auth: true,
    response: { status: 200, schema: AuditVerification },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;
