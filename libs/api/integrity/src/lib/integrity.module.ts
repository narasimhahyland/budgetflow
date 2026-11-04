import { AuditModule } from '@bf/api/audit';
import { Module } from '@nestjs/common';
import { IntegrityController } from './integrity.controller';
import { IntegrityService } from './integrity.service';
import { RebuildService } from './rebuild.service';

/** Ledger rebuild check (used by the worker) and check-run requests. */
@Module({
  imports: [AuditModule],
  providers: [IntegrityService, RebuildService],
  exports: [IntegrityService, RebuildService],
})
export class IntegrityModule {}

@Module({ imports: [IntegrityModule], controllers: [IntegrityController] })
export class IntegrityApiModule {}
