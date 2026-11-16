import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  CreateFinanceExportRequest,
  FinanceExportDownloadQuery,
  FinanceExportListQuery,
  FinanceExportPreviewQuery,
  MarkFinanceExportPostedRequest,
  type FinanceExportDetail,
  type FinanceExportDownload,
  type FinanceExportList,
  type FinanceExportPreview,
  type FinanceExportSummary,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { FinanceExportsService } from './finance-exports.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const Uuid = z.uuid();

/** Finance and payroll exports (094b, gap B5). Thin: parse, call the service, return the contract. */
@Controller('api/finance/exports')
export class FinanceExportsController {
  constructor(private readonly exports: FinanceExportsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query() query: unknown): Promise<FinanceExportList> {
    return this.exports.list(actor, parseWith(FinanceExportListQuery, query));
  }

  @Get('preview')
  preview(
    @CurrentActor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<FinanceExportPreview> {
    return this.exports.preview(actor, parseWith(FinanceExportPreviewQuery, query));
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<FinanceExportDetail> {
    const r = await this.exports.create(actor, parseWith(CreateFinanceExportRequest, body), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':exportId')
  get(
    @CurrentActor() actor: RequestActor,
    @Param('exportId') raw: string,
  ): Promise<FinanceExportDetail> {
    return this.exports.get(actor, parseWith(Uuid, raw));
  }

  @Post(':exportId/posted')
  @HttpCode(200)
  async markPosted(
    @CurrentActor() actor: RequestActor,
    @Param('exportId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<FinanceExportSummary> {
    const r = await this.exports.markPosted(
      actor,
      parseWith(Uuid, raw),
      parseWith(MarkFinanceExportPostedRequest, body),
      { idempotencyKey, requestId },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':exportId/download')
  download(
    @CurrentActor() actor: RequestActor,
    @Param('exportId') raw: string,
    @RequestId() requestId: string | null,
    @Query() query: unknown,
  ): Promise<FinanceExportDownload> {
    return this.exports.download(
      actor,
      parseWith(Uuid, raw),
      parseWith(FinanceExportDownloadQuery, query).format,
      requestId,
    );
  }
}
