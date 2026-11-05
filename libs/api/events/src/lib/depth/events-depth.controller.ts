import {
  CurrentActor,
  IdempotencyKey,
  parseWith,
  RequestId,
  type RequestActor,
} from '@bf/api/core';
import {
  ApplyAttendanceSplitBody,
  ApplyTemplateToEventBody,
  CloneEventBody,
  CreateQuoteRequestBody,
  ExportCatererNeedsBody,
  MarkAttendanceBody,
  ModerateGalleryPhotoBody,
  ModerateSurveyCommentBody,
  ReasonBody,
  RecordVendorQuoteBody,
  RecurringSeriesBody,
  RemindInvitationsBody,
  RsvpRespondBody,
  SelectVendorQuoteBody,
  SendInvitationsBody,
  SetEventRsvpStateBody,
  SubmitAttendeeNeedsBody,
  SubmitSurveyResponseBody,
  UpdateAgendaItemBody,
  UpdateChecklistTaskBody,
  UpdateEventSurveyBody,
  UpdateScorecardNotesBody,
  UploadGalleryPhotoBody,
  UpsertAgendaItemBody,
  UpsertChecklistTaskBody,
  UpsertEventTemplateBody,
  type EmployeeInvitationView,
  type EventAttendanceView,
  type EventDetail,
  type EventFeedbackView,
  type EventInvitationView,
  type EventNeedsSummaryView,
  type EventPlanView,
  type EventQuotesView,
  type EventScorecardView,
  type EventTemplate,
  type EventTemplateList,
  type EventsDashboardView,
  type ExportCatererNeedsResult,
  type RecurringSeriesResult,
} from '@bf/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { EventAttendanceService } from './attendance.service';
import { EventFeedbackService } from './feedback.service';
import { EventInvitationsService } from './invitations.service';
import { EventPlanService } from './event-plan.service';
import { EventQuotesService } from './quotes.service';
import { EventScorecardService } from './scorecard.service';
import { EventTemplatesService } from './templates.service';

interface ResponseLike {
  setHeader(name: string, value: string): void;
}
interface Result<T> {
  body: T;
  replayed: boolean;
}

const Uuid = z.uuid();

const send = <T>(res: ResponseLike, r: Result<T>): T => {
  if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return r.body;
};

/**
 * Phase 9 event depth (43, 45a, 46b, 47a, 47b, 47e, 51a, 54a, 54b). Registered before the Phase 5
 * events controller so that `events/dashboard` and `events/templates` are not swallowed by
 * `events/:eventId`.
 */
@Controller('api')
export class EventsDepthController {
  constructor(
    private readonly templates: EventTemplatesService,
    private readonly plan: EventPlanService,
    private readonly invitations: EventInvitationsService,
    private readonly attendance: EventAttendanceService,
    private readonly quotes: EventQuotesService,
    private readonly feedback: EventFeedbackService,
    private readonly scorecard: EventScorecardService,
  ) {}

  // 043 dashboard ---------------------------------------------------------------------------------

  @Get('events/dashboard')
  dashboard(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<EventsDashboardView> {
    const query = parseWith(
      z
        .object({ onlyMine: z.enum(['true', 'false']).optional(), locationId: Uuid.optional() })
        .strict(),
      raw,
    );
    return this.scorecard.dashboard(actor, query);
  }

  // 045a templates, series and clone ---------------------------------------------------------------

  @Get('events/templates')
  listTemplates(
    @CurrentActor() actor: RequestActor,
    @Query() raw: unknown,
  ): Promise<EventTemplateList> {
    const query = parseWith(
      z.object({ scope: z.enum(['company', 'personal', 'all']).optional() }).strict(),
      raw,
    );
    return this.templates.list(actor, query.scope ?? 'all');
  }

  @Get('events/templates/:templateId')
  getTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') raw: string,
  ): Promise<EventTemplate> {
    return this.templates.get(actor, parseWith(Uuid, raw));
  }

  @Post('events/templates')
  @HttpCode(201)
  async createTemplate(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventTemplate> {
    return send(
      res,
      await this.templates.create(actor, parseWith(UpsertEventTemplateBody, body), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Put('events/templates/:templateId')
  async updateTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventTemplate> {
    return send(
      res,
      await this.templates.update(
        actor,
        parseWith(Uuid, raw),
        parseWith(UpsertEventTemplateBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/templates/:templateId/archive')
  @HttpCode(200)
  async archiveTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('templateId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventTemplate> {
    const reason = parseWith(ReasonBody, body ?? {}).reason;
    return send(
      res,
      await this.templates.archive(actor, parseWith(Uuid, raw), reason, {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Post('events/series')
  @HttpCode(200)
  async createSeries(
    @CurrentActor() actor: RequestActor,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<RecurringSeriesResult> {
    return send(
      res,
      await this.templates.series(actor, parseWith(RecurringSeriesBody, body), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Post('events/:eventId/clone')
  @HttpCode(201)
  async clone(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventDetail> {
    return send(
      res,
      await this.templates.clone(actor, parseWith(Uuid, raw), parseWith(CloneEventBody, body), {
        idempotencyKey,
        requestId,
      }),
    );
  }

  // 046b plan --------------------------------------------------------------------------------------

  @Get('events/:eventId/plan')
  getPlan(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventPlanView> {
    return this.plan.get(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/plan/apply-template')
  @HttpCode(200)
  async applyTemplate(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventPlanView> {
    const parsed = parseWith(ApplyTemplateToEventBody, body);
    return send(
      res,
      await this.plan.applyTemplate(actor, parseWith(Uuid, raw), parsed.templateId, {
        idempotencyKey,
        requestId,
      }),
    );
  }

  @Post('events/:eventId/plan/tasks')
  @HttpCode(201)
  async createTask(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventPlanView> {
    return send(
      res,
      await this.plan.createTask(
        actor,
        parseWith(Uuid, raw),
        parseWith(UpsertChecklistTaskBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Patch('events/:eventId/plan/tasks/:taskId')
  async updateTask(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('taskId') rawTask: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventPlanView> {
    return send(
      res,
      await this.plan.updateTask(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawTask),
        parseWith(UpdateChecklistTaskBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/plan/agenda')
  @HttpCode(201)
  async createAgendaItem(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventPlanView> {
    return send(
      res,
      await this.plan.createAgendaItem(
        actor,
        parseWith(Uuid, raw),
        parseWith(UpsertAgendaItemBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Patch('events/:eventId/plan/agenda/:itemId')
  async updateAgendaItem(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('itemId') rawItem: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventPlanView> {
    return send(
      res,
      await this.plan.updateAgendaItem(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawItem),
        parseWith(UpdateAgendaItemBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  // 047a invitations and RSVP ----------------------------------------------------------------------

  @Get('events/:eventId/invitations')
  getInvitations(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventInvitationView> {
    return this.invitations.get(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/invitations/send')
  @HttpCode(200)
  async sendInvitations(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventInvitationView> {
    return send(
      res,
      await this.invitations.send(
        actor,
        parseWith(Uuid, raw),
        parseWith(SendInvitationsBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/invitations/remind')
  @HttpCode(200)
  async remindInvitations(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventInvitationView> {
    return send(
      res,
      await this.invitations.remind(
        actor,
        parseWith(Uuid, raw),
        parseWith(RemindInvitationsBody, body ?? {}),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/invitations/status')
  @HttpCode(200)
  async setRsvpState(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventInvitationView> {
    return send(
      res,
      await this.invitations.setRsvpState(
        actor,
        parseWith(Uuid, raw),
        parseWith(SetEventRsvpStateBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Get('invitations/:invitationId')
  getEmployeeInvitation(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId') raw: string,
  ): Promise<EmployeeInvitationView> {
    return this.invitations.getEmployeeInvitation(actor, parseWith(Uuid, raw));
  }

  @Post('invitations/:invitationId/rsvp')
  @HttpCode(200)
  async respond(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EmployeeInvitationView> {
    return send(
      res,
      await this.invitations.respond(
        actor,
        parseWith(Uuid, raw),
        parseWith(RsvpRespondBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('invitations/:invitationId/needs')
  @HttpCode(200)
  async submitNeeds(
    @CurrentActor() actor: RequestActor,
    @Param('invitationId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EmployeeInvitationView> {
    return send(
      res,
      await this.invitations.submitNeeds(
        actor,
        parseWith(Uuid, raw),
        parseWith(SubmitAttendeeNeedsBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  // 047b attendee needs ----------------------------------------------------------------------------

  @Get('events/:eventId/needs')
  getNeeds(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventNeedsSummaryView> {
    return this.invitations.needs(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/needs/export')
  @HttpCode(200)
  async exportNeeds(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<ExportCatererNeedsResult> {
    return send(
      res,
      await this.invitations.exportNeeds(
        actor,
        parseWith(Uuid, raw),
        parseWith(ExportCatererNeedsBody, body ?? {}),
        { idempotencyKey, requestId },
      ),
    );
  }

  // 047e attendance and per-head recalculation -----------------------------------------------------

  @Get('events/:eventId/attendance')
  getAttendance(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventAttendanceView> {
    return this.attendance.get(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/attendance')
  @HttpCode(200)
  async markAttendance(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventAttendanceView> {
    return send(
      res,
      await this.attendance.mark(
        actor,
        parseWith(Uuid, raw),
        parseWith(MarkAttendanceBody, body ?? {}),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/attendance/apply-split')
  @HttpCode(200)
  async applySplit(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventAttendanceView> {
    return send(
      res,
      await this.attendance.apply(
        actor,
        parseWith(Uuid, raw),
        parseWith(ApplyAttendanceSplitBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  // 051a vendor quotes -----------------------------------------------------------------------------

  @Get('events/:eventId/quotes')
  getQuotes(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventQuotesView> {
    return this.quotes.get(actor, parseWith(Uuid, raw));
  }

  @Post('events/:eventId/quotes/requests')
  @HttpCode(201)
  async createQuoteRequest(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventQuotesView> {
    return send(
      res,
      await this.quotes.createRequest(
        actor,
        parseWith(Uuid, raw),
        parseWith(CreateQuoteRequestBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/quotes')
  @HttpCode(201)
  async recordQuote(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventQuotesView> {
    return send(
      res,
      await this.quotes.recordQuote(
        actor,
        parseWith(Uuid, raw),
        parseWith(RecordVendorQuoteBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/quotes/:quoteId/select')
  @HttpCode(200)
  async selectQuote(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('quoteId') rawQuote: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventQuotesView> {
    return send(
      res,
      await this.quotes.select(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawQuote),
        parseWith(SelectVendorQuoteBody, body ?? {}),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/quotes/:quoteId/decline')
  @HttpCode(200)
  async declineQuote(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('quoteId') rawQuote: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventQuotesView> {
    const reason = parseWith(ReasonBody, body ?? {}).reason;
    return send(
      res,
      await this.quotes.decline(actor, parseWith(Uuid, raw), parseWith(Uuid, rawQuote), reason, {
        idempotencyKey,
        requestId,
      }),
    );
  }

  // 054a survey and gallery ------------------------------------------------------------------------

  @Get('events/:eventId/feedback')
  getFeedback(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
  ): Promise<EventFeedbackView> {
    return this.feedback.get(actor, parseWith(Uuid, raw));
  }

  @Put('events/:eventId/feedback/survey')
  async updateSurvey(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventFeedbackView> {
    return send(
      res,
      await this.feedback.updateSurvey(
        actor,
        parseWith(Uuid, raw),
        parseWith(UpdateEventSurveyBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Get('surveys/:surveyId')
  getSurvey(
    @CurrentActor() actor: RequestActor,
    @Param('surveyId') raw: string,
  ): Promise<EventFeedbackView> {
    return this.feedback.getBySurvey(actor, parseWith(Uuid, raw));
  }

  @Post('surveys/:surveyId/responses')
  @HttpCode(201)
  async submitSurveyResponse(
    @CurrentActor() actor: RequestActor,
    @Param('surveyId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventFeedbackView> {
    return send(
      res,
      await this.feedback.submitResponse(
        actor,
        parseWith(Uuid, raw),
        parseWith(SubmitSurveyResponseBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/feedback/comments/:responseId/moderate')
  @HttpCode(200)
  async moderateComment(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('responseId') rawResponse: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventFeedbackView> {
    return send(
      res,
      await this.feedback.moderateComment(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawResponse),
        parseWith(ModerateSurveyCommentBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/feedback/photos')
  @HttpCode(201)
  async uploadPhoto(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventFeedbackView> {
    return send(
      res,
      await this.feedback.uploadPhoto(
        actor,
        parseWith(Uuid, raw),
        parseWith(UploadGalleryPhotoBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  @Post('events/:eventId/feedback/photos/:photoId/moderate')
  @HttpCode(200)
  async moderatePhoto(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Param('photoId') rawPhoto: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventFeedbackView> {
    return send(
      res,
      await this.feedback.moderatePhoto(
        actor,
        parseWith(Uuid, raw),
        parseWith(Uuid, rawPhoto),
        parseWith(ModerateGalleryPhotoBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }

  // 054b ROI scorecard -----------------------------------------------------------------------------

  @Get('events/:eventId/scorecard')
  getScorecard(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @Query() rawQuery: unknown,
  ): Promise<EventScorecardView> {
    const query = parseWith(z.object({ compareEventId: Uuid.optional() }).strict(), rawQuery);
    return this.scorecard.scorecard(actor, parseWith(Uuid, raw), query.compareEventId);
  }

  @Put('events/:eventId/scorecard/notes')
  async updateScorecardNotes(
    @CurrentActor() actor: RequestActor,
    @Param('eventId') raw: string,
    @IdempotencyKey() idempotencyKey: string,
    @RequestId() requestId: string | null,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<EventScorecardView> {
    return send(
      res,
      await this.scorecard.updateNotes(
        actor,
        parseWith(Uuid, raw),
        parseWith(UpdateScorecardNotesBody, body),
        { idempotencyKey, requestId },
      ),
    );
  }
}
