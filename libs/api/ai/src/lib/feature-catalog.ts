import { AI_FEATURES, AI_FINANCE_FEATURES, type AiFeature } from '@bf/contracts';
import { ALLOWED_FACT_FIELDS } from './minimization';

/** What a feature can never do, whatever its switch says (113a turn-on dialog). */
const NEVER =
  'It cannot approve, reject, move money, post to the ledger or change a control or a rule.' as const;

export interface FeatureDefinition {
  feature: AiFeature;
  title: string;
  appearsOn: string;
  needsFinanceConfirmation: boolean;
  /** Turned on in the deterministic seed so the local stack and the demo show the feature. */
  seedEnabled: boolean;
  neverDoes: readonly string[];
}

export const FEATURE_CATALOG: readonly FeatureDefinition[] = AI_FEATURES.map((feature) => {
  const meta: Record<AiFeature, { title: string; appearsOn: string; seedEnabled: boolean }> = {
    ask: {
      title: 'Ask BudgetFlow in the app',
      appearsOn: 'Assistant panel (011a)',
      seedEnabled: true,
    },
    ask_chat: {
      title: 'Ask in Slack and Teams',
      appearsOn: 'Chat apps (061f)',
      seedEnabled: false,
    },
    outlook: {
      title: 'Spending outlook and nudges',
      appearsOn: 'Spending outlook (016b)',
      seedEnabled: true,
    },
    allocation_suggestions: {
      title: 'Suggested allocations',
      appearsOn: 'Allocation workspace (022d)',
      seedEnabled: true,
    },
    policy_explain: {
      title: 'Policy assistant explanations',
      appearsOn: 'Policy assistant (069a)',
      seedEnabled: true,
    },
    matching: {
      title: 'Transaction matching suggestions',
      appearsOn: 'Matching review (080f)',
      seedEnabled: true,
    },
    extraction: {
      title: 'Receipt and quote extraction',
      appearsOn: 'Upload receipt and vendor quotes (121a)',
      seedEnabled: true,
    },
    anomaly_flags: { title: 'Anomaly flags', appearsOn: 'Anomaly flags (017c)', seedEnabled: true },
  };
  return {
    feature,
    ...meta[feature],
    needsFinanceConfirmation: AI_FINANCE_FEATURES.includes(feature),
    neverDoes: [NEVER],
  };
}).sort((a, b) => a.title.localeCompare(b.title) || a.feature.localeCompare(b.feature));

export const featureDefinition = (feature: AiFeature): FeatureDefinition =>
  FEATURE_CATALOG.find((f) => f.feature === feature)!;

/** The exact field names a feature may send to the model; the turn-on dialog shows this list. */
export const dataSentFor = (feature: AiFeature): string[] =>
  [...ALLOWED_FACT_FIELDS[feature]].sort();
