import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  CreateDocumentUploadRequest,
  DocumentListQuery,
  type DocumentDownload,
  type DocumentSummary,
  type DocumentUpload,
} from '@bf/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { DocumentsService } from './documents.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const DocumentId = z.uuid();

@Controller('api/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<{ items: DocumentSummary[] }> {
    const q = parseWith(DocumentListQuery, raw);
    return this.documents.list(actor, q.ownerType, q.ownerId);
  }

  @Post('uploads')
  @HttpCode(201)
  async upload(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DocumentUpload> {
    const r = await this.documents.createUpload(
      actor,
      parseWith(CreateDocumentUploadRequest, body),
      {
        idempotencyKey,
        requestId,
      },
    );
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Post(':documentId/complete')
  @HttpCode(200)
  async complete(
    @CurrentActor() actor: RequestActor,
    @Param('documentId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<DocumentSummary> {
    const r = await this.documents.complete(actor, parseWith(DocumentId, raw), {
      idempotencyKey,
      requestId,
    });
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get(':documentId/download')
  download(
    @CurrentActor() actor: RequestActor,
    @Param('documentId') raw: string,
  ): Promise<DocumentDownload> {
    return this.documents.download(actor, parseWith(DocumentId, raw));
  }
}
