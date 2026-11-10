import { DB, type ApiRequest } from '@bf/api/core';
import { withTenant, type Db } from '@bf/api/db';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { concatMap, type Observable } from 'rxjs';
import { AuditService } from './audit.service';

/** The audit action written for every request a platform operator makes under a break-glass grant. */
export const BREAK_GLASS_READ_ACTION = 'break_glass.read_under_grant';

/**
 * Every request a platform operator makes under an active break-glass grant is audited against that
 * grant before the response leaves (112: "every read is audited with it"). The entry carries the
 * method and path only, never the query string or the response body. If the audit write fails, the
 * request fails: nothing is read under a grant without a record of it. Rejected requests write
 * nothing, like every other audit event.
 */
@Injectable()
export class BreakGlassAuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<ApiRequest & { method?: string }>();
    const actor = req.actor;
    const grantId = actor?.breakGlassGrantId;
    if (!actor || !grantId) return next.handle();
    const path = (req.url ?? '').split('?')[0].slice(0, 300);
    return next.handle().pipe(
      concatMap(async (body) => {
        await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
          this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: BREAK_GLASS_READ_ACTION,
            resourceType: 'break_glass_grant',
            resourceId: grantId,
            requestId: req.requestId ?? null,
            reason: null,
            changes: { method: req.method ?? 'GET', path },
          }),
        );
        return body;
      }),
    );
  }
}
