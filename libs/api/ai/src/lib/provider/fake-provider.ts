import { Injectable } from '@nestjs/common';
import { AiProvider, type AiCall, type AiRawResult, type Fact } from './ai-provider';

/**
 * The deterministic provider used by the local stack, functional runs and CI. It never reaches the
 * network: every answer is derived from the minimized facts it was given, so the same question over
 * the same data always produces the same words, and nothing in a test depends on a live model.
 *
 * Numbers are only ever copied from the facts (`formatMinor` reads a fact value); the provider never
 * does arithmetic that ends up in text, which is what the figure guard then verifies.
 *
 * Prompts beginning with `__eval:` are recorded fixtures used by the evaluation sets to exercise the
 * guardrails (invented figure, invalid shape, provider down). They exist only in this fake provider.
 */
@Injectable()
export class FakeAiProvider extends AiProvider {
  readonly id = 'fake';
  readonly modelId = 'budgetflow-fake';
  readonly modelVersion = '2026.11';
  readonly configured = true;

  async generate<T>(call: AiCall<T>): Promise<AiRawResult> {
    const prompt = (call.prompt ?? '').trim();
    const facts = [...call.facts].sort(
      (a, b) =>
        a.type.localeCompare(b.type) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    );
    if (prompt.startsWith('__eval:')) return this.fixture(prompt, call.task, facts);
    switch (call.task) {
      case 'ask':
        return { output: this.ask(prompt, facts) };
      case 'policy_explain':
        return { output: this.policyExplain(facts) };
      case 'allocation_weights':
        return { output: this.allocationWeights(facts) };
      case 'outlook_drivers':
        return { output: this.outlookDrivers(facts) };
      case 'match_rank':
        return { output: this.matchRank(facts) };
      case 'extract_fields':
        return { output: this.extractFields(facts) };
      case 'anomaly_explain':
        return { output: this.anomalyExplain(facts) };
      case 'summary_sections':
        return { output: this.summarySections(facts) };
      case 'variance_commentary':
        return { output: this.varianceCommentary(facts) };
      default:
        return { output: null, unavailable: true };
    }
  }

  // Recorded guardrail fixtures ------------------------------------------------------------------

  private fixture(prompt: string, task: string, facts: readonly Fact[]): AiRawResult {
    const name = prompt.slice('__eval:'.length).split(/\s/)[0];
    if (name === 'unavailable') return { output: null, unavailable: true };
    if (name === 'schema-invalid') return { output: { answer: 42, why: 'not an array' } };
    if (name === 'invent-figure' && task === 'summary_sections')
      return {
        output: {
          sections: [
            {
              key: 'headline',
              // A figure written by the model instead of read from the ledger: the guard must
              // discard the whole draft rather than show a number nobody can trace.
              text: 'October spend was USD 61,450.00, comfortably inside plan.',
            },
          ],
          confidence: 'high',
        },
      };
    if (name === 'invent-figure' && task === 'variance_commentary')
      return {
        output: {
          text: 'The forecast is USD 9,900.00 above authorized because of extra catering.',
          needsExplanation: false,
          confidence: 'high',
        },
      };
    if (name === 'invent-figure')
      return {
        output: {
          answer: 'Your budgets have USD 123,456.78 available right now.',
          why: ['Figure written by the model rather than read from the ledger.'],
          followUps: [],
          confidence: 'high',
        },
      };
    if (name === 'workaround' && task === 'policy_explain')
      return {
        output: {
          explanation: 'Split the request into two so each one stays under the limit.',
          options: ['Submit two smaller requests instead'],
          confidence: 'high',
        },
      };
    return { output: this.ask(prompt, facts) };
  }

  // Per-task recorded answers --------------------------------------------------------------------

  private ask(prompt: string, facts: readonly Fact[]) {
    const budgets = facts.filter((f) => f.type === 'budget');
    const events = facts.filter((f) => f.type === 'event');
    const requests = facts.filter((f) => f.type === 'request');
    const sentences: string[] = [];
    const why: string[] = [];
    for (const b of budgets.slice(0, 3)) {
      const currency = str(b, 'currency') ?? 'USD';
      sentences.push(
        `${b.label} has ${formatMinor(num(b, 'availableMinor'), currency)} available under its rules, of ${formatMinor(num(b, 'authorizedMinor'), currency)} authorized.`,
      );
      sentences.push(
        `${formatMinor(num(b, 'encumberedMinor'), currency)} is committed and ${formatMinor(num(b, 'actualMinor'), currency)} is spent.`,
      );
      why.push(
        `${b.label} is ${str(b, 'status') ?? 'active'} and its ledger balances were read for this answer.`,
      );
    }
    for (const e of events.slice(0, 2)) {
      const currency = str(e, 'currency') ?? 'USD';
      sentences.push(
        `${e.label} on ${str(e, 'eventDate') ?? str(e, 'date') ?? 'its planned date'} has ${formatMinor(num(e, 'amountMinor'), currency)} committed.`,
      );
    }
    for (const r of requests.slice(0, 2)) {
      sentences.push(`${r.label} is ${str(r, 'status') ?? 'waiting'}.`);
    }
    if (!sentences.length)
      sentences.push('I could not find anything you can see that answers that question.');
    return {
      answer: sentences.join(' '),
      why: why.length ? why : ['No matching records were in scope for the asker.'],
      followUps: followUpsFor(prompt, budgets),
      confidence: budgets.length || events.length || requests.length ? 'high' : 'low',
    };
  }

  private policyExplain(facts: readonly Fact[]) {
    const rule = facts.find((f) => f.type === 'rule');
    const request = facts.find((f) => f.type === 'request');
    const outcome = str(rule, 'outcome') ?? str(request, 'outcome') ?? 'allowed';
    const currency = str(request, 'currency') ?? str(rule, 'currency') ?? 'USD';
    const limit = num(rule, 'limitMinor');
    const amount = num(request, 'amountMinor');
    const parts: string[] = [];
    if (rule) parts.push(`${rule.label} applies to this request.`);
    if (limit > 0) parts.push(`The limit is ${formatMinor(limit, currency)}.`);
    if (amount > 0) parts.push(`Your request is ${formatMinor(amount, currency)}.`);
    if (!parts.length) parts.push('No BudgetFlow policy limits this. Normal approval applies.');
    const options =
      outcome === 'blocked'
        ? [
            limit > 0
              ? `Reduce the amount to ${formatMinor(limit, currency)} or less`
              : 'Reduce the amount to fit the policy',
            'If there is a business reason, ask for an exception with an over-budget request',
          ]
        : outcome === 'needs_approval'
          ? ['Submit the request; it will be routed for the approval the policy requires']
          : [];
    return { explanation: parts.join(' '), options, confidence: rule ? 'high' : 'medium' };
  }

  private allocationWeights(facts: readonly Fact[]) {
    const children = facts.filter(
      (f) => f.type === 'budget' && f.fields['eligibleHeadcount'] !== undefined,
    );
    const underUsed = children.filter(
      (c) => num(c, 'priorUseBps') > 0 && num(c, 'priorUseBps') < 7000,
    );
    const anyParticipation = children.some((c) => num(c, 'participationBps') > 0);
    const weights = underUsed.length
      ? { headcountPct: 50, priorUsePct: 30, participationPct: 20 }
      : anyParticipation
        ? { headcountPct: 60, priorUsePct: 20, participationPct: 20 }
        : { headcountPct: 70, priorUsePct: 30, participationPct: 0 };
    const reason = underUsed.length
      ? `${underUsed[0].label} left part of last year's budget unused, so last year's use carries more weight than usual.`
      : 'Headcount carries most of the weight because every child used last year fully.';
    return {
      ...weights,
      reason,
      lineReasons: Object.fromEntries(
        children.map((c) => [
          c.id,
          `${c.label} has ${num(c, 'eligibleHeadcount')} eligible employees and used ${formatBps(num(c, 'priorUseBps'))} of last year's budget.`,
        ]),
      ),
    };
  }

  private outlookDrivers(facts: readonly Fact[]) {
    const budget = facts.find((f) => f.type === 'budget');
    if (!budget) return { drivers: [], confidence: 'low' };
    const currency = str(budget, 'currency') ?? 'USD';
    const months = num(budget, 'monthsObserved');
    const drivers = [
      {
        label: 'Run rate',
        detail: `Spending has averaged ${formatMinor(num(budget, 'monthlyRunRateMinor'), currency)} a month over ${months} months.`,
      },
      {
        label: 'Open commitments',
        detail: `${formatMinor(num(budget, 'openCommitmentsMinor'), currency)} is committed and not yet spent.`,
      },
      {
        label: 'Request pipeline',
        detail: `${formatMinor(num(budget, 'pendingRequestsMinor'), currency)} is waiting for approval.`,
      },
    ];
    return { drivers, confidence: months >= 6 ? 'high' : 'medium' };
  }

  private matchRank(facts: readonly Fact[]) {
    const line = facts.find((f) => f.type === 'actual');
    const candidates = facts.filter((f) => f.type === 'commitment' || f.type === 'budget');
    const scored = candidates
      .map((c) => {
        const sameEvent = str(c, 'eventCode') && str(c, 'eventCode') === str(line, 'eventCode');
        const sameCostCentre =
          str(c, 'costCenterCode') && str(c, 'costCenterCode') === str(line, 'costCenterCode');
        const difference = Math.abs(num(c, 'amountDifferenceMinor'));
        const days = Math.abs(num(c, 'daysApart'));
        const score =
          (sameEvent ? 500 : 0) +
          (sameCostCentre ? 150 : 0) +
          (c.type === 'commitment' ? 100 : 0) +
          Math.max(0, 200 - difference / 100) +
          Math.max(0, 60 - days * 5);
        const reasons: string[] = [];
        if (sameEvent) reasons.push('The spend line carries the same event code.');
        if (sameCostCentre) reasons.push('The cost centre maps to this budget.');
        if (days > 0) reasons.push(`The dates are ${days} days apart.`);
        if (difference === 0) reasons.push('The amount matches exactly.');
        if (!reasons.length) reasons.push('Merchant and amount are closest to this target.');
        return { id: c.id, score, reasons };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return {
      ranking: scored.map((s) => s.id),
      reasons: Object.fromEntries(scored.map((s) => [s.id, s.reasons])),
      confidence: Object.fromEntries(
        scored.map((s, i) => [
          s.id,
          i === 0 && s.score >= 600 ? 'high' : i === 0 ? 'medium' : 'low',
        ]),
      ),
    };
  }

  private extractFields(facts: readonly Fact[]) {
    const doc = facts.find((f) => f.type === 'document');
    const fileName = str(doc, 'fileName') ?? '';
    if (/blurred|handwritten|unreadable/i.test(fileName)) return { readable: false, fields: [] };
    const currency = str(doc, 'expectedCurrency') ?? 'USD';
    const kind = str(doc, 'documentKind') ?? 'receipt';
    const recorded = RECORDED_DOCUMENTS[fileName];
    if (!recorded) return { readable: false, fields: [] };
    const fields = recorded.map((f) => ({
      field: f.field,
      value: f.value,
      confidence: f.confidence,
    }));
    if (kind === 'quote')
      fields.push({ field: 'currency', value: currency, confidence: 'high' as const });
    return { readable: true, fields: fields.sort((a, b) => a.field.localeCompare(b.field)) };
  }

  /**
   * Leadership summary sections (011b). The provider writes sentences with `{{figure:<token>}}`
   * placeholders and never a figure of its own: BudgetFlow substitutes each token with the value the
   * read model produced, so the words can change without the numbers moving.
   */
  private summarySections(facts: readonly Fact[]) {
    const period = facts.find((f) => f.type === 'period');
    const label = str(period, 'periodLabel') ?? 'the period';
    const region = facts.find((f) => f.type === 'region');
    const risk = facts.find((f) => f.type === 'risk');
    const engagement = facts.find((f) => f.type === 'engagement');
    const sections = [
      {
        key: 'headline',
        text: `${label} spend was {{figure:period_actual}} against a phased plan of {{figure:period_plan}}. Year to date the company has used {{figure:ytd_utilization}} of authorized budgets, with {{figure:company_available}} available company-wide.`,
      },
      {
        key: 'variances',
        text: region
          ? `${region.label} is {{figure:largest_variance}} away from its plan for ${label}, driven by committed spend of {{figure:largest_variance_committed}}.`
          : `No region moved far enough from its plan for ${label} to be worth a sentence.`,
      },
      {
        key: 'risks',
        text: risk
          ? `{{figure:at_risk_budgets}} budgets are likely to leave {{figure:at_risk_unused}} unused by year end, so reclaim is worth planning.`
          : 'No budget is far enough from its plan to need action this month.',
      },
      {
        key: 'engagement',
        text: engagement
          ? 'Reach was {{figure:reach}} of eligible employees and the post-event pulse was {{figure:pulse}}.'
          : 'There is not enough survey data this period to describe engagement.',
      },
    ];
    return { sections, confidence: period ? 'high' : 'low' };
  }

  /**
   * Variance commentary (011b in 087a). Every driver sentence names a real record; the part of the
   * variance the drivers do not explain becomes an `[Explain: ...]` note the owner has to replace,
   * because the model has nothing truthful to say about it.
   */
  private varianceCommentary(facts: readonly Fact[]) {
    const budget = facts.find((f) => f.type === 'budget');
    const drivers = facts.filter((f) => f.type === 'driver');
    const sentences = drivers
      .slice(0, 3)
      .map(
        (d, i) =>
          `${i === 0 ? 'The forecast is above authorized because' : 'It is also affected by'} ${d.label} ({{figure:driver_${i}}}).`,
      );
    if (!sentences.length)
      sentences.push('I found no record in BudgetFlow that explains this variance.');
    const unexplained = num(budget, 'unexplainedMinor');
    return {
      text: sentences.join(' '),
      needsExplanation: unexplained > 0,
      confidence: drivers.length >= 2 ? 'high' : drivers.length === 1 ? 'medium' : 'low',
    };
  }

  private anomalyExplain(facts: readonly Fact[]) {
    const subject = facts.find(
      (f) => f.type === 'request' || f.type === 'actual' || f.type === 'document',
    );
    const kind = str(subject, 'kind') ?? 'possible_split';
    const currency = str(subject, 'currency') ?? 'USD';
    const findings: Record<string, string> = {
      possible_split: `${subject?.label ?? 'These requests'} together come to ${formatMinor(num(subject, 'combinedMinor'), currency)}, above the limit of ${formatMinor(num(subject, 'limitMinor'), currency)}, and were raised ${num(subject, 'daysApart')} days apart.`,
      possible_duplicate: `${subject?.label ?? 'This record'} repeats an amount of ${formatMinor(num(subject, 'amountMinor'), currency)} ${num(subject, 'daysApart')} days apart.`,
      receipt_reused: `The same receipt image appears on two records, ${formatBps(num(subject, 'imageSimilarityBps'))} similar.`,
      unusual_cost_per_head: `${subject?.label ?? 'This request'} is ${formatMinor(num(subject, 'perHeadMinor'), currency)} per head for ${num(subject, 'attendees')} people, against a median of ${formatMinor(num(subject, 'peerMedianMinor'), currency)} across ${num(subject, 'peerGroupSize')} similar events.`,
      unusual_vendor: `${subject?.label ?? 'This record'} charges ${formatMinor(num(subject, 'amountMinor'), currency)} to a category this vendor does not usually serve.`,
    };
    return {
      finding: findings[kind] ?? findings['possible_split'],
      confidence:
        kind === 'unusual_vendor' ? 'low' : kind === 'unusual_cost_per_head' ? 'medium' : 'high',
    };
  }
}

// Helpers ------------------------------------------------------------------------------------------

const num = (fact: Fact | undefined, key: string): number => {
  const v = fact?.fields[key];
  return typeof v === 'number' ? v : 0;
};

const str = (fact: Fact | undefined, key: string): string | null => {
  const v = fact?.fields[key];
  return typeof v === 'string' ? v : null;
};

/** Writes a fact value as money. The provider never computes a figure, it only formats one. */
function formatMinor(minor: number, currency: string): string {
  const major = (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}

const formatBps = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

function followUpsFor(prompt: string, budgets: readonly Fact[]): string[] {
  const out = ['Show the pending requests'];
  if (budgets.length > 1) out.push('Compare these budgets');
  if (/left|available|remaining/i.test(prompt)) out.push('What is committed but not spent yet?');
  return out.slice(0, 3);
}

/**
 * Recorded extraction answers keyed by the seeded file name, so receipt and quote extraction is
 * reproducible offline. Card digits, signatures and contact details are never among the fields.
 */
const RECORDED_DOCUMENTS: Record<
  string,
  readonly { field: string; value: string | null; confidence: 'high' | 'medium' | 'low' }[]
> = {
  'receipt-cafe-mocha.pdf': [
    { field: 'merchant', value: 'Cafe Mocha, Indiranagar', confidence: 'high' },
    { field: 'receiptDate', value: '2026-10-18', confidence: 'high' },
    { field: 'totalMinor', value: '456000', confidence: 'high' },
    { field: 'taxNote', value: 'GST included', confidence: 'medium' },
    { field: 'paymentMethod', value: 'Card payment', confidence: 'medium' },
  ],
  'receipt-westlake-hotel.pdf': [
    { field: 'merchant', value: 'Hotel Westlake', confidence: 'high' },
    { field: 'receiptDate', value: '2026-11-03', confidence: 'high' },
    { field: 'totalMinor', value: '124000', confidence: 'high' },
    { field: 'taxNote', value: null, confidence: 'low' },
  ],
  'quote-deccan-kitchen.pdf': [
    { field: 'vendorName', value: 'Deccan Kitchen Co', confidence: 'high' },
    { field: 'totalMinor', value: '27900000', confidence: 'high' },
    { field: 'validUntil', value: '2026-11-15', confidence: 'high' },
    { field: 'depositPct', value: '30', confidence: 'medium' },
    { field: 'cancellationTerms', value: 'Free until 2026-11-25', confidence: 'medium' },
  ],
};
