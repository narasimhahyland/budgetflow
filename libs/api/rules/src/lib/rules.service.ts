import { personNames } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  postSpendExceptions,
  ruleExecutions,
  rules,
  ruleVersions,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreateRuleRequest,
  PublishRuleRequest,
  ReorderRulesRequest,
  RestoreRuleVersionRequest,
  RetireRuleRequest,
  RuleConflictItem,
  RuleDetail,
  RuleList,
  RuleSummary,
  RulesDashboard,
  RuleVersionDiff,
  UpdateRuleDraftRequest,
} from '@bf/contracts';
import {
  detectRuleConflicts,
  type EvaluableRule,
  type RuleEffect,
  type RuleScopeDef,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  conditionsOf,
  conditionText,
  EFFECT_LABELS,
  scopeOf,
  scopeSummary,
  toEvaluable,
  toVersionView,
  type RuleRow,
  type RuleVersionRow,
} from './rule-mapping';
import { DEFAULT_POLICY_TEMPLATES } from './rules-defaults';

interface Ctx {
  idempotencyKey: string;
  requestId: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Rules are tenant-wide policy, so authorization is a tenant-scoped check, never a budget one. */
const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });

/**
 * The rules engine's write and read model: versioned policy rules with an immutable active version,
 * one editable draft, conflict detection before publish, and a hash-chained audit entry per mutation.
 */
@Injectable()
export class RulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
  ) {}

  private assertRead(actor: RequestActor): void {
    this.policy.assert(actor, 'rules.read', TENANT(actor), 'rules');
  }

  private assertManage(actor: RequestActor): void {
    this.policy.assert(actor, 'rules.manage', TENANT(actor), 'rules');
  }

  private allowedActions(actor: RequestActor): string[] {
    const actions: string[] = ['view'];
    if (this.policy.can(actor, 'rules.manage', TENANT(actor)).allowed) {
      actions.push('create', 'edit', 'publish', 'retire', 'reorder', 'simulate');
    }
    if (this.policy.can(actor, 'exception.resolve', TENANT(actor)).allowed) {
      actions.push('resolve_exception');
    }
    if (this.policy.can(actor, 'doa.manage', TENANT(actor)).allowed) actions.push('approve_doa');
    return actions;
  }

  // Reads ----------------------------------------------------------------------------------------

  /** Match counts over the last 30 days, used for "most matched" and version confidence. */
  private async matchCounts(tx: Tx, tenantId: string): Promise<Map<string, number>> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await tx
      .select({ ruleId: ruleExecutions.ruleId, count: sql<number>`count(*)::int` })
      .from(ruleExecutions)
      .where(
        and(
          eq(ruleExecutions.tenantId, tenantId),
          gte(ruleExecutions.evaluatedAt, since),
          eq(ruleExecutions.subjectType, 'request'),
        ),
      )
      .groupBy(ruleExecutions.ruleId);
    return new Map(rows.filter((r) => r.ruleId).map((r) => [r.ruleId as string, r.count]));
  }

  private async loadAll(
    tx: Tx,
    tenantId: string,
  ): Promise<{ rule: RuleRow; versions: RuleVersionRow[] }[]> {
    const ruleRows = await tx
      .select()
      .from(rules)
      .where(eq(rules.tenantId, tenantId))
      .orderBy(rules.code);
    if (!ruleRows.length) return [];
    const versionRows = await tx
      .select()
      .from(ruleVersions)
      .where(
        and(
          eq(ruleVersions.tenantId, tenantId),
          inArray(
            ruleVersions.ruleId,
            ruleRows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(desc(ruleVersions.version));
    const byRule = new Map<string, RuleVersionRow[]>();
    for (const v of versionRows) {
      const list = byRule.get(v.ruleId) ?? [];
      list.push(v);
      byRule.set(v.ruleId, list);
    }
    return ruleRows.map((rule) => ({ rule, versions: byRule.get(rule.id) ?? [] }));
  }

  private activeOf = (versions: RuleVersionRow[], rule: RuleRow) =>
    versions.find((v) => v.version === rule.activeVersion) ?? null;

  private draftOf = (versions: RuleVersionRow[], rule: RuleRow) =>
    versions.find((v) => v.version === rule.draftVersion && v.status === 'draft') ?? null;

  /** Every active rule in the tenant as the evaluator sees it. */
  async activeRules(tx: Tx, tenantId: string): Promise<EvaluableRule[]> {
    const all = await this.loadAll(tx, tenantId);
    return all
      .map(({ rule, versions }) => {
        const active = this.activeOf(versions, rule);
        return active && rule.status === 'active' ? toEvaluable(rule, active) : null;
      })
      .filter((r): r is EvaluableRule => r !== null);
  }

  async list(actor: RequestActor, q: Record<string, string | undefined>): Promise<RuleList> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const all = await this.loadAll(tx, actor.tenantId);
      const counts = await this.matchCounts(tx, actor.tenantId);
      const names = await personNames(
        tx,
        all.flatMap(({ versions }) => versions.map((v) => v.publishedBy)),
      );
      const evaluables = all
        .map(({ rule, versions }) => {
          const active = this.activeOf(versions, rule);
          return active ? toEvaluable(rule, active) : null;
        })
        .filter((r): r is EvaluableRule => r !== null);

      const items: RuleSummary[] = all.map(({ rule, versions }) => {
        const active = this.activeOf(versions, rule);
        const draft = this.draftOf(versions, rule);
        const shown = active ?? draft ?? versions[0] ?? null;
        const candidate = draft ?? active;
        const conflicts = candidate
          ? detectRuleConflicts(toEvaluable(rule, candidate), evaluables)
          : [];
        return {
          id: rule.id,
          code: rule.code,
          name: rule.name,
          family: rule.family,
          templateCode: rule.templateCode,
          priority: shown?.priority ?? 50,
          effect: (shown?.effect ?? 'require_approval') as RuleEffect,
          status: rule.status as RuleSummary['status'],
          activeVersion: rule.activeVersion,
          draftVersion: rule.draftVersion,
          scopeSummary: shown ? scopeSummary(scopeOf(shown)) : 'All locations and entities',
          matches30d: counts.get(rule.id) ?? 0,
          validFrom: shown?.validFrom ?? null,
          validTo: shown?.validTo ?? null,
          lastPublishedByName: active?.publishedBy ? (names.get(active.publishedBy) ?? null) : null,
          conflictsWith: conflicts.map((c) => c.otherRule.code),
        };
      });

      const effectiveOn = q['effectiveOn'];
      const filtered = items.filter((i) => {
        if (q['status'] && i.status !== q['status']) return false;
        if (q['effect'] && i.effect !== q['effect']) return false;
        if (q['family'] && i.family !== q['family']) return false;
        if (effectiveOn) {
          if (i.validFrom && i.validFrom > effectiveOn) return false;
          if (i.validTo && i.validTo < effectiveOn) return false;
        }
        const term = q['q']?.toLowerCase();
        if (term && !`${i.code} ${i.name}`.toLowerCase().includes(term)) return false;
        return true;
      });
      filtered.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
      return { items: filtered };
    });
  }

  async get(actor: RequestActor, ruleId: string): Promise<RuleDetail> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detailTx(tx, actor, ruleId),
    );
  }

  private async detailTx(tx: Tx, actor: RequestActor, ruleId: string): Promise<RuleDetail> {
    const [rule] = await tx
      .select()
      .from(rules)
      .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)));
    if (!rule) throw ApiProblem.notFound('rule');
    const versions = await tx
      .select()
      .from(ruleVersions)
      .where(and(eq(ruleVersions.tenantId, actor.tenantId), eq(ruleVersions.ruleId, ruleId)))
      .orderBy(desc(ruleVersions.version));

    const counts = await this.matchCounts(tx, actor.tenantId);
    const names = await personNames(
      tx,
      versions.flatMap((v) => [v.publishedBy, v.createdBy]),
    );
    const active = this.activeOf(versions, rule);
    const draft = this.draftOf(versions, rule);
    const matches = counts.get(rule.id) ?? 0;

    const others = (await this.activeRules(tx, actor.tenantId)).filter((r) => r.id !== rule.id);
    const candidate = draft ?? active;
    const conflicts: RuleConflictItem[] = candidate
      ? detectRuleConflicts(toEvaluable(rule, candidate), others).map((c) => ({
          ruleId: c.otherRule.id,
          ruleCode: c.otherRule.code,
          ruleName: c.otherRule.name,
          version: c.otherRule.version,
          priority: c.otherRule.priority,
          effect: c.otherRule.effect,
          winningEffect: c.winningEffect,
          reason: c.reason,
          blocking: c.blocking,
        }))
      : [];

    const allowedActions = this.allowedActions(actor);
    const canManage = allowedActions.includes('edit');
    const actions: string[] = ['view'];
    if (canManage) {
      actions.push('duplicate', 'simulate', 'backtest');
      if (draft && !conflicts.some((c) => c.blocking)) actions.push('publish');
      if (draft) actions.push('edit_draft');
      if (!draft) actions.push('create_draft');
      if (rule.status === 'active') actions.push('retire');
      if (versions.length > 1) actions.push('restore', 'compare');
    }

    return {
      id: rule.id,
      code: rule.code,
      name: rule.name,
      family: rule.family,
      templateCode: rule.templateCode,
      status: rule.status as RuleDetail['status'],
      active: active ? toVersionView(active, names, matches) : null,
      draft: draft ? toVersionView(draft, names, 0) : null,
      versions: versions.map((v) =>
        toVersionView(v, names, v.version === rule.activeVersion ? matches : 0),
      ),
      conflicts,
      backtestSummary: {
        evaluatedCount: 0,
        changedCount: 0,
        stricterCount: 0,
        looserCount: 0,
        blockedCount: 0,
      },
      allowedActions: actions,
    };
  }

  /** Screen 066: KPIs, weekly decision mix, most matched rules and attention items. */
  async dashboard(actor: RequestActor): Promise<RulesDashboard> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const all = await this.loadAll(tx, actor.tenantId);
      const counts = await this.matchCounts(tx, actor.tenantId);
      const evaluables = all
        .map(({ rule, versions }) => {
          const active = this.activeOf(versions, rule);
          return active && rule.status === 'active' ? toEvaluable(rule, active) : null;
        })
        .filter((r): r is EvaluableRule => r !== null);

      const day = today();
      let conflicts = 0;
      const conflictPairs: string[] = [];
      for (const { rule, versions } of all) {
        const draft = this.draftOf(versions, rule);
        if (!draft) continue;
        const found = detectRuleConflicts(
          toEvaluable(rule, draft),
          evaluables.filter((e) => e.id !== rule.id),
        );
        if (found.length) {
          conflicts += found.length;
          conflictPairs.push(`${rule.code} and ${found.map((f) => f.otherRule.code).join(', ')}`);
        }
      }

      const [exceptionCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(postSpendExceptions)
        .where(
          and(
            eq(postSpendExceptions.tenantId, actor.tenantId),
            eq(postSpendExceptions.status, 'open'),
          ),
        );

      const pastSla = await tx.execute(sql`
        select count(*)::int as count from approval_tasks
        where tenant_id = ${actor.tenantId} and status = 'pending' and due_at < now()
      `);
      const approvalsPastSla = Number(
        (pastSla.rows[0] as { count?: number } | undefined)?.count ?? 0,
      );

      const executions = await tx
        .select({
          effect: ruleExecutions.effect,
          evaluatedAt: ruleExecutions.evaluatedAt,
        })
        .from(ruleExecutions)
        .where(
          and(
            eq(ruleExecutions.tenantId, actor.tenantId),
            eq(ruleExecutions.subjectType, 'request'),
            gte(ruleExecutions.evaluatedAt, new Date(Date.now() - 28 * 86_400_000)),
          ),
        );

      const weeks = [3, 2, 1, 0].map((weeksAgo) => {
        const end = Date.now() - weeksAgo * 7 * 86_400_000;
        const start = end - 7 * 86_400_000;
        const inWeek = executions.filter((e) => {
          const t = e.evaluatedAt.getTime();
          return t >= start && t < end;
        });
        return {
          weekLabel: new Date(start).toISOString().slice(5, 10),
          autoApproved: inWeek.filter((e) => e.effect === 'auto_approve' || e.effect === 'none')
            .length,
          approvalRequired: inWeek.filter((e) => e.effect === 'require_approval').length,
          warned: inWeek.filter((e) => e.effect === 'warn').length,
          blocked: inWeek.filter((e) => e.effect === 'block' || e.effect === 'freeze').length,
        };
      });

      const totalMatches = [...counts.values()].reduce((a, b) => a + b, 0);
      const mostMatchedRules = all
        .map(({ rule, versions }) => {
          const active = this.activeOf(versions, rule);
          const matches = counts.get(rule.id) ?? 0;
          return {
            ruleId: rule.id,
            code: rule.code,
            name: rule.name,
            effect: (active?.effect ?? 'require_approval') as RuleEffect,
            matches,
            sharePct: totalMatches ? Math.round((matches / totalMatches) * 1000) / 10 : 0,
            lastChange: active?.validFrom ?? rule.createdAt.toISOString().slice(0, 10),
          };
        })
        .filter((r) => r.matches > 0)
        .sort((a, b) => b.matches - a.matches)
        .slice(0, 5);

      const needsAttention: RulesDashboard['needsAttention'] = [];
      if (conflicts > 0) {
        needsAttention.push({
          id: 'conflicts',
          tone: 'important',
          title: `${conflicts} draft ${conflicts === 1 ? 'rule conflicts' : 'rules conflict'} with an active rule`,
          detail: `${conflictPairs[0]}. Resolve the conflict before publishing.`,
          linkPath: '/admin/rules/list?status=draft',
        });
      }
      const openExceptions = exceptionCount?.count ?? 0;
      if (openExceptions > 0) {
        needsAttention.push({
          id: 'exceptions',
          tone: 'warning',
          title: `${openExceptions} post-spend ${openExceptions === 1 ? 'exception needs' : 'exceptions need'} a decision`,
          detail: 'Alcohol over cap, blocked vendors, split purchases and duplicates.',
          linkPath: '/admin/rules/exceptions',
        });
      }
      if (approvalsPastSla > 0) {
        needsAttention.push({
          id: 'sla',
          tone: 'warning',
          title: `${approvalsPastSla} ${approvalsPastSla === 1 ? 'approval is' : 'approvals are'} past the service level`,
          detail: 'The nightly sweep escalates them to the next authority.',
          linkPath: '/approvals',
        });
      }
      const scheduled = all.filter(({ rule, versions }) => {
        const active = this.activeOf(versions, rule);
        return active ? active.validFrom > day : false;
      }).length;
      if (scheduled > 0) {
        needsAttention.push({
          id: 'scheduled',
          tone: 'info',
          title: `${scheduled} ${scheduled === 1 ? 'rule starts' : 'rules start'} later`,
          detail: 'Scheduled rules take effect on their start date.',
          linkPath: '/admin/rules/list?status=scheduled',
        });
      }

      return {
        kpis: {
          activeRules: all.filter(({ rule }) => rule.status === 'active').length,
          draftsAwaitingPublish: all.filter(({ rule }) => rule.draftVersion !== null).length,
          conflicts,
          scheduledToStart: scheduled,
          openExceptions,
          approvalsPastSla,
        },
        weeklyDecisions: weeks,
        mostMatchedRules,
        needsAttention,
        allowedActions: this.allowedActions(actor),
      };
    });
  }

  /** Screen 078: plain-English comparison of two versions of the same rule. */
  async diff(
    actor: RequestActor,
    ruleId: string,
    q: { fromVersion?: number; toVersion?: number },
  ): Promise<RuleVersionDiff> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [rule] = await tx
        .select()
        .from(rules)
        .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)));
      if (!rule) throw ApiProblem.notFound('rule');
      const versions = await tx
        .select()
        .from(ruleVersions)
        .where(and(eq(ruleVersions.tenantId, actor.tenantId), eq(ruleVersions.ruleId, ruleId)))
        .orderBy(desc(ruleVersions.version));
      if (versions.length === 0) throw ApiProblem.notFound('rule version');

      const to =
        versions.find((v) => v.version === (q.toVersion ?? versions[0].version)) ?? versions[0];
      const from =
        versions.find(
          (v) => v.version === (q.fromVersion ?? (to.version > 1 ? to.version - 1 : to.version)),
        ) ?? to;

      const summaryLines: RuleVersionDiff['summaryLines'] = [];
      const line = (
        kind: 'added' | 'removed' | 'changed' | 'unchanged',
        field: string,
        before: string | null,
        after: string | null,
        text: string,
      ) => summaryLines.push({ kind, field, before, after, text });

      if (from.priority !== to.priority) {
        line(
          'changed',
          'priority',
          String(from.priority),
          String(to.priority),
          `Priority changed from ${from.priority} to ${to.priority}.`,
        );
      }
      if (from.effect !== to.effect) {
        line(
          'changed',
          'effect',
          EFFECT_LABELS[from.effect as RuleEffect],
          EFFECT_LABELS[to.effect as RuleEffect],
          `Outcome changed from ${EFFECT_LABELS[from.effect as RuleEffect].toLowerCase()} to ${EFFECT_LABELS[to.effect as RuleEffect].toLowerCase()}.`,
        );
      }

      const fromConds = conditionsOf(from).conditions;
      const toConds = conditionsOf(to).conditions;
      const key = (c: { fact: string; op: string }) => `${c.fact}:${c.op}`;
      const fromByKey = new Map(fromConds.map((c) => [key(c), c]));
      const toByKey = new Map(toConds.map((c) => [key(c), c]));
      for (const c of toConds) {
        const prior = fromByKey.get(key(c));
        if (!prior) {
          line('added', 'conditions', null, conditionText(c), `Added: ${conditionText(c)}.`);
        } else if (JSON.stringify(prior.value) !== JSON.stringify(c.value)) {
          line(
            'changed',
            'conditions',
            conditionText(prior),
            conditionText(c),
            `Changed: ${conditionText(prior)} is now ${conditionText(c)}.`,
          );
        }
      }
      for (const c of fromConds) {
        if (!toByKey.has(key(c))) {
          line('removed', 'conditions', conditionText(c), null, `Removed: ${conditionText(c)}.`);
        }
      }

      const approversOf = (row: RuleVersionRow) =>
        ((row.actions as { approvers?: string[] }[] | null) ?? [])
          .flatMap((a) => a.approvers ?? [])
          .join(', ');
      if (approversOf(from) !== approversOf(to)) {
        line(
          'changed',
          'approvers',
          approversOf(from) || 'none',
          approversOf(to) || 'none',
          `Approvers changed from ${approversOf(from) || 'none'} to ${approversOf(to) || 'none'}.`,
        );
      }
      if (from.validFrom !== to.validFrom) {
        line(
          'changed',
          'validFrom',
          from.validFrom,
          to.validFrom,
          `Start date moved from ${from.validFrom} to ${to.validFrom}.`,
        );
      }
      if (from.explanation !== to.explanation) {
        line(
          'changed',
          'explanation',
          from.explanation,
          to.explanation,
          'The plain-English explanation shown to requesters changed.',
        );
      }
      if (summaryLines.length === 0) {
        line(
          'unchanged',
          'rule',
          null,
          null,
          'These two versions have the same conditions, outcome and dates.',
        );
      }

      const [decided] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ruleExecutions)
        .where(
          and(eq(ruleExecutions.tenantId, actor.tenantId), eq(ruleExecutions.ruleId, rule.id)),
        );

      return {
        ruleId: rule.id,
        ruleCode: rule.code,
        fromVersion: from.version,
        toVersion: to.version,
        summaryLines,
        decisionsWithToVersion: decided?.count ?? 0,
      };
    });
  }

  // Writes ---------------------------------------------------------------------------------------

  async create(
    actor: RequestActor,
    body: CreateRuleRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleDetail>> {
    this.assertManage(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        let seed: {
          conditions: ReturnType<typeof conditionsOf>;
          actions: { effect: RuleEffect; approvers?: string[] }[];
          scope: RuleScopeDef;
          explanation: string;
          priority: number;
          effect: RuleEffect;
        } | null = null;

        if (body.mode === 'duplicate' && body.duplicateFromRuleId) {
          const [source] = await tx
            .select()
            .from(rules)
            .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, body.duplicateFromRuleId)));
          if (!source) throw ApiProblem.notFound('rule');
          const [sourceVersion] = await tx
            .select()
            .from(ruleVersions)
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, source.id),
                eq(ruleVersions.version, source.activeVersion ?? source.draftVersion ?? 1),
              ),
            );
          if (sourceVersion) {
            seed = {
              conditions: conditionsOf(sourceVersion),
              actions: sourceVersion.actions as { effect: RuleEffect; approvers?: string[] }[],
              scope: scopeOf(sourceVersion),
              explanation: sourceVersion.explanation,
              priority: sourceVersion.priority,
              effect: sourceVersion.effect as RuleEffect,
            };
          }
        } else if (body.mode === 'template' && body.templateCode) {
          const template = DEFAULT_POLICY_TEMPLATES.find((t) => t.code === body.templateCode);
          if (!template) {
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'That policy template does not exist.', {
              templateCode: body.templateCode,
            });
          }
          seed = {
            conditions: { kind: 'group', logic: 'and', conditions: [] },
            actions: [{ effect: template.defaultEffect }],
            scope: {},
            explanation: template.description,
            priority: body.priority ?? 50,
            effect: template.defaultEffect,
          };
        }

        const conditions = body.conditions ??
          seed?.conditions ?? {
            kind: 'group' as const,
            logic: 'and' as const,
            conditions: [],
          };
        const actions = body.actions ?? seed?.actions ?? [{ effect: 'require_approval' as const }];
        const effect = (actions[0]?.effect ?? seed?.effect ?? 'require_approval') as RuleEffect;
        const code = body.code ?? (await this.nextCode(tx, actor.tenantId));

        const existing = await tx
          .select({ id: rules.id })
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.code, code)));
        if (existing.length) {
          throw new ApiProblem(409, 'DUPLICATE_CODE', `Rule ${code} already exists.`, { code });
        }

        const [rule] = await tx
          .insert(rules)
          .values({
            tenantId: actor.tenantId,
            code,
            name: body.name,
            family: body.family ?? 'general',
            templateCode: body.templateCode ?? null,
            status: 'draft',
            draftVersion: 1,
            createdBy: actor.personId,
          })
          .returning();

        await tx.insert(ruleVersions).values({
          tenantId: actor.tenantId,
          ruleId: rule.id,
          version: 1,
          status: 'draft',
          priority: body.priority ?? seed?.priority ?? 50,
          effect,
          conditions,
          actions,
          scope: body.scope ?? seed?.scope ?? {},
          explanation: body.explanation ?? seed?.explanation ?? '',
          validFrom: body.validFrom ?? today(),
          validTo: body.validTo ?? null,
          createdBy: actor.personId,
        });

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rule.created',
          resourceType: 'rule',
          resourceId: rule.id,
          requestId: ctx.requestId,
          reason: `Draft rule created from ${body.mode}`,
          changes: {
            code: { from: null, to: code },
            name: { from: null, to: body.name },
            effect: { from: null, to: effect },
          },
        });

        return this.detailTx(tx, actor, rule.id);
      },
    );
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    const rows = await tx
      .select({ code: rules.code })
      .from(rules)
      .where(eq(rules.tenantId, tenantId));
    const numbers = rows
      .map((r) => /^R-(\d+)$/.exec(r.code)?.[1])
      .filter((n): n is string => Boolean(n))
      .map(Number);
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    return `R-${String(next).padStart(2, '0')}`;
  }

  async updateDraft(
    actor: RequestActor,
    ruleId: string,
    body: UpdateRuleDraftRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleDetail>> {
    this.assertManage(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.update_draft',
        request: { ruleId, ...body },
        status: 200,
      },
      async (tx) => {
        const [rule] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)))
          .for('update');
        if (!rule) throw ApiProblem.notFound('rule');
        if (rule.status === 'retired') {
          throw new ApiProblem(
            409,
            'RULE_NOT_EDITABLE',
            'This rule is retired. Restore a version into a new draft before editing it.',
          );
        }

        const values = {
          priority: body.priority,
          effect: (body.actions[0]?.effect ?? 'require_approval') as RuleEffect,
          conditions: body.conditions,
          actions: body.actions,
          scope: body.scope,
          explanation: body.explanation,
          validFrom: body.validFrom,
          validTo: body.validTo ?? null,
        };

        let draftVersion = rule.draftVersion;
        if (draftVersion === null) {
          // Active versions are immutable: editing one opens the next version as a draft.
          const [max] = await tx
            .select({ version: sql<number>`coalesce(max(${ruleVersions.version}), 0)::int` })
            .from(ruleVersions)
            .where(and(eq(ruleVersions.tenantId, actor.tenantId), eq(ruleVersions.ruleId, ruleId)));
          draftVersion = (max?.version ?? 0) + 1;
          await tx.insert(ruleVersions).values({
            tenantId: actor.tenantId,
            ruleId,
            version: draftVersion,
            status: 'draft',
            createdBy: actor.personId,
            ...values,
          });
        } else {
          await tx
            .update(ruleVersions)
            .set(values)
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, ruleId),
                eq(ruleVersions.version, draftVersion),
              ),
            );
        }

        await tx
          .update(rules)
          .set({
            name: body.name ?? rule.name,
            draftVersion,
            updatedAt: new Date(),
          })
          .where(eq(rules.id, ruleId));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rule.draft_saved',
          resourceType: 'rule',
          resourceId: ruleId,
          requestId: ctx.requestId,
          reason: 'Rule draft saved',
          changes: {
            draftVersion: { from: rule.draftVersion, to: draftVersion },
            priority: { from: null, to: body.priority },
            effect: { from: null, to: values.effect },
          },
        });

        return this.detailTx(tx, actor, ruleId);
      },
    );
  }

  async publish(
    actor: RequestActor,
    ruleId: string,
    body: PublishRuleRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleDetail>> {
    this.assertManage(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.publish',
        request: { ruleId, ...body },
        status: 200,
      },
      async (tx) => {
        const [rule] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)))
          .for('update');
        if (!rule) throw ApiProblem.notFound('rule');
        if (rule.draftVersion === null) {
          throw new ApiProblem(409, 'RULE_NOT_EDITABLE', 'This rule has no draft to publish.');
        }
        const [draft] = await tx
          .select()
          .from(ruleVersions)
          .where(
            and(
              eq(ruleVersions.tenantId, actor.tenantId),
              eq(ruleVersions.ruleId, ruleId),
              eq(ruleVersions.version, rule.draftVersion),
            ),
          );
        if (!draft) throw ApiProblem.notFound('rule version');

        const others = (await this.activeRules(tx, actor.tenantId)).filter((r) => r.id !== rule.id);
        const conflicts = detectRuleConflicts(toEvaluable(rule, draft), others);
        const blocking = conflicts.filter((c) => c.blocking);
        if (blocking.length) {
          throw new ApiProblem(
            409,
            'RULE_CONFLICT',
            `Resolve the conflict with ${blocking.map((c) => c.otherRule.code).join(', ')} before publishing.`,
            { conflictsWith: blocking.map((c) => c.otherRule.code).join(', ') },
          );
        }

        const validFrom = body.validFrom ?? draft.validFrom;
        const now = new Date();
        const priorActive = rule.activeVersion;
        if (priorActive !== null) {
          await tx
            .update(ruleVersions)
            .set({ status: 'expired', validTo: validFrom })
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, ruleId),
                eq(ruleVersions.version, priorActive),
              ),
            );
        }
        const scheduled = validFrom > today();
        await tx
          .update(ruleVersions)
          .set({
            status: scheduled ? 'scheduled' : 'active',
            validFrom,
            validTo: body.validTo ?? draft.validTo,
            publishedAt: now,
            publishedBy: actor.personId,
          })
          .where(
            and(
              eq(ruleVersions.tenantId, actor.tenantId),
              eq(ruleVersions.ruleId, ruleId),
              eq(ruleVersions.version, draft.version),
            ),
          );
        await tx
          .update(rules)
          .set({
            status: scheduled ? 'scheduled' : 'active',
            activeVersion: draft.version,
            draftVersion: null,
            updatedAt: now,
          })
          .where(eq(rules.id, ruleId));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rule.published',
          resourceType: 'rule',
          resourceId: ruleId,
          requestId: ctx.requestId,
          reason: body.reason ?? `Published version ${draft.version} of ${rule.code}`,
          changes: {
            activeVersion: { from: priorActive, to: draft.version },
            validFrom: { from: null, to: validFrom },
            status: { from: rule.status, to: scheduled ? 'scheduled' : 'active' },
          },
        });

        return this.detailTx(tx, actor, ruleId);
      },
    );
  }

  async retire(
    actor: RequestActor,
    ruleId: string,
    body: RetireRuleRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleDetail>> {
    this.assertManage(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.retire',
        request: { ruleId, ...body },
        status: 200,
      },
      async (tx) => {
        const [rule] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)))
          .for('update');
        if (!rule) throw ApiProblem.notFound('rule');
        if (rule.status === 'retired') {
          throw new ApiProblem(409, 'INVALID_TRANSITION', 'This rule is already retired.');
        }
        const now = new Date();
        await tx
          .update(rules)
          .set({ status: 'retired', retiredReason: body.reason, retiredAt: now, updatedAt: now })
          .where(eq(rules.id, ruleId));
        if (rule.activeVersion !== null) {
          await tx
            .update(ruleVersions)
            .set({ status: 'retired', validTo: today() })
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, ruleId),
                eq(ruleVersions.version, rule.activeVersion),
              ),
            );
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rule.retired',
          resourceType: 'rule',
          resourceId: ruleId,
          requestId: ctx.requestId,
          reason: body.reason,
          changes: { status: { from: rule.status, to: 'retired' } },
        });
        return this.detailTx(tx, actor, ruleId);
      },
    );
  }

  async restore(
    actor: RequestActor,
    ruleId: string,
    body: RestoreRuleVersionRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleDetail>> {
    this.assertManage(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.restore',
        request: { ruleId, ...body },
        status: 200,
      },
      async (tx) => {
        const [rule] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, ruleId)))
          .for('update');
        if (!rule) throw ApiProblem.notFound('rule');
        const [source] = await tx
          .select()
          .from(ruleVersions)
          .where(
            and(
              eq(ruleVersions.tenantId, actor.tenantId),
              eq(ruleVersions.ruleId, ruleId),
              eq(ruleVersions.version, body.version),
            ),
          );
        if (!source) {
          throw new ApiProblem(
            404,
            'RULE_VERSION_NOT_FOUND',
            `Version ${body.version} of this rule does not exist.`,
          );
        }
        const [max] = await tx
          .select({ version: sql<number>`coalesce(max(${ruleVersions.version}), 0)::int` })
          .from(ruleVersions)
          .where(and(eq(ruleVersions.tenantId, actor.tenantId), eq(ruleVersions.ruleId, ruleId)));
        const nextVersion = (max?.version ?? 0) + 1;

        if (rule.draftVersion !== null) {
          await tx
            .delete(ruleVersions)
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, ruleId),
                eq(ruleVersions.version, rule.draftVersion),
                eq(ruleVersions.status, 'draft'),
              ),
            );
        }
        await tx.insert(ruleVersions).values({
          tenantId: actor.tenantId,
          ruleId,
          version: nextVersion,
          status: 'draft',
          priority: source.priority,
          effect: source.effect,
          conditions: source.conditions,
          actions: source.actions,
          scope: source.scope,
          explanation: source.explanation,
          validFrom: today(),
          validTo: source.validTo,
          createdBy: actor.personId,
        });
        await tx
          .update(rules)
          .set({ draftVersion: nextVersion, updatedAt: new Date() })
          .where(eq(rules.id, ruleId));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'rule.version_restored',
          resourceType: 'rule',
          resourceId: ruleId,
          requestId: ctx.requestId,
          reason: `Version ${body.version} copied into draft version ${nextVersion}`,
          changes: { draftVersion: { from: rule.draftVersion, to: nextVersion } },
        });
        return this.detailTx(tx, actor, ruleId);
      },
    );
  }

  async reorder(
    actor: RequestActor,
    body: ReorderRulesRequest,
    ctx: Ctx,
  ): Promise<CommandResult<RuleList>> {
    this.assertManage(actor);
    const result = await this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.reorder',
        request: body,
        status: 200,
      },
      async (tx) => {
        // Ordered row locks keep concurrent reorders deterministic.
        const ids = [...body.items].map((i) => i.ruleId).sort();
        const locked = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), inArray(rules.id, ids)))
          .orderBy(rules.id)
          .for('update');
        const byId = new Map(locked.map((r) => [r.id, r]));
        const changed: Record<string, unknown> = {};

        for (const item of body.items) {
          const rule = byId.get(item.ruleId);
          if (!rule) throw ApiProblem.notFound('rule');
          const targetVersion = rule.draftVersion ?? rule.activeVersion;
          if (targetVersion === null) continue;
          const [version] = await tx
            .select()
            .from(ruleVersions)
            .where(
              and(
                eq(ruleVersions.tenantId, actor.tenantId),
                eq(ruleVersions.ruleId, rule.id),
                eq(ruleVersions.version, targetVersion),
              ),
            );
          if (!version || version.priority === item.priority) continue;

          if (rule.draftVersion !== null) {
            await tx
              .update(ruleVersions)
              .set({ priority: item.priority })
              .where(eq(ruleVersions.id, version.id));
          } else {
            // Active versions never change: a new priority opens a new published version.
            const [max] = await tx
              .select({ version: sql<number>`coalesce(max(${ruleVersions.version}), 0)::int` })
              .from(ruleVersions)
              .where(
                and(eq(ruleVersions.tenantId, actor.tenantId), eq(ruleVersions.ruleId, rule.id)),
              );
            const nextVersion = (max?.version ?? 0) + 1;
            await tx
              .update(ruleVersions)
              .set({ status: 'expired', validTo: today() })
              .where(eq(ruleVersions.id, version.id));
            await tx.insert(ruleVersions).values({
              tenantId: actor.tenantId,
              ruleId: rule.id,
              version: nextVersion,
              status: 'active',
              priority: item.priority,
              effect: version.effect,
              conditions: version.conditions,
              actions: version.actions,
              scope: version.scope,
              explanation: version.explanation,
              validFrom: today(),
              validTo: version.validTo,
              publishedAt: new Date(),
              publishedBy: actor.personId,
              createdBy: actor.personId,
            });
            await tx
              .update(rules)
              .set({ activeVersion: nextVersion, updatedAt: new Date() })
              .where(eq(rules.id, rule.id));
          }
          changed[rule.code] = { from: version.priority, to: item.priority };
        }

        if (Object.keys(changed).length) {
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'rule.reordered',
            resourceType: 'rule',
            resourceId: body.items[0].ruleId,
            requestId: ctx.requestId,
            reason: body.reason ?? 'Rule priorities changed',
            changes: changed,
          });
        }
        return { ok: true };
      },
    );
    return { ...result, body: await this.list(actor, {}) };
  }
}
