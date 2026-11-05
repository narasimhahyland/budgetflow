import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule } from '@bf/api/budgets';
import { CoreModule } from '@bf/api/core';
import { DocumentsModule } from '@bf/api/documents';
import { NotificationsModule } from '@bf/api/notifications';
import { SpendModule } from '@bf/api/spend';
import { TenancyModule } from '@bf/api/tenancy';
import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  imports: [
    CoreModule,
    AuditModule,
    ApprovalsModule,
    BudgetsModule,
    SpendModule,
    DocumentsModule,
    NotificationsModule,
    TenancyModule,
  ],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}

@Module({
  imports: [ChannelsModule],
  controllers: [ChannelsController],
})
export class ChannelsApiModule {}
