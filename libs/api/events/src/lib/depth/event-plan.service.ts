import { ApiProblem, type CommandResult, type RequestActor } from '@bf/api/core';
import { eventAgendaItems, eventChecklists, eventTemplates, type Tx } from '@bf/api/db';
import type {
  EventAgendaItem,
  EventChecklistTask,
  EventPlanView,
  UpdateAgendaItemBody,
  UpdateChecklistTaskBody,
  UpsertAgendaItemBody,
  UpsertChecklistTaskBody,
} from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Ctx, EventRow } from '../events.service';
import { EventDepthSupport, LOCKED_STATUSES } from './event-depth.support';
import { EventTemplatesService } from './templates.service';

type TaskRow = typeof eventChecklists.$inferSelect;
type AgendaRow = typeof eventAgendaItems.$inferSelect;
type Comment = { id: string; authorName: string; text: string; createdAt: string };

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The shared event plan (46b): checklist tasks in the Before, On the day and After sections, and the
 * agenda invitees see. The plan never moves money; its money steps link to the screens that do, and
 * system tasks tick themselves when the linked work happens.
 */
@Injectable()
export class EventPlanService {
  constructor(
    private readonly support: EventDepthSupport,
    private readonly templates: EventTemplatesService,
  ) {}

  private taskView(t: TaskRow, assignees: Map<string, string>): EventChecklistTask {
    const today = todayIso();
    return {
      id: t.id,
      section: t.section as 'before' | 'on_the_day' | 'after',
      title: t.title,
      description: t.description,
      assigneePersonId: t.assigneePersonId,
      assigneeName: t.assigneePersonId ? (assignees.get(t.assigneePersonId) ?? null) : null,
      dueDate: t.dueDate,
      overdue: t.status !== 'done' && t.dueDate !== null && t.dueDate < today,
      reminder: t.reminder,
      status: t.status as 'open' | 'done',
      linkedItemType: t.linkedItemType,
      linkedItemId: t.linkedItemId,
      linkedLabel: t.linkedLabel,
      isSystem: t.isSystem,
      sortOrder: t.sortOrder,
      comments: ((t.comments ?? []) as Comment[]).map((c) => ({
        id: c.id,
        authorName: c.authorName,
        text: c.text,
        createdAt: c.createdAt,
      })),
    };
  }

  private agendaView(a: AgendaRow): EventAgendaItem {
    return {
      id: a.id,
      startTime: a.startTime,
      endTime: a.endTime,
      title: a.title,
      locationRoom: a.locationRoom,
      hostName: a.hostName,
      notes: a.notes,
      visibleToInvitees: a.visibleToInvitees,
      sortOrder: a.sortOrder,
    };
  }

  /** The agenda items an invited employee sees on their invitation (47a). */
  async visibleAgenda(tx: Tx, eventId: string): Promise<EventAgendaItem[]> {
    const rows = await tx
      .select()
      .from(eventAgendaItems)
      .where(
        and(eq(eventAgendaItems.eventId, eventId), eq(eventAgendaItems.visibleToInvitees, true)),
      )
      .orderBy(asc(eventAgendaItems.sortOrder), asc(eventAgendaItems.startTime));
    return rows.map((a) => this.agendaView(a));
  }

  async view(tx: Tx, actor: RequestActor, e: EventRow): Promise<EventPlanView> {
    const tasks = await tx
      .select()
      .from(eventChecklists)
      .where(eq(eventChecklists.eventId, e.id))
      .orderBy(asc(eventChecklists.section), asc(eventChecklists.sortOrder));
    const agenda = await tx
      .select()
      .from(eventAgendaItems)
      .where(eq(eventAgendaItems.eventId, e.id))
      .orderBy(asc(eventAgendaItems.sortOrder), asc(eventAgendaItems.startTime));
    const assignees = await this.support.personNames(
      tx,
      tasks.map((t) => t.assigneePersonId),
    );
    const [template] = e.templateId
      ? await tx
          .select({ name: eventTemplates.name })
          .from(eventTemplates)
          .where(eq(eventTemplates.id, e.templateId))
      : [];
    const views = tasks.map((t) => this.taskView(t, assignees));
    const canManage = await this.support.canManage(tx, actor, e);
    return {
      eventId: e.id,
      canManage,
      readOnly: !canManage || LOCKED_STATUSES.includes(e.status),
      templateId: e.templateId,
      templateName: template?.name ?? null,
      totalTasks: views.length,
      doneTasks: views.filter((t) => t.status === 'done').length,
      overdueTasks: views.filter((t) => t.overdue).length,
      tasks: views,
      agenda: agenda.map((a) => this.agendaView(a)),
    };
  }

  get(actor: RequestActor, eventId: string): Promise<EventPlanView> {
    return this.support.read(actor, async (tx) => {
      const e = await this.support.event(tx, actor, eventId);
      return this.view(tx, actor, e);
    });
  }

  applyTemplate(
    actor: RequestActor,
    eventId: string,
    templateId: string,
    ctx: Ctx,
  ): Promise<CommandResult<EventPlanView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.plan.apply_template:${eventId}`,
        request: { templateId },
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'The plan');
        const template = await this.templates.rowFor(tx, actor, templateId);
        const [existing] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(eventChecklists)
          .where(eq(eventChecklists.eventId, e.id));
        if (Number(existing?.n ?? 0) > 0)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'This event already has a plan. Add tasks one by one instead of applying a template.',
          );
        await this.templates.applyTemplatePlan(tx, actor, e.id, template, e.startsAt);
        await this.support.log(tx, actor, e, 'event.plan_template_applied', ctx, {
          templateId: { from: e.templateId, to: templateId },
          templateName: { from: null, to: template.name },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  createTask(
    actor: RequestActor,
    eventId: string,
    body: UpsertChecklistTaskBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventPlanView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.plan.task_create:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'The plan');
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${eventChecklists.sortOrder}), -1) + 1` })
          .from(eventChecklists)
          .where(and(eq(eventChecklists.eventId, e.id), eq(eventChecklists.section, body.section)));
        const [row] = await tx
          .insert(eventChecklists)
          .values({
            tenantId: actor.tenantId,
            eventId: e.id,
            section: body.section,
            title: body.title,
            description: body.description ?? null,
            assigneePersonId: body.assigneePersonId ?? null,
            dueDate: body.dueDate ?? null,
            reminder: body.reminder ?? null,
            status: body.status ?? 'open',
            sortOrder: body.sortOrder ?? Number(next),
          })
          .returning();
        await this.support.log(tx, actor, e, 'event.task_created', ctx, {
          taskId: { from: null, to: row.id },
          title: { from: null, to: row.title },
          assigneePersonId: { from: null, to: row.assigneePersonId },
          dueDate: { from: null, to: row.dueDate },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  updateTask(
    actor: RequestActor,
    eventId: string,
    taskId: string,
    body: UpdateChecklistTaskBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventPlanView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.plan.task_update:${taskId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId);
        const [task] = await tx
          .select()
          .from(eventChecklists)
          .where(and(eq(eventChecklists.id, taskId), eq(eventChecklists.eventId, e.id)));
        if (!task) throw ApiProblem.notFound('task');
        const canManage = await this.support.canManage(tx, actor, e);
        const mine = Boolean(actor.personId && task.assigneePersonId === actor.personId);
        if (!canManage && !mine)
          throw ApiProblem.forbidden('Only the organizers or the assignee can change this task.');
        this.support.assertOpen(e, 'The plan');
        if (task.isSystem && body.status !== undefined)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'This task completes on its own when the work it links to is done.',
          );
        // An assignee who does not organize the event may complete and comment, nothing else.
        const patch: Partial<typeof eventChecklists.$inferInsert> = { updatedAt: new Date() };
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (body.status !== undefined) {
          patch.status = body.status;
          patch.completedAt = body.status === 'done' ? new Date() : null;
          changes['status'] = { from: task.status, to: body.status };
        }
        if (canManage) {
          if (body.title !== undefined) {
            patch.title = body.title;
            changes['title'] = { from: task.title, to: body.title };
          }
          if (body.description !== undefined) patch.description = body.description ?? null;
          if (body.section !== undefined) patch.section = body.section;
          if (body.assigneePersonId !== undefined) {
            patch.assigneePersonId = body.assigneePersonId ?? null;
            changes['assigneePersonId'] = {
              from: task.assigneePersonId,
              to: body.assigneePersonId ?? null,
            };
          }
          if (body.dueDate !== undefined) {
            patch.dueDate = body.dueDate ?? null;
            changes['dueDate'] = { from: task.dueDate, to: body.dueDate ?? null };
          }
          if (body.reminder !== undefined) patch.reminder = body.reminder ?? null;
          if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
        }
        if (body.comment) {
          const names = await this.support.personNames(tx, [actor.personId]);
          const comment: Comment = {
            id: randomUUID(),
            authorName: (actor.personId && names.get(actor.personId)) || 'Someone',
            text: body.comment,
            createdAt: new Date().toISOString(),
          };
          patch.comments = [...((task.comments ?? []) as Comment[]), comment];
          changes['comments'] = { from: null, to: comment.text };
        }
        await tx.update(eventChecklists).set(patch).where(eq(eventChecklists.id, task.id));
        await this.support.log(tx, actor, e, 'event.task_updated', ctx, {
          taskId: { from: null, to: task.id },
          ...changes,
        });
        return this.view(tx, actor, e);
      },
    );
  }

  createAgendaItem(
    actor: RequestActor,
    eventId: string,
    body: UpsertAgendaItemBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventPlanView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.plan.agenda_create:${eventId}`,
        request: body,
        status: 201,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'The agenda');
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${eventAgendaItems.sortOrder}), -1) + 1` })
          .from(eventAgendaItems)
          .where(eq(eventAgendaItems.eventId, e.id));
        const [row] = await tx
          .insert(eventAgendaItems)
          .values({
            tenantId: actor.tenantId,
            eventId: e.id,
            startTime: body.startTime,
            endTime: body.endTime ?? null,
            title: body.title,
            locationRoom: body.locationRoom ?? null,
            hostName: body.hostName ?? null,
            notes: body.notes ?? null,
            visibleToInvitees: body.visibleToInvitees,
            sortOrder: body.sortOrder ?? Number(next),
          })
          .returning();
        await this.support.log(tx, actor, e, 'event.agenda_item_created', ctx, {
          itemId: { from: null, to: row.id },
          title: { from: null, to: row.title },
          startTime: { from: null, to: row.startTime },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  updateAgendaItem(
    actor: RequestActor,
    eventId: string,
    itemId: string,
    body: UpdateAgendaItemBody,
    ctx: Ctx,
  ): Promise<CommandResult<EventPlanView>> {
    return this.support.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `events.plan.agenda_update:${itemId}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        const e = await this.support.event(tx, actor, eventId, true);
        this.support.assertOpen(e, 'The agenda');
        const [item] = await tx
          .select()
          .from(eventAgendaItems)
          .where(and(eq(eventAgendaItems.id, itemId), eq(eventAgendaItems.eventId, e.id)));
        if (!item) throw ApiProblem.notFound('agenda item');
        await tx
          .update(eventAgendaItems)
          .set({
            ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
            ...(body.endTime !== undefined ? { endTime: body.endTime ?? null } : {}),
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.locationRoom !== undefined ? { locationRoom: body.locationRoom ?? null } : {}),
            ...(body.hostName !== undefined ? { hostName: body.hostName ?? null } : {}),
            ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
            ...(body.visibleToInvitees !== undefined
              ? { visibleToInvitees: body.visibleToInvitees }
              : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            updatedAt: new Date(),
          })
          .where(eq(eventAgendaItems.id, item.id));
        await this.support.log(tx, actor, e, 'event.agenda_item_updated', ctx, {
          itemId: { from: null, to: item.id },
          title: { from: item.title, to: body.title ?? item.title },
          visibleToInvitees: {
            from: item.visibleToInvitees,
            to: body.visibleToInvitees ?? item.visibleToInvitees,
          },
        });
        return this.view(tx, actor, e);
      },
    );
  }

  /**
   * Ticks the open system task of a kind once the work it links to is done (a quote selected,
   * invitations sent, attendance final, the survey opened), and records what completed it.
   */
  async completeSystemTask(
    tx: Tx,
    eventId: string,
    linkedItemType: string,
    linked: { id: string | null; label: string },
  ): Promise<void> {
    await tx
      .update(eventChecklists)
      .set({
        status: 'done',
        completedAt: new Date(),
        linkedItemId: linked.id,
        linkedLabel: linked.label,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventChecklists.eventId, eventId),
          eq(eventChecklists.linkedItemType, linkedItemType),
          eq(eventChecklists.isSystem, true),
          eq(eventChecklists.status, 'open'),
        ),
      );
  }

  /** Tasks of an event that still wait, used by the events dashboard (043). */
  async nextOpenTask(
    tx: Tx,
    eventIds: readonly string[],
  ): Promise<Map<string, { title: string; overdue: boolean }>> {
    if (!eventIds.length) return new Map();
    const rows = await tx
      .select()
      .from(eventChecklists)
      .where(
        and(inArray(eventChecklists.eventId, [...eventIds]), eq(eventChecklists.status, 'open')),
      )
      .orderBy(asc(eventChecklists.dueDate), asc(eventChecklists.sortOrder));
    const today = todayIso();
    const out = new Map<string, { title: string; overdue: boolean }>();
    for (const r of rows) {
      if (out.has(r.eventId)) continue;
      out.set(r.eventId, {
        title: r.title,
        overdue: r.dueDate !== null && r.dueDate < today,
      });
    }
    return out;
  }
}
