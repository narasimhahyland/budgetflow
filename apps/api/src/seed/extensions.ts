import type { INestApplicationContext } from '@nestjs/common';
import { seedOrg } from './org';

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
];
