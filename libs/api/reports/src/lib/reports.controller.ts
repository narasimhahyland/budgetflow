import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  BoardPackPageId,
  BoardPackQuery,
  BudgetHealthQuery,
  CreateBoardPackRequest,
  CreateExportRequest,
  CreateSavedViewRequest,
  CreateScheduleRequest,
  ReportDrilldownQuery,
  ReportId,
  ReportRunQuery,
  UpdateScheduleRequest,
  type BoardPack,
  type BoardPackDownload,
  type BoardPackGeneration,
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
import { BoardPackService } from './board-pack.service';
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
    private readonly packs: BoardPackService,
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

  // 016a Board and FP&A pack. Declared before the `:reportId` routes so "board-pack" is never
  // read as a report id.
  @Get('reports/board-pack')
  boardPack(@CurrentActor() actor: RequestActor, @Query() raw: unknown): Promise<BoardPack> {
    const q = parseWith(BoardPackQuery, raw);
    return this.packs.preview(actor, {
      fiscalPeriodId: q.fiscalPeriodId,
      draft: q.draft === 'true',
      pages: q.pages
        ? q.pages
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => parseWith(BoardPackPageId, p))
        : undefined,
      constantCurrency: q.constantCurrency !== 'false',
      rootBudgetId: q.rootBudgetId,
      forecastCycleId: q.forecastCycleId,
    });
  }

  @Get('reports/board-pack/generations')
  listBoardPacks(@CurrentActor() actor: RequestActor): Promise<{ items: BoardPackGeneration[] }> {
    return this.packs.list(actor);
  }

  @Get('reports/board-pack/generations/:generationId')
  boardPackGeneration(
    @CurrentActor() actor: RequestActor,
    @Param('generationId') raw: string,
  ): Promise<BoardPackGeneration> {
    return this.packs.generation(actor, parseWith(Uuid, raw));
  }

  @Get('reports/board-pack/generations/:generationId/download')
  boardPackDownload(
    @CurrentActor() actor: RequestActor,
    @Param('generationId') raw: string,
    @Query() query: unknown,
  ): Promise<BoardPackDownload> {
    const { format } = parseWith(z.object({ format: z.enum(['pdf', 'xlsx']) }).strict(), query);
    return this.packs.download(actor, parseWith(Uuid, raw), format);
  }

  @Post('reports/board-pack/generations')
  @HttpCode(202)
  async createBoardPack(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<BoardPackGeneration> {
    const r = await this.packs.create(actor, parseWith(CreateBoardPackRequest, body ?? {}), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
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
