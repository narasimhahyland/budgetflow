import type { Tx } from '@bf/api/db';
import { Injectable } from '@nestjs/common';

export interface CloseBlock {
  code: 'EVENT_HAS_UNMATCHED_ACTUALS' | 'EVENT_MISSING_RECHARGE' | 'EVENT_HAS_OPEN_COMMITMENTS';
  message: string;
  count: number;
}

/**
 * Extra conditions an event must meet before it closes. Phase 6 registers the unmatched-actuals check
 * (`register(async (tx, eventId) => ...)`); Phase 5 checks missing recharges itself.
 */
@Injectable()
export class EventCloseChecks {
  private readonly checks: ((tx: Tx, eventId: string) => Promise<CloseBlock | null>)[] = [];

  register(check: (tx: Tx, eventId: string) => Promise<CloseBlock | null>): void {
    this.checks.push(check);
  }

  async run(tx: Tx, eventId: string): Promise<CloseBlock | null> {
    for (const check of this.checks) {
      const block = await check(tx, eventId);
      if (block) return block;
    }
    return null;
  }
}
