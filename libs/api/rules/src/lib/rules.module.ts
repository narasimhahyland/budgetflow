import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { LedgerModule } from '@bf/api/ledger';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { DoaAdminService } from './doa-admin.service';
import { ExceptionsService } from './exceptions.service';
import { PolicyConfigService } from './policy-config.service';
import { RuleSimulationService } from './rule-simulation.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { WorkflowTestService } from './workflow-test.service';

const SERVICES = [
  RulesService,
  RuleSimulationService,
  PolicyConfigService,
  WorkflowTestService,
  DoaAdminService,
  ExceptionsService,
];

/** Rules engine, approval routing, DoA administration, policy sections and post-spend exceptions. */
@Module({
  imports: [AuditModule, LedgerModule, TenancyModule, ApprovalsModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class RulesModule {}

@Module({ imports: [RulesModule], controllers: [RulesController] })
export class RulesApiModule {}
