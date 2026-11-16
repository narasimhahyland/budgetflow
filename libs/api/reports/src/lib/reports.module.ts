import { AuditModule } from '@bf/api/audit';
import { CloseModule } from '@bf/api/close';
import { TenancyModule } from '@bf/api/tenancy';
import { DocumentsModule } from '@bf/api/documents';
import { NotificationsModule } from '@bf/api/notifications';
import { Module } from '@nestjs/common';
import { BoardPackService } from './board-pack.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import { ApprovalsDashboardsService } from './approvals-dashboards.service';
import { EvidencePacksService } from './evidence-packs.service';
import { InsightsController } from './insights.controller';
import { ProductAnalyticsService } from './product-analytics.service';
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
  imports: [AuditModule, NotificationsModule, DocumentsModule, CloseModule, TenancyModule],
  providers: [
    ReportReads,
    ReportExtrasReads,
    ReportsService,
    HealthService,
    SavedViewsService,
    SchedulesService,
    ReportDeliveryService,
    BoardPackService,
    DashboardsService,
    ApprovalsDashboardsService,
    ProductAnalyticsService,
    EvidencePacksService,
  ],
  exports: [
    ReportsService,
    HealthService,
    SavedViewsService,
    SchedulesService,
    ReportDeliveryService,
    BoardPackService,
    DashboardsService,
    ApprovalsDashboardsService,
    ProductAnalyticsService,
    EvidencePacksService,
  ],
})
export class ReportsModule {}

@Module({
  imports: [ReportsModule],
  controllers: [ReportsController, DashboardsController, InsightsController],
})
export class ReportsApiModule {}
