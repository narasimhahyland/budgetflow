import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { S3DocumentStore } from './document-store';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/** DocumentStore and documents; owning modules register who may read and attach (DocumentsService.registerOwner). */
@Module({
  imports: [AuditModule],
  providers: [S3DocumentStore, DocumentsService],
  exports: [S3DocumentStore, DocumentsService],
})
export class DocumentsModule {}

@Module({ imports: [DocumentsModule], controllers: [DocumentsController] })
export class DocumentsApiModule {}
