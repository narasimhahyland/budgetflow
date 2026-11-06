import { AiModule } from '@bf/api/ai';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { LedgerModule } from '@bf/api/ledger';
import { SpendModule } from '@bf/api/spend';
import { Module } from '@nestjs/common';
import { ExtendedController } from './extended.controller';
import { NarrativesService } from './narratives.service';
import { OutcomesService } from './outcomes.service';
import { RecognitionService } from './recognition.service';
import { ScenariosService } from './scenarios.service';
import { WalletsService } from './wallets.service';

const SERVICES = [
  ScenariosService,
  NarrativesService,
  OutcomesService,
  WalletsService,
  RecognitionService,
];

/**
 * Extended product features (Phase 15). The services are exported so later phases can read a
 * scenario or a wallet balance; none of them offers a way to post money that does not already go
 * through `libs/domain` posting builders and `PolicyService`.
 */
@Module({
  imports: [AuditModule, BudgetsModule, LedgerModule, SpendModule, AiModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class ExtendedModule {}

/** Scenarios, insights, wallets and recognition HTTP endpoints. */
@Module({ imports: [ExtendedModule], controllers: [ExtendedController] })
export class ExtendedApiModule {}
