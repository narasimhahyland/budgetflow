import 'reflect-metadata';
import { clockIsPinned, nowUtc } from '@bf/api/core';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { chatConfig } from '@bf/api/channels';
import { integrationsConfig } from '@bf/api/integrations';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // Refuse to start in production on a public development secret (libs/api/core secrets.ts).
  chatConfig();
  integrationsConfig();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`BudgetFlow API listening on port ${port}`, 'Bootstrap');
  // Resolved here rather than on first use, so a stack running on a frozen clock says so in its own
  // logs whether or not anything has asked it for the date yet (FIXED_NOW, see libs/api/core clock).
  if (clockIsPinned()) {
    Logger.warn(
      `Clock pinned: now is ${nowUtc().toISOString()}. Development and test only.`,
      'Bootstrap',
    );
  }
}

void bootstrap();
