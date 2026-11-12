import type { RequestActor } from '@bf/api/core';
import { Injectable } from '@nestjs/common';

/** One external system's answer for an approval: an ERP budget check before approving spend (094). */
export interface ExternalCheckResult {
  providerName: string;
  status: 'passed' | 'failed' | 'unavailable';
  blocksApproval: boolean;
  message: string;
}

export interface ExternalBudgetChecker {
  /**
   * Runs the checks that apply to the approval task, outside any transaction, at the amount being
   * approved (`amountMinor` for a partial approval, else the request's). Returns nothing for an
   * actor who is neither the assignee nor an active delegate, so nobody else reaches the ERP.
   */
  checkTask(
    actor: RequestActor,
    taskId: string,
    amountMinor: number | null,
  ): Promise<ExternalCheckResult[]>;
}

/**
 * The port through which integrations add a check before an approval is decided, without the
 * approval engine depending on any connector. With nothing registered there is nothing to check.
 */
@Injectable()
export class ExternalBudgetChecks {
  private checker: ExternalBudgetChecker | null = null;

  register(checker: ExternalBudgetChecker): void {
    this.checker = checker;
  }

  run(
    actor: RequestActor,
    taskId: string,
    amountMinor: number | null = null,
  ): Promise<ExternalCheckResult[]> {
    return this.checker ? this.checker.checkTask(actor, taskId, amountMinor) : Promise.resolve([]);
  }
}
