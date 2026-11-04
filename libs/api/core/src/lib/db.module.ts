import { createDb, createPool, type Db } from '@bf/api/db';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { loadConfig, type AppConfig } from './config';

export const CONFIG = Symbol('CONFIG');
export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Config, the Postgres pool (application or worker role) and Drizzle, shared by the API, worker and seed. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: (c: AppConfig) => createPool(c.DATABASE_URL, c.DATABASE_POOL_MAX),
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Db => createDb(pool) },
    PoolCloser,
  ],
  exports: [CONFIG, PG_POOL, DB],
})
export class DbModule {}
