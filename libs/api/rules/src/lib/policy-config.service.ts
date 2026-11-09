import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
  todayUtc,
} from '@bf/api/core';
import { policyConfigs, withTenant, workflowTemplates, type Db, type Tx } from '@bf/api/db';
import type {
  PolicyConfigsBundle,
  SaveWorkflowRouteRequest,
  TemplatesAndThresholdsView,
  ThresholdTableFamily,
  UpdatePolicySectionRequest,
  UpdateThresholdTableRequest,
  WorkflowRouteList,
  WorkflowRouteView,
  WorkflowStepDef,
} from '@bf/contracts';
import { validateThresholdBands } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_POLICY_CONFIGS,
  DEFAULT_POLICY_TEMPLATES,
  DEFAULT_THRESHOLD_FAMILIES,
  DEFAULT_WORKFLOW_STEPS,
} from './rules-defaults';

interface Ctx {
  idempotencyKey: string;
  requestId: string | null;
}

const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });

const ROUTE_LABELS: Record<SaveWorkflowRouteRequest['requestKind'], string> = {
  spending: 'Spending requests',
  budget: 'Budget requests',
  additional_fund: 'Additional fund requests',
  over_budget: 'Over-budget requests',
  exception: 'Exception requests',
  contribution: 'Inter-Director Budget Contribution Requests',
};

const ROUTE_KINDS = Object.keys(ROUTE_LABELS) as SaveWorkflowRouteRequest['requestKind'][];

/** Which stored policy section carries each part of the policy bundle shown on screens 071-076. */
const SECTION_KEYS = {
  spending_limits: 'spendingLimits',
  employee_cap: 'employeeCap',
  category_policy: 'categories',
  gifts_entertainment: 'giftsEntertainment',
  location_policy: 'locations',
  vendor_control: 'vendors',
  over_budget: 'overBudget',
  freeze_zero: 'freezeZero',
  sla_notifications: 'slaNotifications',
} as const;

type Section = keyof typeof SECTION_KEYS;

/**
 * Threshold tables, policy templates, approval routing workflows and the policy configuration
 * sections. Saved sections are stored per tenant and every save writes one audit entry.
 */
@Injectable()
export class PolicyConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
  ) {}

  private assertRead(actor: RequestActor): void {
    this.policy.assert(actor, 'rules.read', TENANT(actor), 'policy configuration');
  }

  private assertManage(actor: RequestActor): void {
    this.policy.assert(actor, 'rules.manage', TENANT(actor), 'policy configuration');
  }

  private allowedActions(actor: RequestActor): string[] {
    return this.policy.can(actor, 'rules.manage', TENANT(actor)).allowed
      ? ['view', 'edit', 'publish']
      : ['view'];
  }

  private async sections(tx: Tx, tenantId: string): Promise<Map<string, unknown>> {
    const rows = await tx.select().from(policyConfigs).where(eq(policyConfigs.tenantId, tenantId));
    return new Map(rows.map((r) => [r.section, r.payload]));
  }

  // Templates and threshold bands (071a) ---------------------------------------------------------

  async templatesAndThresholds(actor: RequestActor): Promise<TemplatesAndThresholdsView> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const saved = await this.sections(tx, actor.tenantId);
      const stored = saved.get('threshold_table') as ThresholdTableFamily[] | undefined;
      return {
        families: stored ?? DEFAULT_THRESHOLD_FAMILIES,
        templates: DEFAULT_POLICY_TEMPLATES,
        allowedActions: this.allowedActions(actor),
      };
    });
  }

  async updateThresholdTable(
    actor: RequestActor,
    body: UpdateThresholdTableRequest,
    ctx: Ctx,
  ): Promise<CommandResult<TemplatesAndThresholdsView>> {
    this.assertManage(actor);
    const check = validateThresholdBands(body.bands);
    if (!check.valid) {
      throw new ApiProblem(422, 'THRESHOLD_BANDS_INVALID', check.errors.join(' '), {
        family: body.family,
      });
    }
    const result = await this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.update_threshold_table',
        request: body,
        status: 200,
      },
      async (tx) => {
        const saved = await this.sections(tx, actor.tenantId);
        const current =
          (saved.get('threshold_table') as ThresholdTableFamily[] | undefined) ??
          DEFAULT_THRESHOLD_FAMILIES;
        const before = current.find((f) => f.family === body.family);
        const next = current.map((f) =>
          f.family === body.family
            ? { ...f, remainingPctBelow: body.remainingPctBelow, bands: body.bands }
            : f,
        );
        await this.writeSection(tx, actor, 'threshold_table', next);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rules.threshold_table_published',
          resourceType: 'threshold_table',
          resourceId: body.family,
          requestId: ctx.requestId,
          reason: `Approval threshold bands for ${body.family} published`,
          changes: {
            bandCount: { from: before?.bands.length ?? 0, to: body.bands.length },
            remainingPctBelow: {
              from: before?.remainingPctBelow ?? null,
              to: body.remainingPctBelow,
            },
          },
        });
        return { ok: true };
      },
    );
    return { ...result, body: await this.templatesAndThresholds(actor) };
  }

  // Approval routing workflows (070) -------------------------------------------------------------

  async listRoutes(actor: RequestActor): Promise<WorkflowRouteList> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowTemplates)
        .where(eq(workflowTemplates.tenantId, actor.tenantId))
        .orderBy(desc(workflowTemplates.version));
      const allowedActions = this.allowedActions(actor);
      const items: WorkflowRouteView[] = ROUTE_KINDS.map((kind) => {
        const forKind = rows.filter((r) => r.requestKind === kind);
        const active = forKind.find((r) => r.status === 'active');
        const draft = forKind.find((r) => r.status === 'draft');
        const shown = active ?? draft;
        return {
          id: shown?.id ?? null,
          requestKind: kind,
          label: ROUTE_LABELS[kind],
          activeVersion: active?.version ?? 1,
          draftVersion: draft?.version ?? null,
          status: active ? 'active' : draft ? 'draft' : 'active',
          validFrom: shown?.validFrom ?? todayUtc(),
          steps: (shown?.steps as WorkflowStepDef[] | undefined) ?? DEFAULT_WORKFLOW_STEPS,
          allowedActions,
        };
      });
      return { items };
    });
  }

  async saveRoute(
    actor: RequestActor,
    body: SaveWorkflowRouteRequest,
    ctx: Ctx,
  ): Promise<CommandResult<WorkflowRouteView>> {
    this.assertManage(actor);
    const stepNumbers = body.steps.map((s) => s.stepNo);
    if (new Set(stepNumbers).size !== stepNumbers.length) {
      throw new ApiProblem(422, 'WORKFLOW_ROUTE_INVALID', 'Each step needs its own step number.');
    }
    if (!body.steps.some((s) => s.applyDoa)) {
      throw new ApiProblem(
        422,
        'WORKFLOW_ROUTE_INVALID',
        'At least one step must apply delegation-of-authority limits.',
      );
    }
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.save_workflow_route',
        request: body,
        status: 200,
      },
      async (tx) => {
        const existing = await tx
          .select()
          .from(workflowTemplates)
          .where(
            and(
              eq(workflowTemplates.tenantId, actor.tenantId),
              eq(workflowTemplates.requestKind, body.requestKind),
            ),
          )
          .orderBy(desc(workflowTemplates.version))
          .for('update');
        const priorActive = existing.find((r) => r.status === 'active');
        const nextVersion = (existing[0]?.version ?? 0) + 1;
        const publish = body.publish ?? true;
        const validFrom = body.validFrom ?? todayUtc();

        if (publish && priorActive) {
          await tx
            .update(workflowTemplates)
            .set({ status: 'superseded', validTo: validFrom })
            .where(eq(workflowTemplates.id, priorActive.id));
        }
        const [saved] = await tx
          .insert(workflowTemplates)
          .values({
            tenantId: actor.tenantId,
            requestKind: body.requestKind,
            version: nextVersion,
            status: publish ? 'active' : 'draft',
            steps: body.steps,
            validFrom,
            publishedAt: publish ? new Date() : null,
            publishedBy: publish ? actor.personId : null,
          })
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: publish ? 'rules.route_published' : 'rules.route_drafted',
          resourceType: 'workflow_template',
          resourceId: saved.id,
          requestId: ctx.requestId,
          reason: `Approval route for ${ROUTE_LABELS[body.requestKind]} saved`,
          changes: {
            version: { from: priorActive?.version ?? null, to: nextVersion },
            stepCount: {
              from: (priorActive?.steps as WorkflowStepDef[] | undefined)?.length ?? null,
              to: body.steps.length,
            },
          },
        });

        return {
          id: saved.id,
          requestKind: body.requestKind,
          label: ROUTE_LABELS[body.requestKind],
          activeVersion: publish ? nextVersion : (priorActive?.version ?? 1),
          draftVersion: publish ? null : nextVersion,
          status: publish ? ('active' as const) : ('draft' as const),
          validFrom,
          steps: body.steps,
          allowedActions: this.allowedActions(actor),
        };
      },
    );
  }

  // Policy configuration sections (071, 072, 072a, 073, 073a, 074, 075, 076) ---------------------

  async policyConfigs(actor: RequestActor): Promise<PolicyConfigsBundle> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const saved = await this.sections(tx, actor.tenantId);
      const bundle: PolicyConfigsBundle = {
        ...DEFAULT_POLICY_CONFIGS,
        allowedActions: this.allowedActions(actor),
      };
      // Stored sections override the shipped defaults one key at a time.
      const limits = saved.get('spending_limits') as
        | PolicyConfigsBundle['spendingLimits']['items']
        | undefined;
      if (limits) bundle.spendingLimits = { ...bundle.spendingLimits, items: limits };
      const cap = saved.get('employee_cap') as
        | PolicyConfigsBundle['spendingLimits']['employeeCap']
        | undefined;
      if (cap) bundle.spendingLimits = { ...bundle.spendingLimits, employeeCap: cap };
      const categories = saved.get('category_policy') as
        | PolicyConfigsBundle['categories']
        | undefined;
      if (categories) bundle.categories = categories;
      const gifts = saved.get('gifts_entertainment') as
        | PolicyConfigsBundle['giftsEntertainment']
        | undefined;
      if (gifts) bundle.giftsEntertainment = gifts;
      const locations = saved.get('location_policy') as
        | PolicyConfigsBundle['locations']
        | undefined;
      if (locations) bundle.locations = locations;
      const vendors = saved.get('vendor_control') as PolicyConfigsBundle['vendors'] | undefined;
      if (vendors) bundle.vendors = vendors;
      const overBudget = saved.get('over_budget') as PolicyConfigsBundle['overBudget'] | undefined;
      if (overBudget) bundle.overBudget = overBudget;
      const freezeZero = saved.get('freeze_zero') as PolicyConfigsBundle['freezeZero'] | undefined;
      if (freezeZero) bundle.freezeZero = freezeZero;
      const sla = saved.get('sla_notifications') as
        | PolicyConfigsBundle['slaNotifications']
        | undefined;
      if (sla) bundle.slaNotifications = sla;
      return bundle;
    });
  }

  async updatePolicyConfig(
    actor: RequestActor,
    body: UpdatePolicySectionRequest,
    ctx: Ctx,
  ): Promise<CommandResult<PolicyConfigsBundle>> {
    this.assertManage(actor);
    const section = body.section as Section;
    const payload = body.payload[SECTION_KEYS[section]] ?? body.payload;
    const result = await this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.update_policy_section',
        request: body,
        status: 200,
      },
      async (tx) => {
        const version = await this.writeSection(tx, actor, section, payload);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rules.policy_section_published',
          resourceType: 'policy_config',
          resourceId: section,
          requestId: ctx.requestId,
          reason: body.reason ?? `Policy section ${section} published`,
          changes: { section: { from: null, to: section }, version: { from: null, to: version } },
        });
        return { ok: true };
      },
    );
    return { ...result, body: await this.policyConfigs(actor) };
  }

  /** Upserts one section, bumping its version so the audit trail shows how often policy changed. */
  private async writeSection(
    tx: Tx,
    actor: RequestActor,
    section: string,
    payload: unknown,
  ): Promise<number> {
    const [existing] = await tx
      .select()
      .from(policyConfigs)
      .where(and(eq(policyConfigs.tenantId, actor.tenantId), eq(policyConfigs.section, section)))
      .for('update');
    if (existing) {
      const version = existing.version + 1;
      await tx
        .update(policyConfigs)
        .set({ payload, version, updatedBy: actor.personId, updatedAt: new Date() })
        .where(eq(policyConfigs.id, existing.id));
      return version;
    }
    await tx.insert(policyConfigs).values({
      tenantId: actor.tenantId,
      section,
      version: 1,
      payload,
      updatedBy: actor.personId,
    });
    return 1;
  }
}
