import { ActualsModule } from '@bf/api/actuals';
import { AuditModule } from '@bf/api/audit';
import { CoreModule } from '@bf/api/core';
import { LedgerModule } from '@bf/api/ledger';
import { OrgModule } from '@bf/api/org';
import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ConnectionsService } from './connections.service';
import { DuplicatesService } from './duplicates.service';
import { IntegrationsController } from './integrations.controller';
import { MessagesService } from './messages.service';
import { OutboundHttp } from './http';
import { PlanImportService } from './plan-import.service';
import { PublicApiController } from './public-api.controller';
import { PushesService } from './pushes.service';
import { ScimService } from './scim.service';
import { SyncService } from './sync.service';
import { WebhooksService } from './webhooks.service';

const SERVICES = [
  OutboundHttp,
  ConnectionsService,
  SyncService,
  MessagesService,
  PushesService,
  DuplicatesService,
  PlanImportService,
  ApiKeysService,
  WebhooksService,
  ScimService,
];

/** Services only: imported by the worker for webhook delivery and by the API through IntegrationsApiModule. */
@Module({
  imports: [CoreModule, AuditModule, LedgerModule, ActualsModule, OrgModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class IntegrationsModule {}

/**
 * Routes: the integrations area (092-101) and the public API v1 (101a). The public controller reads
 * balances and feeds the actuals review, so it needs those modules alongside the integration services.
 */
@Module({
  imports: [IntegrationsModule, CoreModule, LedgerModule, ActualsModule],
  controllers: [IntegrationsController, PublicApiController],
})
export class IntegrationsApiModule {}
