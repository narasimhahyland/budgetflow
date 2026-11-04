import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { DocumentsModule } from '@bf/api/documents';
import { LedgerModule } from '@bf/api/ledger';
import { NotificationsModule } from '@bf/api/notifications';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { CommitmentsService } from './commitments.service';
import { FundingSourcesService } from './funding-sources.service';
import { PostingSupport } from './posting-support';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { SpendHooks } from './spend-hooks';

const SERVICES = [
  PostingSupport,
  FundingSourcesService,
  CommitmentsService,
  RequestsService,
  SpendHooks,
];

/** Requests and commitments. Phase 6 imports SpendModule and uses CommitmentsService (consume, release). */
@Module({
  imports: [
    AuditModule,
    LedgerModule,
    ApprovalsModule,
    NotificationsModule,
    TenancyModule,
    DocumentsModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class SpendModule {}

@Module({ imports: [SpendModule], controllers: [RequestsController] })
export class SpendApiModule {}
