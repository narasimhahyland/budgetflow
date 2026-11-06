import { AuditModule } from '@bf/api/audit';
import { DocumentsModule } from '@bf/api/documents';
import { NotificationsModule } from '@bf/api/notifications';
import { Module } from '@nestjs/common';
import { BoardPackService } from './board-pack.service';
import { HealthService } from './health.service';
import { ReportDeliveryService } from './report-delivery.service';
import { ReportExtrasReads } from './report-extras.service';
import { ReportReads } from './report-reads.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SavedViewsService } from './saved-views.service';
import { SchedulesService } from './schedules.service';

/** Phase 10 reporting read models, saved views, schedules and the worker-side delivery job. */
@Module({
  imports: [AuditModule, NotificationsModule, DocumentsModule],
  providers: [
    ReportReads,
    ReportExtrasReads,
    ReportsService,
    HealthService,
    SavedViewsService,
    SchedulesService,
    ReportDeliveryService,
    BoardPackService,
  ],
  exports: [
    ReportsService,
    HealthService,
    SavedViewsService,
    SchedulesService,
    ReportDeliveryService,
    BoardPackService,
  ],
})
export class ReportsModule {}

@Module({ imports: [ReportsModule], controllers: [ReportsController] })
export class ReportsApiModule {}
