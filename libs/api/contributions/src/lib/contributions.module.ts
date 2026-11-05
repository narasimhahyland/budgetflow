import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { DocumentsModule } from '@bf/api/documents';
import { NotificationsModule } from '@bf/api/notifications';
import { SpendModule } from '@bf/api/spend';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { BudgetControlConsumer } from './budget-control.consumer';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { IntercompanyService } from './intercompany.service';

const SERVICES = [ContributionsService, IntercompanyService, BudgetControlConsumer];

/** Inter-Director Budget Contribution Requests, intercompany and recharges; the worker imports it for budget controls. */
@Module({
  imports: [
    AuditModule,
    ApprovalsModule,
    SpendModule,
    NotificationsModule,
    TenancyModule,
    DocumentsModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class ContributionsModule {}

@Module({ imports: [ContributionsModule], controllers: [ContributionsController] })
export class ContributionsApiModule {}
