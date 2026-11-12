import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { DocumentsModule } from '@bf/api/documents';
import { FinanceModule } from '@bf/api/finance';
import { LedgerModule } from '@bf/api/ledger';
import { NotificationsModule } from '@bf/api/notifications';
import { RulesModule } from '@bf/api/rules';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { BudgetAlertsConsumer } from './budget-alerts.consumer';
import { CommitmentsService } from './commitments.service';
import { FundingSourcesService } from './funding-sources.service';
import { PostingSupport } from './posting-support';
import { RequestsController } from './requests.controller';
import { RequestPolicyService } from './request-policy.service';
import { RequestTaxService } from './request-tax.service';
import { RequestsService } from './requests.service';
import { SpendHooks } from './spend-hooks';

const SERVICES = [
  PostingSupport,
  FundingSourcesService,
  CommitmentsService,
  RequestsService,
  RequestPolicyService,
  RequestTaxService,
  SpendHooks,
  BudgetAlertsConsumer,
];

/** Requests and commitments. Phase 6 imports SpendModule and uses CommitmentsService (consume, release). */
@Module({
  imports: [
    AuditModule,
    BudgetsModule,
    LedgerModule,
    ApprovalsModule,
    NotificationsModule,
    TenancyModule,
    DocumentsModule,
    RulesModule,
    FinanceModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class SpendModule {}

@Module({ imports: [SpendModule], controllers: [RequestsController] })
export class SpendApiModule {}
