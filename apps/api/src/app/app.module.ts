import { AuditApiModule } from '@bf/api/audit';
import { BudgetsApiModule } from '@bf/api/budgets';
import { CoreModule, HttpEdgeModule } from '@bf/api/core';
import { FinanceApiModule } from '@bf/api/finance';
import { IntegrityApiModule } from '@bf/api/integrity';
import { LedgerApiModule } from '@bf/api/ledger';
import { OrgApiModule } from '@bf/api/org';
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
  ],
  controllers: [HealthController, OpenApiController],
})
export class AppModule {}
