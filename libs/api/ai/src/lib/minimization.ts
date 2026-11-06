import type { AiFeature } from '@bf/contracts';
import type { Fact } from './provider/ai-provider';

/**
 * Data minimization (`ai-features.mdc`): a feature may send only the fields listed here, and a value
 * that looks like personal data or a credential is dropped whatever its field is called. The query
 * log records the field names that survived, so an auditor can see exactly what left the server.
 */
const COMMON_FIELDS = ['status', 'currency', 'date'] as const;

export const ALLOWED_FACT_FIELDS: Record<AiFeature, readonly string[]> = {
  ask: [
    ...COMMON_FIELDS,
    'authorizedMinor',
    'allocatedOutMinor',
    'heldMinor',
    'preEncumberedMinor',
    'encumberedMinor',
    'actualMinor',
    'availableMinor',
    'utilizationBps',
    'budgetType',
    'categoryCode',
    'fiscalYearLabel',
    'ownerName',
    'eventDate',
    'reference',
    'amountMinor',
    'childCount',
  ],
  ask_chat: [
    ...COMMON_FIELDS,
    'authorizedMinor',
    'availableMinor',
    'encumberedMinor',
    'actualMinor',
    'utilizationBps',
    'reference',
    'amountMinor',
  ],
  outlook: [
    ...COMMON_FIELDS,
    'authorizedMinor',
    'actualMinor',
    'encumberedMinor',
    'toDateMinor',
    'likelyMinor',
    'lowMinor',
    'highMinor',
    'monthsObserved',
    'monthlyRunRateMinor',
    'openCommitmentsMinor',
    'pendingRequestsMinor',
    'monthsRemaining',
    'ownerName',
  ],
  allocation_suggestions: [
    ...COMMON_FIELDS,
    'eligibleHeadcount',
    'priorAuthorizedMinor',
    'priorConsumedMinor',
    'priorUseBps',
    'participationBps',
    'participationGroupSize',
    'currentAllocationMinor',
    'amountToSplitMinor',
    'driver',
  ],
  policy_explain: [
    ...COMMON_FIELDS,
    'outcome',
    'ruleCode',
    'ruleVersion',
    'policyTitle',
    'limitMinor',
    'amountMinor',
    'perPersonMinor',
    'attendees',
    'categoryCode',
    'legalEntityCode',
    'approverRole',
  ],
  matching: [
    ...COMMON_FIELDS,
    'merchant',
    'memo',
    'postedDate',
    'amountMinor',
    'budgetAmountMinor',
    'claimantInitials',
    'costCenterCode',
    'eventCode',
    'eventDate',
    'remainingMinor',
    'totalMinor',
    'daysApart',
    'amountDifferenceMinor',
  ],
  extraction: [
    ...COMMON_FIELDS,
    'fileName',
    'mimeType',
    'documentKind',
    'pageCount',
    'sizeBytes',
    'expectedCurrency',
  ],
  anomaly_flags: [
    ...COMMON_FIELDS,
    'kind',
    'amountMinor',
    'peerMedianMinor',
    'peerGroupSize',
    'attendees',
    'perHeadMinor',
    'vendorCategory',
    'categoryCode',
    'daysApart',
    'imageSimilarityBps',
    'combinedMinor',
    'limitMinor',
  ],
};

/** Field names that must never reach a model, whatever a feature's allow-list says. */
const DENIED_FIELD_NAMES =
  /(email|phone|mobile|address|passport|dob|birth|ssn|aadhaar|pan|iban|account_?number|card|cvv|pin|token|secret|password|credential|signature|apikey|api_?key)/i;

/** Values that look like personal data or a credential, whatever field they arrived in. */
const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // email address
  /\b(?:\d[ -]*?){13,19}\b/, // payment card number
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{10,}/i, // authorization header
  /\b(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9]{10,}/, // provider or platform key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export interface Minimized {
  facts: Fact[];
  /** Field names actually sent, sorted; the query log stores exactly this list. */
  sentFields: string[];
  /** Field names dropped because they were not allowed or looked like personal data. */
  dropped: string[];
}

const scalar = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * Keeps only the fields `feature` is allowed to send and drops anything that looks like personal data
 * or a credential. Returns the surviving field names so the caller can log what was sent.
 */
export function minimize(feature: AiFeature, facts: readonly Fact[]): Minimized {
  const allowed = new Set(ALLOWED_FACT_FIELDS[feature]);
  const sent = new Set<string>();
  const dropped = new Set<string>();
  const out = facts.map((fact) => {
    const fields: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(fact.fields).sort(([a], [b]) => a.localeCompare(b))) {
      if (!allowed.has(key) || DENIED_FIELD_NAMES.test(key) || !scalar(value)) {
        dropped.add(key);
        continue;
      }
      if (typeof value === 'string' && DENIED_VALUE_PATTERNS.some((p) => p.test(value))) {
        dropped.add(key);
        continue;
      }
      fields[key] = value;
      sent.add(key);
    }
    return { type: fact.type, id: fact.id, label: fact.label, fields };
  });
  return {
    facts: out,
    sentFields: [...sent].sort(),
    dropped: [...dropped].sort(),
  };
}

/** The asker's own question, trimmed and stripped of anything that looks like a credential. */
export function minimizePrompt(prompt: string): string {
  let out = prompt.slice(0, 500);
  for (const pattern of DENIED_VALUE_PATTERNS)
    out = out.replace(new RegExp(pattern, 'gi'), '[removed]');
  return out.trim();
}
