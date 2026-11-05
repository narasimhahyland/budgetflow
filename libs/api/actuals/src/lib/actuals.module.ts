import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { LedgerModule } from '@bf/api/ledger';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { AccrualsService } from './accruals.service';
import { ActualsController } from './actuals.controller';
import { ActualsReads } from './actuals-reads';
import { CommitmentsService } from './commitments.service';
import { ActualsDtos } from './dto';
import { EventsCloseService } from './events.service';
import { ImportsService } from './imports.service';
import { MatchEngine } from './match-engine';
import { QueueService } from './queue.service';
import { RulesService } from './rules.service';
import { TieOutService } from './tieout.service';

const SERVICES = [
  ActualsReads,
  ActualsDtos,
  MatchEngine,
  ImportsService,
  QueueService,
  RulesService,
  CommitmentsService,
  AccrualsService,
  TieOutService,
  EventsCloseService,
];

/** Actuals and accounting services (also used by the seed). */
@Module({
  imports: [AuditModule, BudgetsModule, LedgerModule, TenancyModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class ActualsModule {}

/** Actuals and accounting HTTP endpoints. */
@Module({ imports: [ActualsModule], controllers: [ActualsController] })
export class ActualsApiModule {}
