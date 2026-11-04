import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ActorResolver } from './actor';
import type { AppConfig } from './config';
import { CONFIG } from './db.module';
import { header, IS_PUBLIC, type ApiRequest } from './http';
import { ApiProblem } from './problem';

/** Verifies Keycloak access tokens against the realm JWKS: signature, issuer, audience, expiry. */
@Injectable()
export class JwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }

  async verify(
    token: string,
  ): Promise<JWTPayload & { sub: string; name?: string; preferred_username?: string }> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.KEYCLOAK_ISSUER,
        audience: this.config.KEYCLOAK_AUDIENCE,
        algorithms: ['RS256'],
      });
      if (!payload.sub) throw new Error('token has no subject');
      return payload as JWTPayload & { sub: string };
    } catch {
      throw new ApiProblem(401, 'UNAUTHENTICATED', 'Your session is not valid. Sign in again.');
    }
  }

  /** Readiness: the identity provider's signing keys are reachable. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.config.jwksUrl, { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

const REQUEST_ID = /^[\w.:-]{1,100}$/;

/** Global guard: request id, then bearer token, tenant membership and actor for every non-public route. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtVerifier,
    private readonly actors: ActorResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const incoming = header(req, 'x-request-id');
    req.requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]))
      return true;
    const auth = header(req, 'authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    if (!token) throw new ApiProblem(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const claims = await this.jwt.verify(token);
    req.actor = await this.actors.resolve(
      claims.sub,
      header(req, 'x-tenant-id')?.trim() || undefined,
      claims.name ?? claims.preferred_username,
    );
    return true;
  }
}
