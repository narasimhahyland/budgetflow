import type { RequestActor } from '@bf/api/core';
import type { Tx } from '@bf/api/db';
import type { AiChannel, AiFeature, AiOutcome, AiProvenance, AiSourceRef } from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { allowedNumbers, figuresTraceable } from './figure-guard';
import { minimize, minimizePrompt } from './minimization';
import { AiProvider, type Fact } from './provider/ai-provider';
import { AiQueryLogService, type ScopeSummary } from './query-log.service';

export interface GatewayCall<T> {
  tx: Tx;
  actor: RequestActor;
  feature: AiFeature;
  channel: AiChannel;
  task: string;
  /** Facts already filtered by PolicyService; the gateway minimizes them before the model sees them. */
  facts: readonly Fact[];
  sources: readonly AiSourceRef[];
  scope: ScopeSummary;
  prompt?: string;
  schema: z.ZodType<T>;
  /** The success outcome to log when the output survives every guard. */
  successOutcome: Extract<AiOutcome, 'answered' | 'suggested'>;
  suggestionId?: string | null;
  /** Model-written sentences. Every number in them must be traceable to a retrieved fact. */
  narrative?: (output: T) => string[];
}

export interface GatewayResult<T> {
  outcome: AiOutcome;
  output: T | null;
  queryLogId: string;
  provenance: AiProvenance;
  /** Numbers the model wrote that were not in the facts; non-empty means the output was discarded. */
  untraceable: string[];
}

/**
 * Every model call in BudgetFlow goes through here, which is why the guarantees hold in one place:
 * minimize what is sent, parse what comes back against a zod schema, discard any output that writes a
 * figure the ledger did not produce, and append one query-log row whatever the result. The gateway
 * never writes money, never approves and never calls another command.
 */
@Injectable()
export class AiGateway {
  constructor(
    private readonly provider: AiProvider,
    private readonly log: AiQueryLogService,
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  get modelId(): string {
    return this.provider.modelId;
  }

  get modelVersion(): string {
    return this.provider.modelVersion;
  }

  get configured(): boolean {
    return this.provider.configured;
  }

  /** Logs an outcome that never reached the model (feature off, nothing in scope, rate limited). */
  async logOnly(
    call: Pick<
      GatewayCall<unknown>,
      'tx' | 'actor' | 'feature' | 'channel' | 'scope' | 'sources'
    > & {
      outcome: AiOutcome;
      suggestionId?: string | null;
      appliedResourceType?: string | null;
      appliedResourceId?: string | null;
      auditEventId?: string | null;
    },
  ): Promise<{ queryLogId: string; provenance: AiProvenance }> {
    const queryLogId = await this.log.append(call.tx, {
      tenantId: call.actor.tenantId,
      feature: call.feature,
      channel: call.channel,
      actorPersonId: call.actor.personId,
      actorSubject: call.actor.subject,
      outcome: call.outcome,
      scope: call.scope,
      factRefs: call.sources,
      sentFields: [],
      provider: this.provider.id,
      modelId: this.provider.modelId,
      modelVersion: this.provider.modelVersion,
      latencyMs: 0,
      suggestionId: call.suggestionId ?? null,
      appliedResourceType: call.appliedResourceType ?? null,
      appliedResourceId: call.appliedResourceId ?? null,
      auditEventId: call.auditEventId ?? null,
    });
    return {
      queryLogId,
      provenance: this.provenance(queryLogId, call.suggestionId ?? null, 0),
    };
  }

  async run<T>(call: GatewayCall<T>): Promise<GatewayResult<T>> {
    const { facts, sentFields } = minimize(call.feature, call.facts);
    const prompt = call.prompt ? minimizePrompt(call.prompt) : undefined;
    const started = Date.now();
    let outcome: AiOutcome = call.successOutcome;
    let output: T | null = null;
    let untraceable: string[] = [];
    try {
      const raw = await this.provider.generate({
        feature: call.feature,
        task: call.task,
        facts,
        prompt,
        schema: call.schema,
      });
      if (raw.unavailable) {
        outcome = 'failed';
      } else {
        const parsed = call.schema.safeParse(raw.output);
        if (!parsed.success) {
          outcome = 'discarded_unreliable';
        } else {
          const sentences = call.narrative?.(parsed.data) ?? [];
          const check = figuresTraceable(sentences, allowedNumbers(facts));
          if (!check.ok) {
            outcome = 'discarded_unreliable';
            untraceable = check.untraceable;
          } else {
            output = parsed.data;
          }
        }
      }
    } catch {
      outcome = 'failed';
    }
    const latencyMs = Date.now() - started;
    const queryLogId = await this.log.append(call.tx, {
      tenantId: call.actor.tenantId,
      feature: call.feature,
      channel: call.channel,
      actorPersonId: call.actor.personId,
      actorSubject: call.actor.subject,
      outcome,
      scope: call.scope,
      factRefs: call.sources,
      sentFields,
      provider: this.provider.id,
      modelId: this.provider.modelId,
      modelVersion: this.provider.modelVersion,
      latencyMs,
      suggestionId: call.suggestionId ?? null,
    });
    return {
      outcome,
      output,
      queryLogId,
      untraceable,
      provenance: this.provenance(queryLogId, call.suggestionId ?? null, latencyMs),
    };
  }

  provenance(queryLogId: string, suggestionId: string | null, latencyMs: number): AiProvenance {
    return {
      suggestionId,
      queryLogId,
      provider: this.provider.id,
      modelId: this.provider.modelId,
      modelVersion: this.provider.modelVersion,
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      latencyMs,
    };
  }
}

export type { Fact, ScopeSummary };
