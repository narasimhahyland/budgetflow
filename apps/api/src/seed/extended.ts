import { DB, nowUtc } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import {
  P15_ALLOWANCE,
  P15_AWARD_TYPES,
  P15_SCENARIO,
  P15_THANK_NOTES,
  P15_WALLET_PROGRAMS,
  TENANTS,
  momentsAgo,
  quarterKey,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';

/**
 * Phase 15 fixtures: a draft what-if scenario, two wallet programmes, the recognition award types a
 * location offers with its manager allowance, and two thank-you notes for an organizer. Idempotent.
 *
 * Nothing here posts to the ledger. The scenario is a draft (so by definition it has moved nothing),
 * the wallet programmes and award types are configuration, the allowance is a cap and the notes
 * carry no amount. Claims and awards are made by the scenarios in `apps/api-e2e`, which exercises
 * the real commands rather than writing their effects by hand.
 */
export async function seedExtended(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const tenantId = TENANTS.acme;

  await withTenant(db, { tenantId, subject: 'seed' }, async (tx) => {
    const budgetCurrency = async (budgetId: string): Promise<string> => {
      const [row] = await tx
        .select({ currency: s.budgets.currency, fiscalYearId: s.budgets.fiscalYearId })
        .from(s.budgets)
        .where(and(eq(s.budgets.tenantId, tenantId), eq(s.budgets.id, budgetId)));
      return row?.currency ?? 'USD';
    };
    const fiscalYearOf = async (budgetId: string): Promise<string | null> => {
      const [row] = await tx
        .select({ fiscalYearId: s.budgets.fiscalYearId })
        .from(s.budgets)
        .where(and(eq(s.budgets.tenantId, tenantId), eq(s.budgets.id, budgetId)));
      return row?.fiscalYearId ?? null;
    };

    for (const program of P15_WALLET_PROGRAMS) {
      const fiscalYearId = await fiscalYearOf(program.fundingBudgetId);
      if (!fiscalYearId) continue;
      await tx
        .insert(s.walletPrograms)
        .values({
          id: program.id,
          tenantId,
          key: program.key,
          name: program.name,
          kind: program.kind,
          fundingBudgetId: program.fundingBudgetId,
          fiscalYearId,
          yearlyAllowanceMinor: program.yearlyAllowanceMinor,
          currency: await budgetCurrency(program.fundingBudgetId),
          categories: program.categories,
          eligibleEmploymentTypes: ['employee'],
          receiptRequired: true,
          taxable: program.taxable,
          carryUnused: program.carryUnused,
          reviewerPersonId: userById(program.reviewerUserId as never).personId,
          active: true,
        })
        .onConflictDoNothing();
    }

    for (const type of P15_AWARD_TYPES) {
      await tx
        .insert(s.recognitionAwardTypes)
        .values({
          id: type.id,
          tenantId,
          kind: type.kind,
          name: type.name,
          locationOrgUnitId: type.locationOrgUnitId,
          amountMinor: type.amountMinor,
          currency: type.fundingBudgetId ? await budgetCurrency(type.fundingBudgetId) : null,
          needsApproval: type.needsApproval,
          fundingBudgetId: type.fundingBudgetId,
          active: type.active,
        })
        .onConflictDoNothing();
    }

    const manager = userById(P15_ALLOWANCE.managerUserId as never);
    const granter = userById('budget-owner');
    if (manager.personId) {
      await tx
        .insert(s.recognitionAllowances)
        .values({
          id: P15_ALLOWANCE.id,
          tenantId,
          managerPersonId: manager.personId,
          fundingBudgetId: P15_ALLOWANCE.fundingBudgetId,
          // Relative, so the allowance always belongs to the quarter the stack is running in.
          // The pinned clock, not the real one: the recognition scenario computes the quarter from
          // the same instant (apps/api-e2e/src/support/clock.ts), so on 1 January the two would
          // otherwise disagree about which quarter the allowance belongs to.
          periodKey: quarterKey(nowUtc()),
          grantedMinor: P15_ALLOWANCE.grantedMinor,
          currency: await budgetCurrency(P15_ALLOWANCE.fundingBudgetId),
          grantedByPersonId: granter.personId,
          reason: P15_ALLOWANCE.reason,
        })
        .onConflictDoNothing();
    }

    const author = userById(P15_SCENARIO.authorUserId as never);
    // The baseline is taken after the rest of the seed has posted its journals, so the scenario opens
    // "up to date" rather than immediately stale.
    const [journals] = await tx
      .select({ n: count() })
      .from(s.ledgerJournals)
      .where(eq(s.ledgerJournals.tenantId, tenantId));
    await tx
      .insert(s.scenarios)
      .values({
        id: P15_SCENARIO.id,
        tenantId,
        name: P15_SCENARIO.name,
        note: P15_SCENARIO.note,
        status: 'draft',
        // Rendered as an absolute date under the relative-time mask, which hides the glyphs but not
        // their width, so a real-time value could reflow the row as the day of the month changes.
        baselineAt: nowUtc(),
        baselineJournalCount: Number(journals?.n ?? 0),
        createdByPersonId: author.personId,
      })
      .onConflictDoNothing();
    for (const change of P15_SCENARIO.changes) {
      await tx
        .insert(s.scenarioChanges)
        .values({
          id: change.id,
          tenantId,
          scenarioId: P15_SCENARIO.id,
          kind: change.kind,
          budgetId: change.budgetId,
          percentBps: 'percentBps' in change ? change.percentBps : null,
          currency: await budgetCurrency(change.budgetId),
          destination: 'destination' in change ? change.destination : null,
          destinationBudgetId: 'destinationBudgetId' in change ? change.destinationBudgetId : null,
          cascade: false,
          position: change.position,
        })
        .onConflictDoNothing();
    }
    for (const collaborator of P15_SCENARIO.collaboratorUserIds) {
      const person = userById(collaborator as never);
      if (!person.personId) continue;
      await tx
        .insert(s.scenarioCollaborators)
        .values({ tenantId, scenarioId: P15_SCENARIO.id, personId: person.personId })
        .onConflictDoNothing();
    }

    for (const note of P15_THANK_NOTES) {
      const organizer = userById(note.organizerUserId as never);
      const noteAuthor = userById(note.authorUserId as never);
      if (!organizer.personId || !noteAuthor.personId) continue;
      await tx
        .insert(s.organizerThankNotes)
        .values({
          id: note.id,
          tenantId,
          organizerPersonId: organizer.personId,
          authorPersonId: noteAuthor.personId,
          note: note.note,
          visibility: 'public',
          createdAt: momentsAgo(note.daysAgo, nowUtc()),
        })
        .onConflictDoNothing();
    }
  });
}
