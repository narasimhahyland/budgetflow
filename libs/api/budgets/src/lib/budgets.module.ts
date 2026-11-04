import { AuditModule } from '@bf/api/audit';
import { LedgerModule } from '@bf/api/ledger';
import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [AuditModule, LedgerModule],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}

@Module({ imports: [BudgetsModule], controllers: [BudgetsController] })
export class BudgetsApiModule {}
