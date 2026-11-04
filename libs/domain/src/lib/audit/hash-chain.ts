/**
 * Per-tenant SHA-256 hash chain for the audit trail: hash = sha256(prevHash || canonicalJson(event)).
 * The hash function is injected so this stays free of platform APIs.
 */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export type Sha256Hex = (input: string) => string;

export interface AuditPayload {
  tenantId: string;
  seq: number;
  id: string;
  occurredAt: string;
  actorId: string | null;
  onBehalfOfId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  legalEntityId: string | null;
  requestId: string | null;
  reason: string | null;
  changes: unknown;
}

/** JSON with recursively sorted keys and no whitespace; undefined values are dropped, bigints become strings. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return 'null';
}

export function auditHash(prevHash: string, payload: AuditPayload, sha256: Sha256Hex): string {
  return sha256(prevHash + canonicalJson(payload));
}

export interface StoredAuditEvent extends AuditPayload {
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBrokenSeq: number | null;
  reason: string | null;
}

/** Walks the chain in sequence order and reports the first broken link. */
export function verifyAuditChain(
  events: readonly StoredAuditEvent[],
  sha256: Sha256Hex,
): ChainVerification {
  let prev = AUDIT_GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of events) {
    const { prevHash, hash, ...payload } = e;
    if (e.seq !== expectedSeq)
      return {
        valid: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: e.seq,
        reason: `sequence gap before ${e.seq}`,
      };
    if (prevHash !== prev)
      return {
        valid: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: e.seq,
        reason: 'previous hash does not match',
      };
    if (auditHash(prevHash, payload, sha256) !== hash)
      return {
        valid: false,
        checked: expectedSeq - 1,
        firstBrokenSeq: e.seq,
        reason: 'content does not match its hash',
      };
    prev = hash;
    expectedSeq++;
  }
  return { valid: true, checked: events.length, firstBrokenSeq: null, reason: null };
}

/** Changed fields only: { field: { from, to } }. */
export function diffChanges(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])) {
    const a = previous?.[k] ?? null;
    const b = next[k] ?? null;
    if (canonicalJson(a) !== canonicalJson(b)) out[k] = { from: a, to: b };
  }
  return out;
}
