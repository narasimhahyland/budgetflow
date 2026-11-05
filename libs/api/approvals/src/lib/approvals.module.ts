import { AuditModule } from '@bf/api/audit';
import { DocumentsModule } from '@bf/api/documents';
import { FinanceModule } from '@bf/api/finance';
import { LedgerModule } from '@bf/api/ledger';
import { NotificationsModule } from '@bf/api/notifications';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { ApprovalHandlers } from './approval-handlers';
import { ApprovalLinks } from './approval-links';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { BudgetImpactService } from './budget-impact';
import { RoutingService } from './routing.service';
import { SlaSweepService } from './sla-sweep.service';

const SERVICES = [
  ApprovalHandlers,
  ApprovalLinks,
  ApprovalsService,
  BudgetImpactService,
  RoutingService,
  SlaSweepService,
];

/** Approval engine; subject modules (spend, contributions) register their handlers with ApprovalHandlers. */
@Module({
  imports: [
    AuditModule,
    LedgerModule,
    FinanceModule,
    NotificationsModule,
    TenancyModule,
    DocumentsModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class ApprovalsModule {}

@Module({ imports: [ApprovalsModule, DocumentsModule], controllers: [ApprovalsController] })
export class ApprovalsApiModule {}
