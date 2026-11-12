import { ApprovalsModule } from '@bf/api/approvals';
import { AuditModule } from '@bf/api/audit';
import { ContributionsModule } from '@bf/api/contributions';
import { DocumentsModule } from '@bf/api/documents';
import { FinanceModule } from '@bf/api/finance';
import { LedgerModule } from '@bf/api/ledger';
import { SpendModule } from '@bf/api/spend';
import { TenancyModule } from '@bf/api/tenancy';
import { BudgetsModule } from '@bf/api/budgets';
import { Module } from '@nestjs/common';
import { EventAttendanceService } from './depth/attendance.service';
import { EventDepthSupport } from './depth/event-depth.support';
import { EventPlanService } from './depth/event-plan.service';
import { EventsDepthController } from './depth/events-depth.controller';
import { EventFeedbackService } from './depth/feedback.service';
import { EventInvitationsService } from './depth/invitations.service';
import { EventQuotesService } from './depth/quotes.service';
import { EventScorecardService } from './depth/scorecard.service';
import { EventTemplatesService } from './depth/templates.service';
import { EventCloseChecks } from './event-close-checks';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { InsightsService } from './insights.service';

/** Phase 9 event depth: templates and series, the plan, people, quotes, feedback and the scorecard. */
const DEPTH_SERVICES = [
  EventDepthSupport,
  EventTemplatesService,
  EventPlanService,
  EventInvitationsService,
  EventAttendanceService,
  EventQuotesService,
  EventFeedbackService,
  EventScorecardService,
];

const SERVICES = [EventsService, InsightsService, EventCloseChecks, ...DEPTH_SERVICES];

/** Events; Phase 6 registers its unmatched-actuals close check on EventCloseChecks. */
@Module({
  imports: [
    AuditModule,
    LedgerModule,
    ApprovalsModule,
    BudgetsModule,
    SpendModule,
    ContributionsModule,
    DocumentsModule,
    TenancyModule,
    FinanceModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class EventsModule {}

/**
 * The depth controller is registered first so that `events/dashboard` and `events/templates` match
 * before the Phase 5 `events/:eventId` route.
 */
@Module({
  imports: [EventsModule],
  controllers: [EventsDepthController, EventsController],
})
export class EventsApiModule {}
