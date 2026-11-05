import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  BudgetHealthQuery,
  CreateExportRequest,
  CreateSavedViewRequest,
  CreateScheduleRequest,
  ReportDrilldownQuery,
  ReportId,
  ReportRunQuery,
  UpdateScheduleRequest,
  type BudgetHealthOverview,
  type ReportCatalog,
  type ReportDrilldown,
  type ReportExport,
  type ReportResult,
  type ReportSchedule,
  type SavedReportView,
  type ScheduleRun,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { HealthService } from './health.service';
import { ReportsService } from './reports.service';
import { SavedViewsService } from './saved-views.service';
import { SchedulesService } from './schedules.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const Uuid = z.uuid();

@Controller('api')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly health: HealthService,
    private readonly views: SavedViewsService,
    private readonly schedules: SchedulesService,
  ) {}

  @Get('reports')
  catalog(@CurrentActor() actor: RequestActor): Promise<ReportCatalog> {
    return this.reports.catalog(actor);
  }

  @Get('reports/views')
  listViews(@CurrentActor() actor: RequestActor): Promise<{ items: SavedReportView[] }> {
    return this.views.list(actor);
  }

  @Post('reports/views')
  @HttpCode(201)
  async createView(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<SavedReportView> {
    const r = await this.views.create(actor, parseWith(CreateSavedViewRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('reports/views/:viewId')
  @HttpCode(200)
  async deleteView(
    @CurrentActor() actor: RequestActor,
    @Param('viewId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ items: SavedReportView[] }> {
    const r = await this.views.remove(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('reports/schedules')
  listSchedules(@CurrentActor() actor: RequestActor): Promise<{ items: ReportSchedule[] }> {
    return this.schedules.list(actor);
  }

  @Post('reports/schedules')
  @HttpCode(201)
  async createSchedule(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ReportSchedule> {
    const r = await this.schedules.create(actor, parseWith(CreateScheduleRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Patch('reports/schedules/:scheduleId')
  @HttpCode(200)
  async updateSchedule(
    @CurrentActor() actor: RequestActor,
    @Param('scheduleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ReportSchedule> {
    const r = await this.schedules.update(
      actor,
      parseWith(Uuid, raw),
      parseWith(UpdateScheduleRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete('reports/schedules/:scheduleId')
  @HttpCode(200)
  async deleteSchedule(
    @CurrentActor() actor: RequestActor,
    @Param('scheduleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<{ items: ReportSchedule[] }> {
    const r = await this.schedules.remove(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post('reports/schedules/:scheduleId/runs')
  @HttpCode(202)
  async runSchedule(
    @CurrentActor() actor: RequestActor,
    @Param('scheduleId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ScheduleRun> {
    const r = await this.schedules.runNow(actor, parseWith(Uuid, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('reports/schedules/:scheduleId/runs')
  scheduleRuns(
    @CurrentActor() actor: RequestActor,
    @Param('scheduleId') raw: string,
  ): Promise<{ items: ScheduleRun[] }> {
    return this.schedules.runs(actor, parseWith(Uuid, raw));
  }

  @Get('reports/exports')
  listExports(@CurrentActor() actor: RequestActor): Promise<{ items: ReportExport[] }> {
    return this.schedules.listExports(actor);
  }

  @Get('dashboards/health')
  budgetHealth(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<BudgetHealthOverview> {
    return this.health.overview(actor, parseWith(BudgetHealthQuery, raw));
  }

  @Get('reports/:reportId/run')
  run(
    @CurrentActor() actor: RequestActor,
    @Param('reportId') rawId: string,
    @Query() raw: unknown,
  ): Promise<ReportResult> {
    const { limit, ...filters } = parseWith(ReportRunQuery, raw);
    return this.reports.run(actor, parseWith(ReportId, rawId), filters, limit);
  }

  @Get('reports/:reportId/drilldown')
  drilldown(
    @CurrentActor() actor: RequestActor,
    @Param('reportId') rawId: string,
    @Query() raw: unknown,
  ): Promise<ReportDrilldown> {
    return this.reports.drilldown(
      actor,
      parseWith(ReportId, rawId),
      parseWith(ReportDrilldownQuery, raw),
    );
  }

  @Post('reports/:reportId/exports')
  @HttpCode(201)
  async createExport(
    @CurrentActor() actor: RequestActor,
    @Param('reportId') rawId: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ReportExport> {
    const reportId = parseWith(ReportId, rawId);
    const request = parseWith(CreateExportRequest, body);
    const result = await this.reports.run(actor, reportId, request.filters, 500);
    const r = await this.schedules.createExport(
      actor,
      reportId,
      request,
      { idempotencyKey, requestId },
      result.rowCount,
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }
}
