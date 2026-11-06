import { AuditService } from '@bf/api/audit';
import { BudgetViews, budgetResource } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  commitments,
  eventParticipants,
  eventSurveyResponses,
  events,
  organizerThankNotes,
  orgUnits,
  people,
  recognitionAllowances,
  recognitionAwardTypes,
  recognitionAwards,
  reportingLines,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { PostingSupport, type LockedBudget, type PostCtx } from '@bf/api/spend';
import type {
  GiveRecognitionRequest,
  UpsertRecognitionAwardTypeRequest,
  GrantRecognitionAllowanceRequest,
  OrganizerRecognition,
  OrganizerThankNote,
  RecognitionAllowance,
  RecognitionAward,
  RecognitionAwardStatus,
  RecognitionAwardType,
  RecognitionDecisionRequest,
  RecognitionFeed,
  RedeemRecognitionRequest,
  SayThanksRequest,
} from '@bf/contracts';
import { acceptsNewActivity, postCommitmentMovement, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  MIN_SURVEY_RESPONSES,
  iso,
  nameOfPeople,
  suppressible,
  type CommandContext,
} from './support';

type AwardTypeRow = typeof recognitionAwardTypes.$inferSelect;
type AwardRow = typeof recognitionAwards.$inferSelect;
type AllowanceRow = typeof recognitionAllowances.$inferSelect;

/** Awards whose money is still spoken for against a manager's allowance. */
const ALLOWANCE_CONSUMING: readonly string[] = ['pending_approval', 'awarded', 'redeemed'];

/** Attendance that counts as taking part, shared with 015c and 122a. */
const ATTENDED = ['attended', 'walk_in'] as const;

/**
 * Recognition awards (120a) and organizer recognition (122b).
 *
 * Recognition is split in two deliberately. A thank-you note — in the feed or on an organizer's
 * profile — carries no amount and touches no budget. A monetary award is spend: it creates a
 * commitment on the location's Recognition budget and posts pre-encumbered, encumbered and actual
 * like any other spend, so recognition money can be seen, controlled and reconciled.
 *
 * The manager allowance is a cap, not a pot: it records what a manager may give this quarter, and
 * each award is still committed on the budget in its own right. That way an allowance can never
 * become money sitting outside the ledger, and freezing the Recognition budget stops monetary awards
 * while leaving thank-you notes working.
 */
@Injectable()
export class RecognitionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly posting: PostingSupport,
  ) {}

  // Feed and settings --------------------------------------------------------------------

  feed(actor: RequestActor, query: { scope?: 'all' | 'mine' }): Promise<RecognitionFeed> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(
        actor,
        'tenant.read',
        { kind: 'tenant', tenantId: actor.tenantId },
        'recognition',
      );
      const rows = await tx
        .select()
        .from(recognitionAwards)
        .where(eq(recognitionAwards.tenantId, actor.tenantId))
        .orderBy(desc(recognitionAwards.createdAt), asc(recognitionAwards.id));
      // Recognition is private by default: a private award is visible to the people in it and the
      // recipient's manager, never to the whole company.
      const managerOf = await this.managedPeople(tx, actor);
      const visible = rows.filter(
        (r) =>
          r.visibility === 'public' ||
          r.giverPersonId === actor.personId ||
          r.recipientPersonId === actor.personId ||
          managerOf.has(r.recipientPersonId),
      );
      const mine =
        query.scope === 'mine'
          ? visible.filter(
              (r) => r.giverPersonId === actor.personId || r.recipientPersonId === actor.personId,
            )
          : visible;
      return {
        items: await this.awardViews(tx, mine),
        allowances: await this.allowanceViews(
          tx,
          await tx
            .select()
            .from(recognitionAllowances)
            .where(
              and(
                eq(recognitionAllowances.tenantId, actor.tenantId),
                actor.personId
                  ? eq(recognitionAllowances.managerPersonId, actor.personId)
                  : undefined,
              ),
            )
            .orderBy(asc(recognitionAllowances.periodKey), asc(recognitionAllowances.id)),
        ),
        awardTypes: await this.awardTypeViews(tx, await this.typeRows(tx, actor.tenantId)),
      };
    });
  }

  upsertAwardType(
    actor: RequestActor,
    req: UpsertRecognitionAwardTypeRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `recognition.awardType:${req.kind}:${req.name}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const budget = req.fundingBudgetId ? await this.views.row(tx, req.fundingBudgetId) : null;
        // An award type that pays money is a money decision: its author has to be able to allocate
        // from the Recognition budget behind it. A wordless type moves nothing, so it is ordinary
        // administration.
        if (budget) this.policy.assert(actor, 'budget.allocate', budgetResource(budget), 'budget');
        else
          this.policy.assert(
            actor,
            'tenant.settings.manage',
            { kind: 'tenant', tenantId: actor.tenantId },
            'award type',
          );
        if (req.kind !== 'thank_you' && (!req.amountMinor || !budget))
          throw new ApiProblem(
            422,
            'RECOGNITION_TYPE_INACTIVE',
            'A monetary award type needs both an amount and a Recognition budget to pay for it.',
            { field: 'fundingBudgetId' },
          );
        const existing = (await this.typeRows(tx, actor.tenantId)).find(
          (t) =>
            t.kind === req.kind &&
            t.name === req.name &&
            t.locationOrgUnitId === (req.locationOrgUnitId ?? null),
        );
        const values = {
          tenantId: actor.tenantId,
          kind: req.kind,
          name: req.name,
          locationOrgUnitId: req.locationOrgUnitId ?? null,
          amountMinor: req.kind === 'thank_you' ? null : (req.amountMinor ?? null),
          currency: budget?.currency ?? null,
          needsApproval: req.needsApproval ?? false,
          fundingBudgetId: budget?.id ?? null,
          active: req.active ?? true,
          updatedAt: new Date(),
        };
        const [row] = existing
          ? await tx
              .update(recognitionAwardTypes)
              .set(values)
              .where(eq(recognitionAwardTypes.id, existing.id))
              .returning()
          : await tx.insert(recognitionAwardTypes).values(values).returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: existing ? 'recognition_award_type.updated' : 'recognition_award_type.created',
          resourceType: 'recognition_award_type',
          resourceId: row.id,
          legalEntityId: budget?.legalEntityId ?? null,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            amountMinor: {
              from: existing?.amountMinor === undefined ? null : Number(existing.amountMinor),
              to: values.amountMinor,
            },
            fundingBudgetId: {
              from: existing?.fundingBudgetId ?? null,
              to: values.fundingBudgetId,
            },
            needsApproval: { from: existing?.needsApproval ?? null, to: values.needsApproval },
            active: { from: existing?.active ?? null, to: values.active },
          },
        });
        return (await this.awardTypeViews(tx, [row]))[0];
      },
    );
  }

  grantAllowance(actor: RequestActor, req: GrantRecognitionAllowanceRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `recognition.grantAllowance:${req.managerPersonId}:${req.periodKey}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const budget = await this.views.row(tx, req.fundingBudgetId);
        // The Recognition budget owner decides how much a manager may give from it, which is the
        // same authority as allocating from that budget.
        this.policy.assert(actor, 'budget.allocate', budgetResource(budget), 'budget');
        if (req.managerPersonId === actor.personId)
          throw new ApiProblem(
            422,
            'SELF_APPROVAL',
            'Grant a recognition allowance to someone else, not to yourself.',
          );
        const values = {
          tenantId: actor.tenantId,
          managerPersonId: req.managerPersonId,
          fundingBudgetId: budget.id,
          periodKey: req.periodKey,
          grantedMinor: req.amountMinor,
          currency: budget.currency,
          grantedByPersonId: actor.personId,
          reason: req.reason,
          updatedAt: new Date(),
        };
        const [row] = await tx
          .insert(recognitionAllowances)
          .values(values)
          .onConflictDoUpdate({
            target: [
              recognitionAllowances.tenantId,
              recognitionAllowances.managerPersonId,
              recognitionAllowances.fundingBudgetId,
              recognitionAllowances.periodKey,
            ],
            set: { grantedMinor: req.amountMinor, reason: req.reason, updatedAt: new Date() },
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'recognition_allowance.granted',
          resourceType: 'recognition_allowance',
          resourceId: row.id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            managerPersonId: { from: null, to: req.managerPersonId },
            grantedMinor: { from: null, to: req.amountMinor },
            periodKey: { from: null, to: req.periodKey },
          },
        });
        return (await this.allowanceViews(tx, [row]))[0];
      },
    );
  }

  // Awards -------------------------------------------------------------------------------

  give(actor: RequestActor, req: GiveRecognitionRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'recognition.give',
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden('Only a person gives recognition.');
        this.policy.assert(
          actor,
          'tenant.read',
          { kind: 'tenant', tenantId: actor.tenantId },
          'recognition',
        );
        if (req.recipientPersonId === actor.personId)
          throw new ApiProblem(
            422,
            'RECOGNITION_SELF_AWARD',
            'Recognition goes to someone else; you cannot recognise yourself.',
          );
        await this.assertPerson(tx, actor.tenantId, req.recipientPersonId);
        const type = (await this.typeRows(tx, actor.tenantId)).find(
          (t) => t.id === req.awardTypeId,
        );
        if (!type) throw ApiProblem.notFound('award type');
        if (!type.active)
          throw new ApiProblem(
            409,
            'RECOGNITION_TYPE_INACTIVE',
            `${type.name} is not offered at the moment.`,
          );
        const amountMinor = type.amountMinor === null ? null : Number(type.amountMinor);
        const status: RecognitionAwardStatus = type.needsApproval ? 'pending_approval' : 'awarded';
        // A thank-you note moves no money, so it needs no budget, no allowance and no approval.
        if (amountMinor === null || type.kind === 'thank_you') {
          const [row] = await tx
            .insert(recognitionAwards)
            .values({
              tenantId: actor.tenantId,
              awardTypeId: type.id,
              kind: type.kind,
              giverPersonId: actor.personId,
              recipientPersonId: req.recipientPersonId,
              message: req.message,
              valueTag: req.valueTag ?? null,
              visibility: req.visibility ?? 'private',
              status: 'awarded',
            })
            .returning();
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'recognition_award.given',
            resourceType: 'recognition_award',
            resourceId: row.id,
            requestId: ctx.requestId,
            reason: `${type.name} given`,
            changes: {
              kind: { from: null, to: type.kind },
              amountMinor: { from: null, to: null },
              status: { from: null, to: 'awarded' },
            },
          });
          return (await this.awardViews(tx, [row]))[0];
        }
        if (!type.fundingBudgetId)
          throw new ApiProblem(
            422,
            'RECOGNITION_TYPE_INACTIVE',
            `${type.name} has no Recognition budget to pay for it.`,
          );
        const locked = await this.posting.lock(tx, [type.fundingBudgetId]);
        const funding = locked.get(type.fundingBudgetId)!;
        // Freezing the Recognition budget stops monetary awards with its own typed reason; the
        // thank-you path above keeps working.
        const accepts = acceptsNewActivity(funding.row.status);
        if (!accepts.ok) throw new ApiProblem(409, accepts.error.code, accepts.error.message);
        // Only a manager's own allowance limits what they may give without a second person.
        if (!type.needsApproval) {
          const remaining = await this.remainingAllowance(
            tx,
            actor.tenantId,
            actor.personId,
            funding.row.id,
          );
          if (remaining !== null && amountMinor > remaining)
            throw new ApiProblem(
              422,
              'RECOGNITION_ALLOWANCE_EXCEEDED',
              `This is ${((amountMinor - remaining) / 100).toFixed(2)} ${funding.row.currency} above your remaining allowance. Ask the budget owner for a top-up.`,
              { remainingMinor: remaining },
            );
          if (remaining === null)
            throw new ApiProblem(
              422,
              'RECOGNITION_ALLOWANCE_EXCEEDED',
              'You have no recognition allowance for this budget this quarter.',
            );
        }
        const [commitment] = await tx
          .insert(commitments)
          .values({
            tenantId: actor.tenantId,
            budgetId: funding.row.id,
            status: 'pre_encumbered',
            legalEntityId: funding.row.legalEntityId,
            costCenterId: funding.row.costCenterId,
            description: `${type.name} recognition award`,
            amountMinor,
            currency: funding.row.currency,
            createdByPersonId: actor.personId,
          })
          .returning();
        const journalIds = await this.move(
          tx,
          actor,
          funding,
          commitment.id,
          amountMinor,
          'pre_encumber',
          ctx,
        );
        if (status === 'awarded') {
          journalIds.push(
            ...(await this.move(tx, actor, funding, commitment.id, amountMinor, 'encumber', ctx)),
          );
          await tx
            .update(commitments)
            .set({ status: 'encumbered', updatedAt: new Date() })
            .where(eq(commitments.id, commitment.id));
        }
        const [row] = await tx
          .insert(recognitionAwards)
          .values({
            tenantId: actor.tenantId,
            awardTypeId: type.id,
            kind: type.kind,
            giverPersonId: actor.personId,
            recipientPersonId: req.recipientPersonId,
            message: req.message,
            valueTag: req.valueTag ?? null,
            visibility: req.visibility ?? 'private',
            amountMinor,
            currency: funding.row.currency,
            fundingBudgetId: funding.row.id,
            commitmentId: commitment.id,
            legalEntityId: funding.row.legalEntityId,
            status,
            journalIds,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'recognition_award.given',
          resourceType: 'recognition_award',
          resourceId: row.id,
          legalEntityId: funding.row.legalEntityId,
          requestId: ctx.requestId,
          reason: `${type.name} given from ${funding.row.name}`,
          changes: {
            kind: { from: null, to: type.kind },
            amountMinor: { from: null, to: amountMinor },
            status: { from: null, to: status },
            commitmentId: { from: null, to: commitment.id },
            journalIds: { from: null, to: journalIds },
          },
        });
        return (await this.awardViews(tx, [row]))[0];
      },
    );
  }

  decide(actor: RequestActor, id: string, req: RecognitionDecisionRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `recognition.decide:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.awardRow(tx, actor.tenantId, id);
        if (row.status !== 'pending_approval')
          throw new ApiProblem(
            409,
            'RECOGNITION_AWARD_NOT_OPEN',
            `This award is ${row.status}; only one waiting for approval can be decided.`,
          );
        // The giver's manager approves a peer award. Nobody approves an award to themselves, and
        // nobody approves their own award.
        if (row.giverPersonId === actor.personId)
          throw new ApiProblem(422, 'SELF_APPROVAL', 'You cannot approve an award you gave.');
        if (row.recipientPersonId === actor.personId)
          throw new ApiProblem(
            422,
            'APPROVER_IS_BENEFICIARY',
            'You cannot approve an award to yourself.',
          );
        const managed = await this.managedPeople(tx, actor);
        const budget = row.fundingBudgetId ? await this.views.row(tx, row.fundingBudgetId) : null;
        const finance =
          budget !== null &&
          this.policy.can(actor, 'budget.allocate', budgetResource(budget)).allowed;
        if (!managed.has(row.giverPersonId) && !finance)
          throw ApiProblem.forbidden(
            'A peer award is approved by the giver\u2019s manager or by the Recognition budget owner.',
          );
        const amountMinor = Number(row.amountMinor ?? 0);
        const journalIds: string[] = [];
        if (budget && amountMinor > 0 && row.commitmentId) {
          const locked = await this.posting.lock(tx, [budget.id]);
          const funding = locked.get(budget.id)!;
          journalIds.push(
            ...(await this.move(
              tx,
              actor,
              funding,
              row.commitmentId,
              amountMinor,
              req.decision === 'approve' ? 'encumber' : 'release_pre_encumbrance',
              ctx,
            )),
          );
          await tx
            .update(commitments)
            .set({
              status: req.decision === 'approve' ? 'encumbered' : 'released',
              releasedMinor: req.decision === 'approve' ? 0 : amountMinor,
              updatedAt: new Date(),
            })
            .where(eq(commitments.id, row.commitmentId));
        }
        await tx
          .update(recognitionAwards)
          .set({
            status: req.decision === 'approve' ? 'awarded' : 'cancelled',
            approverPersonId: actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
            journalIds: [...row.journalIds, ...journalIds],
            updatedAt: new Date(),
          })
          .where(eq(recognitionAwards.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action:
            req.decision === 'approve'
              ? 'recognition_award.approved'
              : 'recognition_award.cancelled',
          resourceType: 'recognition_award',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: {
              from: row.status,
              to: req.decision === 'approve' ? 'awarded' : 'cancelled',
            },
            journalIds: { from: row.journalIds, to: journalIds },
          },
        });
        return (await this.awardViews(tx, [await this.awardRow(tx, actor.tenantId, id)]))[0];
      },
    );
  }

  redeem(actor: RequestActor, id: string, req: RedeemRecognitionRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `recognition.redeem:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.awardRow(tx, actor.tenantId, id);
        if (row.recipientPersonId !== actor.personId)
          throw ApiProblem.forbidden('Only the recipient chooses their reward.');
        if (row.status !== 'awarded')
          throw new ApiProblem(
            409,
            'RECOGNITION_AWARD_NOT_OPEN',
            `This award is ${row.status}; only an awarded recognition can be redeemed.`,
          );
        const amountMinor = Number(row.amountMinor ?? 0);
        const journalIds: string[] = [];
        if (row.fundingBudgetId && row.commitmentId && amountMinor > 0) {
          const locked = await this.posting.lock(tx, [row.fundingBudgetId]);
          const funding = locked.get(row.fundingBudgetId)!;
          // Redemption is the actual: payroll or an approved partner is paid, never cash.
          journalIds.push(
            ...(await this.move(tx, actor, funding, row.commitmentId, amountMinor, 'consume', ctx)),
          );
          await tx
            .update(commitments)
            .set({ status: 'consumed', consumedMinor: amountMinor, updatedAt: new Date() })
            .where(eq(commitments.id, row.commitmentId));
        }
        await tx
          .update(recognitionAwards)
          .set({
            status: 'redeemed',
            rewardChoice: req.rewardChoice,
            redeemedAt: new Date(),
            journalIds: [...row.journalIds, ...journalIds],
            updatedAt: new Date(),
          })
          .where(eq(recognitionAwards.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'recognition_award.redeemed',
          resourceType: 'recognition_award',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: `Reward taken as ${req.rewardChoice === 'payroll' ? 'payroll (taxable)' : 'a partner gift'}`,
          changes: {
            status: { from: row.status, to: 'redeemed' },
            rewardChoice: { from: null, to: req.rewardChoice },
            journalIds: { from: row.journalIds, to: journalIds },
          },
        });
        return (await this.awardViews(tx, [await this.awardRow(tx, actor.tenantId, id)]))[0];
      },
    );
  }

  // Organizer recognition (122b) -----------------------------------------------------------

  sayThanks(actor: RequestActor, req: SayThanksRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'recognition.sayThanks',
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden('Only a person can say thanks.');
        this.policy.assert(
          actor,
          'tenant.read',
          { kind: 'tenant', tenantId: actor.tenantId },
          'organizer',
        );
        const organizers = [...new Set(req.organizerPersonIds)].sort();
        if (organizers.includes(actor.personId))
          throw new ApiProblem(
            422,
            'RECOGNITION_SELF_AWARD',
            'Thank the organizers, not yourself.',
          );
        for (const organizerPersonId of organizers) {
          await this.assertPerson(tx, actor.tenantId, organizerPersonId);
          await tx.insert(organizerThankNotes).values({
            tenantId: actor.tenantId,
            organizerPersonId,
            authorPersonId: actor.personId,
            eventId: req.eventId ?? null,
            note: req.note,
            visibility: req.showOnProfile === false ? 'private' : 'public',
          });
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'organizer_thanks.sent',
          resourceType: 'organizer_thanks',
          resourceId: organizers[0],
          requestId: ctx.requestId,
          reason: 'Thank-you note left for the organizers',
          changes: {
            organizers: { from: null, to: organizers.length },
            eventId: { from: null, to: req.eventId ?? null },
            amountMinor: { from: null, to: null },
          },
        });
        return this.organizerInTx(tx, actor, organizers[0]);
      },
    );
  }

  organizer(actor: RequestActor, personId: string): Promise<OrganizerRecognition> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.organizerInTx(tx, actor, personId),
    );
  }

  // Internals --------------------------------------------------------------------------

  private async organizerInTx(
    tx: Tx,
    actor: RequestActor,
    personId: string,
  ): Promise<OrganizerRecognition> {
    this.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'organizer',
    );
    const person = await this.assertPerson(tx, actor.tenantId, personId);
    const organised = await tx
      .select({ id: events.id, name: events.name })
      .from(events)
      .where(and(eq(events.tenantId, actor.tenantId), eq(events.organizerPersonId, personId)))
      .orderBy(asc(events.name), asc(events.id));
    const eventIds = organised.map((e) => e.id);
    const reached = eventIds.length
      ? await tx
          .selectDistinct({ personId: eventParticipants.personId })
          .from(eventParticipants)
          .where(
            and(
              inArray(eventParticipants.eventId, eventIds),
              inArray(eventParticipants.attendanceStatus, [...ATTENDED]),
            ),
          )
      : [];
    // Feedback counts only events with enough responses to keep a respondent unidentifiable.
    const ratings = eventIds.length
      ? await tx
          .select({ eventId: eventSurveyResponses.eventId, rating: eventSurveyResponses.rating })
          .from(eventSurveyResponses)
          .where(inArray(eventSurveyResponses.eventId, eventIds))
      : [];
    const perEvent = new Map<string, number[]>();
    for (const r of ratings)
      perEvent.set(r.eventId, [...(perEvent.get(r.eventId) ?? []), r.rating]);
    const counted = [...perEvent.values()].filter((rs) => rs.length >= MIN_SURVEY_RESPONSES);
    const allRatings = counted.flat();
    const notes = await tx
      .select()
      .from(organizerThankNotes)
      .where(
        and(
          eq(organizerThankNotes.tenantId, actor.tenantId),
          eq(organizerThankNotes.organizerPersonId, personId),
        ),
      )
      .orderBy(desc(organizerThankNotes.createdAt), asc(organizerThankNotes.id));
    const own = personId === actor.personId;
    const visibleNotes = notes.filter((n) => own || (n.visibility === 'public' && !n.hidden));
    const names = await nameOfPeople(
      tx,
      visibleNotes.map((n) => n.authorPersonId),
    );
    const eventNames = new Map(organised.map((e) => [e.id, e.name]));
    return {
      personId,
      personName: person.displayName,
      visibleToColleagues: true,
      eventsOrganised: organised.length,
      colleaguesReached: reached.filter((r) => r.personId).length,
      averagePulse: suppressible(
        allRatings.length
          ? Math.round((allRatings.reduce((s, r) => s + r, 0) / allRatings.length) * 1000)
          : null,
        allRatings.length,
        MIN_SURVEY_RESPONSES,
        'responses',
      ),
      notes: visibleNotes.slice(0, 5).map<OrganizerThankNote>((n) => ({
        id: n.id,
        organizerPersonId: n.organizerPersonId,
        organizerName: person.displayName,
        authorName: names.get(n.authorPersonId) ?? '',
        eventId: n.eventId,
        eventName: n.eventId ? (eventNames.get(n.eventId) ?? null) : null,
        note: n.note,
        visibility: n.visibility as 'public' | 'private',
        hidden: n.hidden,
        createdAt: iso(n.createdAt),
      })),
      thankNoteCount: visibleNotes.length,
    };
  }

  private move(
    tx: Tx,
    actor: RequestActor,
    funding: LockedBudget,
    commitmentId: string,
    amountMinor: number,
    kind: 'pre_encumber' | 'encumber' | 'release_pre_encumbrance' | 'consume',
    ctx: CommandContext,
  ): Promise<string[]> {
    const post: PostCtx = {
      actor,
      command: `recognition.${kind}`,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    };
    return this.posting.context(tx, funding.row, actor.reportingCurrency).then((context) =>
      this.posting.post(
        tx,
        [
          unwrap(
            postCommitmentMovement(
              {
                kind,
                budget: funding,
                amount: { amountMinor, currency: funding.currency },
                provenance: { commitmentId },
              },
              context,
            ),
          ),
        ],
        funding.row.fiscalYearId,
        post,
      ),
    );
  }

  /** What is left of a manager's allowance on a budget this quarter, or null when none is granted. */
  private async remainingAllowance(
    tx: Tx,
    tenantId: string,
    managerPersonId: string,
    fundingBudgetId: string,
  ): Promise<number | null> {
    const rows = await tx
      .select()
      .from(recognitionAllowances)
      .where(
        and(
          eq(recognitionAllowances.tenantId, tenantId),
          eq(recognitionAllowances.managerPersonId, managerPersonId),
          eq(recognitionAllowances.fundingBudgetId, fundingBudgetId),
        ),
      )
      .orderBy(desc(recognitionAllowances.periodKey));
    const current = rows[0];
    if (!current) return null;
    return Number(current.grantedMinor) - (await this.allowanceUsed(tx, current));
  }

  private async allowanceUsed(tx: Tx, allowance: AllowanceRow): Promise<number> {
    const rows = await tx
      .select({ amountMinor: recognitionAwards.amountMinor, status: recognitionAwards.status })
      .from(recognitionAwards)
      .where(
        and(
          eq(recognitionAwards.tenantId, allowance.tenantId),
          eq(recognitionAwards.giverPersonId, allowance.managerPersonId),
          eq(recognitionAwards.fundingBudgetId, allowance.fundingBudgetId),
        ),
      );
    return rows
      .filter((r) => ALLOWANCE_CONSUMING.includes(r.status))
      .reduce((s, r) => s + Number(r.amountMinor ?? 0), 0);
  }

  /** People who report to the actor today, for peer-award approval and private feed visibility. */
  private async managedPeople(tx: Tx, actor: RequestActor): Promise<Set<string>> {
    if (!actor.personId) return new Set();
    const rows = await tx
      .select({ personId: reportingLines.personId })
      .from(reportingLines)
      .where(
        and(
          eq(reportingLines.tenantId, actor.tenantId),
          eq(reportingLines.managerPersonId, actor.personId),
        ),
      );
    return new Set(rows.map((r) => r.personId));
  }

  private async assertPerson(
    tx: Tx,
    tenantId: string,
    personId: string,
  ): Promise<{ displayName: string; locationOrgUnitId: string | null }> {
    const [row] = await tx
      .select({
        displayName: people.displayName,
        locationOrgUnitId: people.locationOrgUnitId,
      })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId)));
    if (!row) throw ApiProblem.notFound('person');
    return row;
  }

  private typeRows(tx: Tx, tenantId: string): Promise<AwardTypeRow[]> {
    return tx
      .select()
      .from(recognitionAwardTypes)
      .where(eq(recognitionAwardTypes.tenantId, tenantId))
      .orderBy(asc(recognitionAwardTypes.name), asc(recognitionAwardTypes.id));
  }

  private async awardTypeViews(
    tx: Tx,
    rows: readonly AwardTypeRow[],
  ): Promise<RecognitionAwardType[]> {
    if (rows.length === 0) return [];
    const budgetIds = rows.map((r) => r.fundingBudgetId).filter((v): v is string => Boolean(v));
    const budgetRows = budgetIds.length
      ? await tx
          .select({ id: budgets.id, name: budgets.name, status: budgets.status })
          .from(budgets)
          .where(inArray(budgets.id, budgetIds))
      : [];
    const unitIds = rows.map((r) => r.locationOrgUnitId).filter((v): v is string => Boolean(v));
    const units = unitIds.length
      ? await tx
          .select({ id: orgUnits.id, name: orgUnits.name })
          .from(orgUnits)
          .where(inArray(orgUnits.id, unitIds))
      : [];
    return rows.map((r) => {
      const budget = budgetRows.find((b) => b.id === r.fundingBudgetId);
      return {
        id: r.id,
        kind: r.kind as RecognitionAwardType['kind'],
        name: r.name,
        locationOrgUnitId: r.locationOrgUnitId,
        locationName: units.find((u) => u.id === r.locationOrgUnitId)?.name ?? null,
        amount:
          r.amountMinor === null
            ? null
            : {
                amountMinor: Number(r.amountMinor),
                currency: (r.currency ?? 'USD') as CurrencyCode,
              },
        needsApproval: r.needsApproval,
        fundingBudgetId: r.fundingBudgetId,
        fundingBudgetName: budget?.name ?? null,
        fundingFrozen: budget ? !acceptsNewActivity(budget.status).ok : false,
        active: r.active,
      };
    });
  }

  private async allowanceViews(
    tx: Tx,
    rows: readonly AllowanceRow[],
  ): Promise<RecognitionAllowance[]> {
    if (rows.length === 0) return [];
    const names = await nameOfPeople(
      tx,
      rows.map((r) => r.managerPersonId),
    );
    const budgetRows = await tx
      .select({ id: budgets.id, name: budgets.name })
      .from(budgets)
      .where(
        inArray(
          budgets.id,
          rows.map((r) => r.fundingBudgetId),
        ),
      );
    const out: RecognitionAllowance[] = [];
    for (const r of rows) {
      const used = await this.allowanceUsed(tx, r);
      out.push({
        id: r.id,
        managerPersonId: r.managerPersonId,
        managerName: names.get(r.managerPersonId) ?? '',
        fundingBudgetId: r.fundingBudgetId,
        fundingBudgetName: budgetRows.find((b) => b.id === r.fundingBudgetId)?.name ?? '',
        periodKey: r.periodKey,
        granted: { amountMinor: Number(r.grantedMinor), currency: r.currency },
        used: { amountMinor: used, currency: r.currency },
        remaining: { amountMinor: Number(r.grantedMinor) - used, currency: r.currency },
      });
    }
    return out.sort(
      (a, b) =>
        a.managerName.localeCompare(b.managerName) ||
        a.periodKey.localeCompare(b.periodKey) ||
        a.id.localeCompare(b.id),
    );
  }

  private async awardRow(tx: Tx, tenantId: string, id: string): Promise<AwardRow> {
    const [row] = await tx
      .select()
      .from(recognitionAwards)
      .where(and(eq(recognitionAwards.tenantId, tenantId), eq(recognitionAwards.id, id)));
    if (!row) throw ApiProblem.notFound('recognition award');
    return row;
  }

  private async awardViews(tx: Tx, rows: readonly AwardRow[]): Promise<RecognitionAward[]> {
    if (rows.length === 0) return [];
    const names = await nameOfPeople(tx, [
      ...rows.map((r) => r.giverPersonId),
      ...rows.map((r) => r.recipientPersonId),
      ...rows.map((r) => r.approverPersonId),
    ]);
    const types = await this.typeRows(tx, rows[0].tenantId);
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind as RecognitionAward['kind'],
        awardTypeId: r.awardTypeId,
        typeName: types.find((t) => t.id === r.awardTypeId)?.name ?? r.kind,
        giverPersonId: r.giverPersonId,
        giverName: names.get(r.giverPersonId) ?? '',
        recipientPersonId: r.recipientPersonId,
        recipientName: names.get(r.recipientPersonId) ?? '',
        message: r.message,
        valueTag: (r.valueTag as RecognitionAward['valueTag']) ?? null,
        visibility: r.visibility as 'public' | 'private',
        amount:
          r.amountMinor === null
            ? null
            : {
                amountMinor: Number(r.amountMinor),
                currency: (r.currency ?? 'USD') as CurrencyCode,
              },
        status: r.status as RecognitionAwardStatus,
        fundingBudgetId: r.fundingBudgetId,
        commitmentId: r.commitmentId,
        journalIds: r.journalIds,
        approverName: names.get(r.approverPersonId ?? '') ?? null,
        decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
        rewardChoice: (r.rewardChoice as RecognitionAward['rewardChoice']) ?? null,
        redeemedAt: r.redeemedAt ? iso(r.redeemedAt) : null,
        capWarning: null,
        createdAt: iso(r.createdAt),
      }))
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.recipientName.localeCompare(b.recipientName) ||
          a.id.localeCompare(b.id),
      );
  }
}
