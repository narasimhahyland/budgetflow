import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { BreakGlassAuditInterceptor } from './break-glass-audit.interceptor';

/** Audit writer and chain verification (used by every module, the worker and the seed). */
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

/** Audit HTTP endpoints and the per-request break-glass audit (API only). */
@Module({
  imports: [AuditModule],
  controllers: [AuditController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: BreakGlassAuditInterceptor }],
})
export class AuditApiModule {}
