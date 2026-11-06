import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { LedgerModule } from '@bf/api/ledger';
import { SpendModule } from '@bf/api/spend';
import { Module } from '@nestjs/common';
import { CloseController } from './close.controller';
import { CloseReads } from './close-reads';
import { ForecastCyclesService } from './forecast-cycles.service';
import { PeriodCloseService } from './period-close.service';
import { PeriodCloseChecks, STANDARD_PERIOD_CHECKS } from './period-close-checks';
import { RolloverPoliciesService } from './rollover-policies.service';
import { YearEndService } from './year-end.service';

/** The close checklist with the standard checks registered; a later phase registers more. */
const periodCloseChecks = {
  provide: PeriodCloseChecks,
  useFactory: () => {
    const checks = new PeriodCloseChecks();
    checks.registerAll(STANDARD_PERIOD_CHECKS);
    return checks;
  },
};

const SERVICES = [
  CloseReads,
  PeriodCloseService,
  RolloverPoliciesService,
  YearEndService,
  ForecastCyclesService,
];

/** Period close, year end and roll-forward services (also used by the seed). */
@Module({
  imports: [AuditModule, BudgetsModule, LedgerModule, SpendModule],
  providers: [periodCloseChecks, ...SERVICES],
  exports: [PeriodCloseChecks, ...SERVICES],
})
export class CloseModule {}

/** Period close and year-end HTTP endpoints. */
@Module({ imports: [CloseModule], controllers: [CloseController] })
export class CloseApiModule {}
