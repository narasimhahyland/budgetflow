import { ApprovalsApiModule } from '@bf/api/approvals';
import { ActualsApiModule } from '@bf/api/actuals';
import { AuditApiModule } from '@bf/api/audit';
import { BudgetsApiModule } from '@bf/api/budgets';
import { ContributionsApiModule } from '@bf/api/contributions';
import { CoreModule, HttpEdgeModule } from '@bf/api/core';
import { DocumentsApiModule } from '@bf/api/documents';
import { EventsApiModule } from '@bf/api/events';
import { FinanceApiModule } from '@bf/api/finance';
import { IntegrityApiModule } from '@bf/api/integrity';
import { LedgerApiModule } from '@bf/api/ledger';
import { OrgApiModule } from '@bf/api/org';
import { SpendApiModule } from '@bf/api/spend';
import { TenancyApiModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { HealthController, OpenApiController } from './health.controller';

/** Wires domain modules (libs/api/*) behind the HTTP edge. Later phases add their *ApiModule here. */
@Module({
  imports: [
    CoreModule,
    HttpEdgeModule,
    TenancyApiModule,
    BudgetsApiModule,
    LedgerApiModule,
    AuditApiModule,
    IntegrityApiModule,
    OrgApiModule,
    FinanceApiModule,
    ApprovalsApiModule,
    DocumentsApiModule,
    SpendApiModule,
    ContributionsApiModule,
    EventsApiModule,
    ActualsApiModule,
  ],
  controllers: [HealthController, OpenApiController],
})
export class AppModule {}
