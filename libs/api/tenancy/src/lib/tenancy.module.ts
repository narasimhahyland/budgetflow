import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuthConfigController } from './auth-config.controller';
import { MeController } from './me.controller';

/** Product analytics capture; other modules import it to record server-side events. */
@Module({ providers: [AnalyticsService], exports: [AnalyticsService] })
export class TenancyModule {}

/** Identity (current user, permissions), sign-in settings and product analytics endpoints. */
@Module({
  imports: [TenancyModule],
  controllers: [MeController, AuthConfigController, AnalyticsController],
})
export class TenancyApiModule {}
