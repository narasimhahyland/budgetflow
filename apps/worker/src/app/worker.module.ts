import { CoreModule } from '@bf/api/core';
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

/** The worker reuses the API's application services (CoreModule, IntegrityModule); no HTTP edge beyond health. */
@Module({
  imports: [CoreModule, IntegrityModule],
  providers: [JobsService],
  controllers: [WorkerHealthController],
})
export class WorkerModule {}
