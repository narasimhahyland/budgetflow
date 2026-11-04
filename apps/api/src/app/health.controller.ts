import { DB, JwtVerifier, Public } from '@bf/api/core';
import type { Db } from '@bf/api/db';
import { buildOpenApiDocument } from '@bf/contracts';
import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtVerifier,
  ) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok' as const };
  }

  @Public()
  @Get('ready')
  async ready() {
    const database = await this.db
      .execute(sql`select 1`)
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    const identityProvider = (await this.jwt.ping()) ? ('up' as const) : ('down' as const);
    const body = {
      status:
        database === 'up' && identityProvider === 'up'
          ? ('ready' as const)
          : ('not_ready' as const),
      checks: { database, identityProvider },
    };
    if (body.status !== 'ready') throw new HttpException(body, 503);
    return body;
  }
}

@Controller('api/openapi.json')
export class OpenApiController {
  private readonly doc = buildOpenApiDocument();

  @Public()
  @Get()
  openapi() {
    return this.doc;
  }
}
