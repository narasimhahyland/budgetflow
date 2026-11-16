import { AdminModule } from '@bf/api/admin';
import { ApprovalsModule } from '@bf/api/approvals';
import { ContributionsModule } from '@bf/api/contributions';
import { ChannelsModule } from '@bf/api/channels';
import { CloseModule } from '@bf/api/close';
import { CoreModule } from '@bf/api/core';
import { DocumentsModule } from '@bf/api/documents';
import { EventsModule } from '@bf/api/events';
import { NotificationsModule } from '@bf/api/notifications';
import { ReportsModule } from '@bf/api/reports';
import { SpendModule } from '@bf/api/spend';
import { IntegrationsModule } from '@bf/api/integrations';
import { IntegrityModule } from '@bf/api/integrity';
import { Controller, Get, HttpException, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('health')
class WorkerHealthController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  health() {
    if (!this.jobs.ready) throw new HttpException({ status: 'starting' }, 503);
    return { status: 'ok' };
  }
}

/** The worker reuses the API's application services (integrity, notifications, events and their budget-control consumer); no HTTP edge beyond health. */
@Module({
  imports: [
    CoreModule,
    IntegrityModule,
    NotificationsModule,
    DocumentsModule,
    SpendModule,
    ContributionsModule,
    EventsModule,
    ChannelsModule,
    ApprovalsModule,
    ReportsModule,
    IntegrationsModule,
    AdminModule,
    CloseModule,
  ],
  providers: [JobsService],
  controllers: [WorkerHealthController],
})
export class WorkerModule {}
