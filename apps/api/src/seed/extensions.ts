import type { INestApplicationContext } from '@nestjs/common';
import { seedActuals } from './actuals';
import { seedBudgets } from './budgets';
import { seedChannels } from './channels';
import { seedEvents } from './events';
import { seedEventsDepth } from './events-depth';
import { seedIntegrations } from './integrations';
import { seedOrg } from './org';
import { seedReports } from './reports';
import { seedRules } from './rules';

/**
 * Seed steps added by later phases, run in order after the Phase 1 reference data and budget tree.
 * A phase adds `apps/api/src/seed/<area>.ts` (data in `libs/seed/src/lib/<area>.ts`) and one line here
 * (integrator-owned). Every step is idempotent: fixed ids with ON CONFLICT DO NOTHING, or real commands
 * with fixed idempotency keys.
 */
export interface SeedExtension {
  name: string;
  phase: string;
  run(app: INestApplicationContext): Promise<void>;
}

export const SEED_EXTENSIONS: SeedExtension[] = [
  { name: 'org and finance master data', phase: 'P3', run: seedOrg },
  { name: 'budgets, controls and planning demo data', phase: 'P4', run: seedBudgets },
  { name: 'events, co-funding and requests', phase: 'P5', run: seedEvents },
  { name: 'actuals feeds, commitments, accruals and tie-outs', phase: 'P6', run: seedActuals },
  { name: 'channels, notifications, comments and digests', phase: 'P8', run: seedChannels },
  {
    name: 'policy rules, approval routes, DoA draft and post-spend exceptions',
    phase: 'P7',
    run: seedRules,
  },
  {
    name: 'event templates, plans, invitations, quotes, attendance and feedback',
    phase: 'P9',
    run: seedEventsDepth,
  },
  { name: 'saved report views, scheduled deliveries and exports', phase: 'P10', run: seedReports },
  {
    name: 'connected systems in Mock mode, mappings, an API key and a webhook endpoint',
    phase: 'P12',
    run: seedIntegrations,
  },
];
