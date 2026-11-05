import { ApiProblem, type CommandResult, type RequestActor } from '@bf/api/core';
import {
  eventGalleryPhotos,
  eventSurveyResponses,
  eventSurveys,
  events,
  type Tx,
} from '@bf/api/db';
import type {
  EventFeedbackView,
  GalleryPhotoView,
  ModerateGalleryPhotoBody,
  ModerateSurveyCommentBody,
  SubmitSurveyResponseBody,
  UpdateEventSurveyBody,
  UploadGalleryPhotoBody,
} from '@bf/contracts';
import { aggregateSurveyResults } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Ctx, EventRow } from '../events.service';
import { EventDepthSupport, needsOf } from './event-depth.support';
import { EventPlanService } from './event-plan.service';

type SurveyRow = typeof eventSurveys.$inferSelect;
type Question = EventFeedbackView['questions'][number];

const DEFAULT_QUESTIONS: Question[] = [
  { id: 'rating', type: 'rating', prompt: 'How would you rate the event?', required: true },
  {
    id: 'again',
    type: 'yes_no',
    prompt: 'Would you attend a similar event again?',
    required: true,
  },
  {
    id: 'change',
    type: 'short_text',
    prompt: 'What should we change next time?',
    required: false,
  },
];

/** Anonymous responses are keyed by a hash, so a person answers once and is never named. */
const respondentToken = (surveyId: string, personId: string): string =>
  createHash('sha256').update(`${surveyId}:${personId}`, 'utf8').digest('hex').slice(0, 64);

/**
 * The post-event survey and the private photo gallery (54a). Surveys are anonymous and show results
 * only once five people have answered, so small groups cannot be identified. Photos respect the
 * photo preferences people gave with their attendee needs (47b).
 */
@Injectable()
export class EventFeedbackService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly plan: EventPlanService,
  ) {}

  private async survey(tx: Tx, actor: RequestActor, e: EventRow): Promise<SurveyRow> {
    const [row] = await tx.select().from(eventSurveys).where(eq(eventSurveys.eventId, e.id));
    if (row) return row;
    const [created] = await tx
      .insert(eventSurveys)
      .values({ tenantId: actor.tenantId, eventId: e.id, questions: DEFAULT_QUESTIONS })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await tx.select().from(eventSurveys).where(eq(eventSurveys.eventId, e.id));
    return existing;
  }

  private photoView(
    p: typeof eventGalleryPhotos.$inferSelect,
    uploaders: Map<string, string>,
    actor: RequestActor,
  ): GalleryPhotoView {
    return {
      id: p.id,
      caption: p.caption,
      fileName: p.fileName,
      uploadedByName: p.uploadedByPersonId
        ? (uploaders.get(p.uploadedByPersonId) ?? 'Someone')
        : 'Someone',
      mine: Boolean(actor.personId && p.uploadedByPersonId === actor.personId),
      status: p.status as GalleryPhotoView['status'],
      removalReason: p.removalReason,
      createdAt: p.createdAt.toISOString(),
    };
  }

  /** People the survey goes to: those marked Attended, or those going while attendance is not final. */
  private async audience(tx: Tx, e: EventRow) {
    const parts = await this.support.participants(tx, e.id);
    return e.attendanceFinal
      ? parts.filter((p) => ['attended', 'walk_in'].includes(p.attendanceStatus))
      : parts.filter((p) => p.rsvpStatus === 'going');
  }

  async view(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventFeedbackView> {
    const survey = await this.survey(tx, actor, e);
    const canManage = await this.support.canManage(tx, actor, e);
    const audience = await this.audience(tx, e);
    const responses = await tx
      .select()
      .from(eventSurveyResponses)
      .where(eq(eventSurveyResponses.surveyId, survey.id))
      .orderBy(desc(eventSurveyResponses.submittedAt));
    const results = aggregateSurveyResults(
      responses.map((r) => ({
        rating: r.rating,
        wouldAttendAgain: r.wouldAttendAgain,
        locationName: r.locationName,
      })),
      audience.length,
    );
    const photos = await tx
      .select()
      .from(eventGalleryPhotos)
      .where(eq(eventGalleryPhotos.eventId, e.id))
      .orderBy(desc(eventGalleryPhotos.createdAt));
    const uploaders = await this.support.personNames(
      tx,
      photos.map((p) => p.uploadedByPersonId),
    );
    const mineToken = actor.personId !== null ? respondentToken(survey.id, actor.personId) : null;
    const parts = await this.support.participants(tx, e.id);
    return {
      eventId: e.id,
      canManage,
      surveyId: survey.id,
      status: survey.status as EventFeedbackView['status'],
      anonymous: survey.anonymous,
      scheduledFor: survey.scheduledFor?.toISOString() ?? null,
      closesAt: survey.closesAt?.toISOString() ?? null,
      questions: ((survey.questions ?? []) as Question[]).length
        ? (survey.questions as Question[])
        : DEFAULT_QUESTIONS,
      audienceCount: audience.length,
      responseCount: results.responseCount,
      responseRatePct: results.responseRatePct,
      minimumResponsesMet: results.minimumResponsesMet,
      averageRating: results.averageRating,
      wouldAttendAgainPct: results.wouldAttendAgainPct,
      ratingDistribution: results.ratingDistribution,
      byLocation: results.byLocation,
      comments: results.minimumResponsesMet
        ? responses
            .filter((r) => r.comment && (canManage || !r.commentHidden))
            .map((r) => ({
              id: r.id,
              comment: r.commentHidden && !canManage ? '' : (r.comment ?? ''),
              submittedAt: r.submittedAt.toISOString(),
              hidden: r.commentHidden,
              hiddenReason: r.commentHiddenReason,
            }))
        : [],
      photoConsentNoCount: parts.filter((p) => p.needsSubmittedAt && !needsOf(p).photoConsent)
        .length,
      photos: photos
        .filter(
          (p) =>
            canManage ||
            p.status === 'visible' ||
            (actor.personId !== null && p.uploadedByPersonId === actor.personId),
        )
        .map((p) => this.photoView(p, uploaders, actor)),
      mySurveyAnswered:
        mineToken !== null && responses.some((r) => r.respondentTokenHash === mineToken),
    };
  }

  get(actor: RequestActor, eventId: string): Promise<EventFeedbackView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.view(tx, actor, e);
    });
  }

  /** The survey an attendee opens from their invitation or the event page. */
  getBySurvey(actor: RequestActor, surveyId: string): Promise<EventFeedbackView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.eventOfSurvey(tx, actor, surveyId);
      return this.view(tx, actor, e);
    });
  }

  private async eventOfSurvey(tx: Tx, actor: RequestActor, surveyId: string): Promise<EventRow> {
    const [survey] = await tx.select().from(eventSurveys).where(eq(eventSurveys.id, surveyId));
    if (!survey) throw ApiProblem.notFound('survey');
    return this.support.event(tx, actor, survey.eventId);
  }

  updateSurvey(
    actor: RequestActor,
    eventId: string,
    body: UpdateEventSurveyBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventFeedbackView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.survey.update:${eventId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const survey = await this.survey(tx, actor, e);
        if (survey.status === 'closed')
          throw new ApiProblem(409, 'INVALID_TRANSITION', 'A closed survey cannot change.');
        if (body.questions && survey.sentAt)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'The questions are fixed once the survey has gone out.',
          );
        const opening = body.status === 'open' && survey.status !== 'open';
        await tx
          .update(eventSurveys)
          .set({
            ...(body.questions ? { questions: body.questions } : {}),
            ...(body.scheduledFor !== undefined
              ? { scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null }
              : {}),
            ...(body.status ? { status: body.status } : {}),
            ...(opening
              ? {
                  sentAt: survey.sentAt ?? new Date(),
                  closesAt: new Date(Date.now() + 7 * 86_400_000),
                }
              : {}),
            ...(body.status === 'closed' ? { closedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(eventSurveys.id, survey.id));
        if (opening)
          await this.plan.completeSystemTask(tx, e.id, 'survey', {
            id: survey.id,
            label: 'Survey sent to the attendees',
          });
        await this.support.log(tx, actor, e, 'event.survey_updated', ctx, {
          status: { from: survey.status, to: body.status ?? survey.status },
          questions: {
            from: ((survey.questions ?? []) as Question[]).length,
            to: (body.questions ?? (survey.questions as Question[])).length,
          },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  submitResponse(
    actor: RequestActor,
    surveyId: string,
    body: SubmitSurveyResponseBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventFeedbackView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `surveys.respond:${surveyId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const [survey] = await tx.select().from(eventSurveys).where(eq(eventSurveys.id, surveyId));
        if (!survey) throw ApiProblem.notFound('survey');
        const e = await this.support.event(tx, actor, survey.eventId);
        if (survey.status !== 'open')
          throw new ApiProblem(
            409,
            'SURVEY_NOT_OPEN',
            'This survey is not open for answers right now.',
          );
        if (!actor.personId) throw ApiProblem.forbidden('Only people can answer a survey.');
        const audience = await this.audience(tx, e);
        const mine = audience.find((p) => p.personId === actor.personId);
        if (!mine)
          throw ApiProblem.forbidden('This survey goes to the people who attended the event.');
        const token = respondentToken(survey.id, actor.personId);
        const [already] = await tx
          .select({ id: eventSurveyResponses.id })
          .from(eventSurveyResponses)
          .where(
            and(
              eq(eventSurveyResponses.surveyId, survey.id),
              eq(eventSurveyResponses.respondentTokenHash, token),
            ),
          );
        if (already)
          throw new ApiProblem(
            409,
            'SURVEY_ALREADY_ANSWERED',
            'You have already answered this survey.',
          );
        const locations = await this.support.orgUnitNames(tx, [mine.locationOrgUnitId]);
        await tx.insert(eventSurveyResponses).values({
          tenantId: actor.tenantId,
          surveyId: survey.id,
          eventId: e.id,
          respondentTokenHash: token,
          locationOrgUnitId: mine.locationOrgUnitId,
          locationName: mine.locationOrgUnitId
            ? (locations.get(mine.locationOrgUnitId) ?? null)
            : null,
          rating: body.rating,
          wouldAttendAgain: body.wouldAttendAgain,
          comment: body.comment ?? null,
          answers: body.answers ?? {},
        });
        // An anonymous answer is never attributed: the audit entry counts it, nothing more.
        await this.support.log(tx, actor, e, 'event.survey_response_recorded', ctx, {
          surveyId: { from: null, to: survey.id },
          anonymous: { from: null, to: survey.anonymous },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  moderateComment(
    actor: RequestActor,
    eventId: string,
    responseId: string,
    body: ModerateSurveyCommentBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventFeedbackView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.survey.moderate:${responseId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        const [response] = await tx
          .select()
          .from(eventSurveyResponses)
          .where(
            and(eq(eventSurveyResponses.id, responseId), eq(eventSurveyResponses.eventId, e.id)),
          );
        if (!response) throw ApiProblem.notFound('comment');
        if (body.hidden && !body.reason?.trim())
          throw new ApiProblem(422, 'REASON_REQUIRED', 'Give a reason for hiding a comment.', {
            field: 'reason',
          });
        await tx
          .update(eventSurveyResponses)
          .set({
            commentHidden: body.hidden,
            commentHiddenReason: body.hidden ? (body.reason ?? null) : null,
          })
          .where(eq(eventSurveyResponses.id, response.id));
        await this.support.log(
          tx,
          actor,
          e,
          'event.survey_comment_moderated',
          ctx,
          { hidden: { from: response.commentHidden, to: body.hidden } },
          body.reason ?? null,
        );
        return this.view(tx, actor, e);
      },
    );
  }

  uploadPhoto(
    actor: RequestActor,
    eventId: string,
    body: UploadGalleryPhotoBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventFeedbackView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.gallery.upload:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId);
        if (!body.photoPreferencesChecked)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Confirm that you checked these photos against the photo preferences.',
            { field: 'photoPreferencesChecked' },
          );
        const [photo] = await tx
          .insert(eventGalleryPhotos)
          .values({
            tenantId: actor.tenantId,
            eventId: e.id,
            documentId: body.documentId ?? null,
            caption: body.caption,
            fileName: body.fileName,
            uploadedByPersonId: actor.personId,
          })
          .returning();
        await this.support.log(tx, actor, e, 'event.gallery_photo_added', ctx, {
          photoId: { from: null, to: photo.id },
          fileName: { from: null, to: photo.fileName },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  moderatePhoto(
    actor: RequestActor,
    eventId: string,
    photoId: string,
    body: ModerateGalleryPhotoBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventFeedbackView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.gallery.moderate:${photoId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId);
        const [photo] = await tx
          .select()
          .from(eventGalleryPhotos)
          .where(and(eq(eventGalleryPhotos.id, photoId), eq(eventGalleryPhotos.eventId, e.id)));
        if (!photo) throw ApiProblem.notFound('photo');
        const canManage = await this.support.canManage(tx, actor, e);
        // Anyone in the photo may take themselves out at once; hiding and restoring is the organizer's.
        if (body.action !== 'remove_me' && !canManage)
          throw ApiProblem.forbidden('Only the organizers can hide or restore a photo.');
        const status =
          body.action === 'remove_me'
            ? 'removal_requested'
            : body.action === 'hide'
              ? 'hidden'
              : 'visible';
        await tx
          .update(eventGalleryPhotos)
          .set({
            status,
            removalReason: body.action === 'restore' ? null : (body.reason ?? null),
            removalRequestedByPersonId:
              body.action === 'remove_me' ? actor.personId : photo.removalRequestedByPersonId,
            updatedAt: new Date(),
          })
          .where(eq(eventGalleryPhotos.id, photo.id));
        await this.support.log(
          tx,
          actor,
          e,
          'event.gallery_photo_moderated',
          ctx,
          { status: { from: photo.status, to: status } },
          body.reason ?? null,
        );
        return this.view(tx, actor, e);
      },
    );
  }

  /** Survey headline figures per event, for the dashboard and the ROI scorecard. */
  async resultsFor(
    tx: Tx,
    eventIds: readonly string[],
  ): Promise<
    Map<
      string,
      { averageRating: number | null; responseCount: number; wouldAttendAgainPct: number | null }
    >
  > {
    const out = new Map<
      string,
      { averageRating: number | null; responseCount: number; wouldAttendAgainPct: number | null }
    >();
    if (!eventIds.length) return out;
    const rows = await tx
      .select()
      .from(eventSurveyResponses)
      .orderBy(asc(eventSurveyResponses.submittedAt));
    for (const id of eventIds) {
      const mine = rows.filter((r) => r.eventId === id);
      const results = aggregateSurveyResults(
        mine.map((r) => ({
          rating: r.rating,
          wouldAttendAgain: r.wouldAttendAgain,
          locationName: r.locationName,
        })),
        mine.length,
      );
      out.set(id, {
        averageRating: results.averageRating,
        responseCount: results.responseCount,
        wouldAttendAgainPct: results.wouldAttendAgainPct,
      });
    }
    return out;
  }

  /** Events whose survey has results waiting for the organizer (043 attention list). */
  async eventsWithResults(tx: Tx, eventIds: readonly string[]): Promise<Set<string>> {
    if (!eventIds.length) return new Set();
    const rows = await tx
      .select({ eventId: events.id })
      .from(events)
      .innerJoin(eventSurveys, eq(eventSurveys.eventId, events.id))
      .where(eq(eventSurveys.status, 'open'));
    return new Set(rows.map((r) => r.eventId).filter((id) => eventIds.includes(id)));
  }
}
