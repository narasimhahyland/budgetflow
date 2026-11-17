import { ApiProblem } from '@bf/api/core';
import type { IntegrationProvider } from '@bf/contracts';
import { connectorFor } from './connectors';

/** Connection setting (094): off by default; Warn (default when on) or Block. */
export interface BudgetCheckSetting {
  enabled: boolean;
  mode: 'warn' | 'block';
}

export function budgetCheckSetting(settings: unknown): BudgetCheckSetting {
  const raw = (settings as { budgetCheck?: { enabled?: unknown; mode?: unknown } } | null)
    ?.budgetCheck;
  return {
    enabled: raw?.enabled === true,
    mode: raw?.mode === 'block' ? 'block' : 'warn',
  };
}

/** Used by the connection settings update to refuse a malformed budget-check setting. */
export function assertBudgetCheckSetting(provider: string, settings: Record<string, unknown>) {
  if (!('budgetCheck' in settings)) return;
  if (!connectorFor(provider as IntegrationProvider)?.budgetCheck)
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      'Only ERPs that control budgets themselves (Workday Financials) offer a budget check.',
      { field: 'settings.budgetCheck' },
    );
  const raw = settings['budgetCheck'] as { enabled?: unknown; mode?: unknown } | null;
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof raw.enabled !== 'boolean' ||
    (raw.mode !== undefined && raw.mode !== 'warn' && raw.mode !== 'block')
  )
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      'The budget check needs "enabled" (true or false) and a mode of Warn or Block.',
      { field: 'settings.budgetCheck' },
    );
}
