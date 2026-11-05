import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { ContributionsModule } from '@bf/api/contributions';
import { DocumentsModule } from '@bf/api/documents';
import { LedgerModule } from '@bf/api/ledger';
import { SpendModule } from '@bf/api/spend';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { EventCloseChecks } from './event-close-checks';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { InsightsService } from './insights.service';

const SERVICES = [EventsService, InsightsService, EventCloseChecks];

/** Events; Phase 6 registers its unmatched-actuals close check on EventCloseChecks. */
@Module({
  imports: [
    AuditModule,
    LedgerModule,
    ApprovalsModule,
    SpendModule,
    ContributionsModule,
    DocumentsModule,
    TenancyModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class EventsModule {}

@Module({ imports: [EventsModule], controllers: [EventsController] })
export class EventsApiModule {}
