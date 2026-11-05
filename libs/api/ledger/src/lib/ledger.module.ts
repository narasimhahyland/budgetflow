import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { LedgerCommands } from './ledger-commands.service';
import { LedgerController } from './ledger.controller';
import { LedgerReads } from './ledger-reads.service';
import { LedgerService } from './ledger.service';
import { ThresholdAlerts } from './threshold-alerts.service';

/** Posting, balances, periods and plan rates (used by budgets, the seed and later spend modules). */
@Module({
  imports: [AuditModule],
  providers: [LedgerReads, LedgerService, LedgerCommands, ThresholdAlerts],
  exports: [LedgerReads, LedgerService, LedgerCommands, ThresholdAlerts],
})
export class LedgerModule {}

/** Ledger HTTP endpoints (API only). */
@Module({ imports: [LedgerModule], controllers: [LedgerController] })
export class LedgerApiModule {}
