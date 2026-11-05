import { ContributionsModule } from '@bf/api/contributions';
import { CoreModule } from '@bf/api/core';
import { EventsModule } from '@bf/api/events';
import { NotificationsModule } from '@bf/api/notifications';
import { SpendModule } from '@bf/api/spend';
import { IntegrityModule } from '@bf/api/integrity';
import { Controller, Get, HttpException, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('health')
class WorkerHealthController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  health() {
    if (!this.jobs.ready) throw new HttpException({ status: 'starting' }, 503);
    return { status: 'ok' };
  }
}

/** The worker reuses the API's application services (integrity, notifications, events and their budget-control consumer); no HTTP edge beyond health. */
@Module({
  imports: [
    CoreModule,
    IntegrityModule,
    NotificationsModule,
    SpendModule,
    ContributionsModule,
    EventsModule,
  ],
  providers: [JobsService],
  controllers: [WorkerHealthController],
})
export class WorkerModule {}
