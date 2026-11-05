import type { RequestActor } from '@bf/api/core';
import type { Tx } from '@bf/api/db';
import { Injectable } from '@nestjs/common';

export type FundingOutcome =
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'withdrawn'
  | 'cancelled';

/**
 * Callbacks from spend into the events module (registered by it), so event funding requests can move
 * their event's lifecycle without spend depending on events.
 */
export interface EventFundingHook {
  fundingDecided(
    tx: Tx,
    actor: RequestActor,
    eventId: string,
    outcome: FundingOutcome,
    kind: 'budget' | 'additional_fund',
  ): Promise<void>;
}

@Injectable()
export class SpendHooks {
  private hook: EventFundingHook | null = null;

  register(hook: EventFundingHook): void {
    this.hook = hook;
  }

  async fundingDecided(
    tx: Tx,
    actor: RequestActor,
    eventId: string,
    outcome: FundingOutcome,
    kind: 'budget' | 'additional_fund',
  ): Promise<void> {
    await this.hook?.fundingDecided(tx, actor, eventId, outcome, kind);
  }
}
