import type { AiChannel, AiFeature } from '@bf/contracts';

/** The feature names people see on the Features tab, for every place a feature key would show. */
export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  ask: 'Ask BudgetFlow',
  ask_chat: 'Ask in Slack and Teams',
  outlook: 'Spending outlook',
  allocation_suggestions: 'Suggested allocations',
  policy_explain: 'Policy assistant',
  matching: 'Transaction matching suggestions',
  extraction: 'Receipt and quote details',
  anomaly_flags: 'Anomaly flags',
  leadership_summary: 'Leadership summaries',
  variance_commentary: 'Variance commentary',
  mcp: 'Connector for AI assistants',
};

const CHANNEL_LABELS: Record<AiChannel, string> = {
  web: 'Web',
  mobile: 'Mobile',
  slack: 'Slack',
  teams: 'Teams',
  system: 'Scheduled',
  mcp: 'AI assistant connector',
};

export const aiFeatureLabel = (feature: string): string =>
  AI_FEATURE_LABELS[feature as AiFeature] ?? feature;

export const aiChannelLabel = (channel: string): string =>
  CHANNEL_LABELS[channel as AiChannel] ?? channel;

const VERBS: Record<string, string> = {
  read: 'Read',
  manage: 'Manage',
  approve: 'Approve',
  request: 'Request',
  resolve: 'Resolve',
};

/** A permission such as `actuals.read` in words: "Read actuals". */
export function permissionLabel(permission: string): string {
  const [area, verb] = permission.split('.');
  if (!verb) return permission.replace(/_/g, ' ');
  return `${VERBS[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1)} ${area.replace(/_/g, ' ')}`;
}

/** Screen references such as "(017c)" are for the team, not for the people reading the page. */
export const withoutScreenIds = (text: string): string => text.replace(/\s*\(\d{3}[a-z]?\)/g, '');

/** A field key the model receives, in words: `availableMinor` reads "Available". */
export function fieldName(key: string): string {
  const words = key
    .replace(/(Minor|Bps|Pct|Id)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}
