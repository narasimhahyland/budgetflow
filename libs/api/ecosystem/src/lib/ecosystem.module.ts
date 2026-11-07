import { AiModule } from '@bf/api/ai';
import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { IntegrationsModule } from '@bf/api/integrations';
import { SpendModule } from '@bf/api/spend';
import { Module } from '@nestjs/common';
import { AssistantConnectorService } from './assistants.service';
import { AutomationConnectorService } from './automations.service';
import { BiConnectorService } from './bi.service';
import { EcosystemConnectionsService } from './connections.service';
import { EcosystemController } from './ecosystem.controller';
import { EcosystemExternalController } from './external.controller';
import { MarketplaceService } from './marketplace.service';
import { EcosystemScopedReads } from './scoped-reads';
import { EcosystemSurfacesService } from './surfaces.service';
import { WidgetsService } from './widgets.service';

const SERVICES = [
  EcosystemSurfacesService,
  EcosystemConnectionsService,
  EcosystemScopedReads,
  BiConnectorService,
  AssistantConnectorService,
  AutomationConnectorService,
  MarketplaceService,
  WidgetsService,
];

/**
 * Phase 16 ecosystem services (also used by the seed). The surfaces here are deliberately built on
 * what already exists: Phase 12's token format, outbound host allow-list and connector framework,
 * Phase 13's AI scoping, minimization and query log, and the ordinary budget, request and approval
 * services. Nothing in this module reads a table another module owns.
 */
@Module({
  imports: [AuditModule, BudgetsModule, SpendModule, ApprovalsModule, IntegrationsModule, AiModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class EcosystemModule {}

/** Ecosystem HTTP endpoints: the signed-in surfaces and the token-authenticated ones. */
@Module({
  imports: [EcosystemModule],
  controllers: [EcosystemController, EcosystemExternalController],
})
export class EcosystemApiModule {}
