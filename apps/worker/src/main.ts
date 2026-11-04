import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './app/worker.module';

// Worker: pg-boss jobs, outbox drain and the nightly ledger rebuild check. Listens only for its health check.
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/budgetflow';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const port = Number(process.env.HEALTH_PORT ?? 3100);
  await app.listen(port, '0.0.0.0');
  Logger.log(`BudgetFlow worker running (health on port ${port})`, 'Bootstrap');
}

void bootstrap();
