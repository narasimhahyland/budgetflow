import { ApiProblem } from '@bf/api/core';
import { NavanSettings } from '@bf/contracts';
import { integrationsConfig } from '../config';
import type { ConnectionRow } from '../connections.service';
import type { NavanConnection } from './navan-client';

/** The Navan settings of a connection, with the documented defaults for anything not set yet. */
export function navanSettingsOf(row: Pick<ConnectionRow, 'settings'>): NavanSettings {
  const parsed = NavanSettings.safeParse(row.settings ?? {});
  return parsed.success ? parsed.data : NavanSettings.parse({});
}

/**
 * Checks Navan settings a person sent (connect or update), merged over what is stored. Unknown keys
 * are dropped; a wrong type or a value past Navan's limits is refused with the field named.
 */
export function validNavanSettings(merged: Record<string, unknown>): NavanSettings {
  const parsed = NavanSettings.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      `Navan setting ${issue.path.join('.')}: ${issue.message}`,
      { field: `settings.${issue.path.join('.')}` },
    );
  }
  return parsed.data;
}

/** Sandbox and live Navan connections call the real API, which this installation may not allow. */
export function assertNavanModeAllowed(mode: string): void {
  if (mode !== 'mock' && !integrationsConfig().navanLiveEnabled) {
    throw new ApiProblem(
      409,
      'NAVAN_LIVE_DISABLED',
      'Navan sandbox and live calls are switched off on this installation. Use Mock mode, or set NAVAN_LIVE_ENABLED=true outside CI.',
    );
  }
}

/** Where a connection's calls go: the mock provider in Mock mode, Navan itself otherwise. */
export function navanConnectionOf(row: ConnectionRow, credential: string): NavanConnection {
  assertNavanModeAllowed(row.mode);
  if (!row.clientId) {
    throw new ApiProblem(
      409,
      'INTEGRATION_NOT_CONNECTED',
      'This Navan connection has no client id. Reconnect it with the client id and secret.',
    );
  }
  return {
    connectionId: row.id,
    secretRef: row.secretRef ?? '',
    baseUrl:
      row.mode === 'mock'
        ? `${integrationsConfig().mockBaseUrl}/navan`
        : (row.baseUrl ?? 'https://api.navan.com').replace(/\/+$/, ''),
    clientId: row.clientId,
    clientSecret: credential,
    region: navanSettingsOf(row).region,
  };
}
