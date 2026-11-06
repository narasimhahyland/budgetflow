import { AuditModule } from '@bf/api/audit';
import { DocumentsModule } from '@bf/api/documents';
import { Module } from '@nestjs/common';
import { AdminController, MeAdminController } from './admin.controller';
import { AdminSettingsService } from './admin-settings.service';
import { ExperienceService } from './experience.service';
import { FeatureFlagsService } from './feature-flags.service';
import { RetentionService } from './retention.service';
import { SystemHealthService } from './system-health.service';
import { UserAdminService } from './user-admin.service';

const SERVICES = [
  AdminSettingsService,
  ExperienceService,
  FeatureFlagsService,
  RetentionService,
  SystemHealthService,
  UserAdminService,
];

/**
 * Administration and experience services. `FeatureFlagsService` is exported so other modules can ask
 * whether a capability is revealed; they still authorize the action through `PolicyService`.
 * `RetentionService` is exported for the worker's nightly run.
 */
@Module({
  imports: [AuditModule, DocumentsModule],
  providers: SERVICES,
  exports: SERVICES,
})
export class AdminModule {}

/** Administration HTTP endpoints. */
@Module({ imports: [AdminModule], controllers: [AdminController, MeAdminController] })
export class AdminApiModule {}
