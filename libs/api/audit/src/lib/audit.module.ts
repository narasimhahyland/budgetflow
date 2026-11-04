import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** Audit writer and chain verification (used by every module, the worker and the seed). */
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

/** Audit HTTP endpoints (API only). */
@Module({ imports: [AuditModule], controllers: [AuditController] })
export class AuditApiModule {}
