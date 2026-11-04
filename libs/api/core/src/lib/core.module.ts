import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ActorResolver } from './actor';
import { AuthGuard, JwtVerifier } from './auth';
import { CommandRunner } from './command';
import { DbModule } from './db.module';
import { PolicyService } from './policy.service';
import { ProblemFilter } from './problem.filter';

/** Policy and command infrastructure shared by API modules, the worker and the seed. */
@Global()
@Module({
  imports: [DbModule],
  providers: [PolicyService, CommandRunner, ActorResolver],
  exports: [PolicyService, CommandRunner, ActorResolver],
})
export class CoreModule {}

/** HTTP edge: Keycloak JWT guard on every route (unless @Public) and problem-details rendering. API only. */
@Module({
  providers: [
    JwtVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
  exports: [JwtVerifier],
})
export class HttpEdgeModule {}
