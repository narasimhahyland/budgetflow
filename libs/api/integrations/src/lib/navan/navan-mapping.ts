import type { ActualLine, InboundRecord, MappingContext } from '../connectors';

/** A transaction as Navan returns it from any of the typed lists or the generic lookup. */
export interface NavanTransaction {
  id: string;
  type: string;
  transactionDate: string;
  modifiedAt: string;
  amount: string | number;
  currency: string;
  merchant?: string | null;
  description?: string | null;
  user?: { id?: string | null; email?: string | null } | null;
  hrFields?: {
    subsidiary?: string | null;
    costCenter?: string | null;
    department?: string | null;
    region?: string | null;
  } | null;
  glCode?: string | null;
  customFields?: { fieldId: string; value: string | null }[] | null;
  receipt?: { url: string; contentType?: string | null; expiresAt?: string | null } | null;
  originalTransactionId?: string | null;
  erpSyncStatus?: string | null;
}

export interface NavanUser {
  id: string;
  email: string;
  name?: string | null;
  active?: boolean;
}

const PROGRAMS: Record<string, string> = {
  CARD: 'Navan card',
  CONNECT: 'Connected card',
};

/** Resolves a Navan value through the connection's mappings, falling back to the value itself. */
const through = (ctx: MappingContext, kind: string, value: string | null | undefined): string => {
  const v = (value ?? '').trim();
  if (!v) return '';
  return ctx.mappings.get(`${kind}:${v.toLowerCase()}`) ?? v;
};

/**
 * One Navan transaction as a canonical actuals line. Charges, fees and adjustments up are positive;
 * repayments, rebates and dispute credits arrive negative and become refunds (with the original
 * transaction referenced) or credit notes. The event code comes from the custom field mapped as the
 * event-code field; HR fields give the legal entity and cost center through the connection's
 * mappings. A transaction without a legal entity is held back for a mapping, never guessed.
 */
export function navanToRecord(
  t: NavanTransaction,
  ctx: MappingContext & { eventCodeFieldId: string | null },
): InboundRecord {
  const entity = through(ctx, 'legal_entity', t.hrFields?.subsidiary);
  if (!entity) {
    return {
      externalId: t.id,
      requiresMapping: {
        kind: 'legal_entity',
        value: `subsidiary of ${t.user?.email ?? t.id}`,
      },
    };
  }
  const amount = Number(t.amount);
  const negative = amount < 0;
  const eventCode = ctx.eventCodeFieldId
    ? ((t.customFields ?? []).find((f) => f.fieldId === ctx.eventCodeFieldId)?.value ?? '')
    : '';
  const kind: ActualLine['kind'] = negative
    ? t.originalTransactionId
      ? 'refund'
      : 'credit_note'
    : 'charge';
  const typeLabel = t.type.charAt(0) + t.type.slice(1).toLowerCase();
  return {
    externalId: t.id,
    actual: {
      source_ref: t.id,
      transaction_date: t.transactionDate.slice(0, 10),
      accounting_date: t.transactionDate.slice(0, 10),
      amount: String(t.amount),
      currency: t.currency,
      legal_entity: entity,
      cost_center: through(ctx, 'cost_center', t.hrFields?.costCenter),
      gl_account: through(ctx, 'gl_account', t.glCode),
      event_code: eventCode ?? '',
      merchant: t.merchant ?? '',
      memo: `Navan ${typeLabel}: ${t.description ?? ''}`.trim(),
      reference: '',
      original_ref: negative ? (t.originalTransactionId ?? '') : '',
      kind,
      card_program: PROGRAMS[t.type] ?? '',
    },
  };
}
