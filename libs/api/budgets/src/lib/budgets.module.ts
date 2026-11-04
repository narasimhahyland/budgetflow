import { AuditModule } from '@bf/api/audit';
import { LedgerModule } from '@bf/api/ledger';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { AllocationService } from './allocation.service';
import { BudgetViews } from './budget-views';
import { BudgetRequestsController, BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { ControlsService } from './controls.service';
import { PlanningService } from './planning.service';
import { PlanVersionsController, ProgramTemplatesController } from './planning.controller';

const SERVICES = [BudgetViews, BudgetsService, ControlsService, AllocationService, PlanningService];

@Module({
  imports: [AuditModule, LedgerModule, TenancyModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class BudgetsModule {}

@Module({
  imports: [BudgetsModule],
  controllers: [
    BudgetsController,
    BudgetRequestsController,
    PlanVersionsController,
    ProgramTemplatesController,
  ],
})
export class BudgetsApiModule {}
