import type { AiFeature } from '@bf/contracts';
import type { z } from 'zod';

/**
 * A minimized fact: a record reference plus only the fields the feature is allowed to send.
 * Values are plain scalars; nothing nested, so nothing can smuggle personal data or a secret.
 */
export interface Fact {
  type: string;
  id: string;
  label: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface AiAttachment {
  contentType: string;
  bytes: Uint8Array;
}

export interface AiCall<T> {
  feature: AiFeature;
  /** Names the instructions the provider gives the model (`ask`, `policy_explain`, `extract_fields`, ...). */
  task: string;
  facts: readonly Fact[];
  /** The asker's own words, length-capped. Never another person's text. */
  prompt?: string;
  /** Files the task must read (a receipt or quote). Only extraction sends any. */
  attachments?: readonly AiAttachment[];
  /** Model output is parsed against this; anything that fails validation is discarded, never used. */
  schema: z.ZodType<T>;
}

export interface AiRawResult {
  /** Raw JSON from the provider, parsed against the call's schema by the gateway. */
  output: unknown;
  /** The provider could not answer at all (model down, quota). The feature degrades, never waits. */
  unavailable?: boolean;
}

/**
 * Every model call goes through this interface. `AI_PROVIDER` picks the implementation: the offline
 * `RecordedAiProvider` (default; local stack, functional runs, CI) or `BedrockAiProvider`, whose
 * credentials come from the server environment and never from code or the database.
 */
export abstract class AiProvider {
  abstract readonly id: string;
  abstract readonly modelId: string;
  abstract readonly modelVersion: string;
  abstract readonly configured: boolean;
  abstract generate<T>(call: AiCall<T>): Promise<AiRawResult>;
}
