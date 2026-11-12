// Phase 13 scenario support. Matching scenarios own their data: each one creates a budget on an
// otherwise unused cost centre and imports a spend line against it, so the AI ranker has exactly one
// plausible target and running the file again never depends on what an earlier run consumed.
import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  ActualDetail,
  ActualList,
  AiMatchSuggestion,
  AiMatchSuggestionList,
  AiSettingsView,
  BudgetDetail,
  DocumentSummary,
  DocumentUpload,
  RequestDetail,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { createRoot } from '../support/plan-root';
import { allocate } from '../support/factory';
import { directorTree, spendingRequest, usd } from '../support/p5';
import { csv, importAndPost } from '../actuals/support';

/**
 * The product default is 50 questions per person per hour (113a). These scenarios ask on behalf of a
 * handful of seeded people and are meant to be repeatable within the hour, so they run at the
 * documented maximum instead. The limit itself still applies.
 */
export async function relaxAskLimit(request: APIRequestContext): Promise<void> {
  const current = await expectContract(
    await request.get('/api/ai/settings', { headers: await as('org-admin') }),
    200,
    AiSettingsView,
  );
  if (current.settings.questionsPerPersonPerHour === 200) return;
  await expectContract(
    await request.put('/api/ai/settings', {
      headers: await mutate('org-admin', randomUUID()),
      data: { ...current.settings, questionsPerPersonPerHour: 200 },
    }),
    200,
    AiSettingsView,
  );
}

/** A cost centre no seeded budget uses, so only this scenario's budget can be suggested. */
const COST_CENTRE_CODE = 'CC-IN-BLR-220';

/** A budget on the scenario's own cost centre, funded and owned by the budget owner. */
export async function budgetOnOwnCostCentre(request: APIRequestContext): Promise<BudgetDetail> {
  const root = await createRoot(request, {
    amountMinor: 20_000_000,
    name: `P13 root ${randomUUID().slice(0, 6)}`,
  });
  const costCenterId = await costCentreId(request);
  const child = await expectContract(
    await request.post('/api/budgets', {
      headers: await mutate('ceo'),
      data: {
        name: `P13 matching ${randomUUID().slice(0, 6)}`,
        parentId: root.id,
        legalEntityId: SEED.legalEntities.acmeIndia,
        costCenterId,
        currency: 'USD',
        fiscalYearId: SEED.fiscalYears.acmeFy2026,
        ownerPersonId: userById('budget-owner').personId,
      },
    }),
    201,
    BudgetDetail,
  );
  await allocate(request, root.id, child.id, { amountMinor: 5_000_000, currency: 'USD' });
  return child;
}

async function costCentreId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/org/cost-centers', { headers: await as('finance-admin') });
  expect(res.status(), 'the cost centre list is readable').toBe(200);
  const body = (await res.json()) as { items: { id: string; code: string }[] };
  const centre = body.items.find((c) => c.code === COST_CENTRE_CODE);
  expect(
    centre,
    `${COST_CENTRE_CODE} exists in the seed and no seeded budget uses it`,
  ).toBeDefined();
  return centre!.id;
}

/**
 * An unmatched spend line on the scenario's own budget: no event code and no mapping rule, so the
 * deterministic matching steps leave it for the AI ranker exactly as 080f describes.
 */
export async function unmatchedLine(
  request: APIRequestContext,
): Promise<{ budget: BudgetDetail; actual: ActualDetail }> {
  const budget = await budgetOnOwnCostCentre(request);
  const ref = `P13-${randomUUID().slice(0, 8).toUpperCase()}`;
  // A distinct amount and date per scenario, so the Phase 6 cross-source duplicate check never holds
  // the line (080f never suggests a held duplicate, which would leave the scenario with nothing).
  const amount = (200 + Math.floor(Math.random() * 8000) / 100).toFixed(2);
  const day = String(2 + Math.floor(Math.random() * 25)).padStart(2, '0');
  await importAndPost(
    request,
    csv([
      `${ref},2026-11-${day},${amount},USD,HYL-IN,${COST_CENTRE_CODE},6100,,,AI matching scenario,,,charge`,
    ]),
  );
  const list = await expectContract(
    await request.get(`/api/actuals?status=all&q=${encodeURIComponent(ref)}`, {
      headers: await as('finance-admin'),
    }),
    200,
    ActualList,
  );
  const line = list.items.find((i) => i.sourceRef === ref);
  expect(line, `the imported line ${ref} is in the queue`).toBeDefined();
  const actual = await expectContract(
    await request.get(`/api/actuals/${line!.id}`, { headers: await as('finance-admin') }),
    200,
    ActualDetail,
  );
  expect(actual.actual.status, 'the deterministic steps left it unmatched').toBe('unmatched');
  return { budget, actual };
}

/** Runs the ranker for one line and returns the suggestion it produced for it. */
export async function suggestionFor(
  request: APIRequestContext,
  actualId: string,
): Promise<AiMatchSuggestion> {
  await expectContract(
    await request.post('/api/ai/matching-suggestions/run', {
      headers: await as('finance-admin'),
      data: { actualIds: [actualId] },
    }),
    200,
    AiMatchSuggestionList,
  );
  const list = await expectContract(
    await request.get('/api/ai/matching-suggestions?status=open', {
      headers: await as('finance-admin'),
    }),
    200,
    AiMatchSuggestionList,
  );
  const suggestion = list.items.find((i) => i.actualId === actualId);
  expect(suggestion, 'the ranker produced a suggestion for this line').toBeDefined();
  return suggestion!;
}

/** AI scenarios call Amazon Bedrock through the running API, so they only run when asked to. */
export const AI_LIVE = Boolean(process.env['BF_AI_LIVE']);
export const AI_LIVE_REASON =
  'AI scenarios call Amazon Bedrock. Set BF_AI_LIVE=1 with AWS credentials in the API environment to run them.';

/** A one-page PDF with real text, so the model has an actual receipt to read. */
export function receiptPdf(lines: readonly string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 14 Tf 50 750 Td 18 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Uploads a real receipt through the product's own flow and returns the verified document id. */
export async function uploadReceipt(
  request: APIRequestContext,
  fileName: string,
  lines: readonly string[],
): Promise<string> {
  const { team } = await directorTree(request);
  const owner = await expectContract(
    await spendingRequest(request, 'budget-owner', team.id, usd(20_000)),
    201,
    RequestDetail,
  );
  const pdf = receiptPdf(lines);
  const upload = await expectContract(
    await request.post('/api/documents/uploads', {
      headers: await mutate('budget-owner'),
      data: {
        ownerType: 'request',
        ownerId: owner.id,
        kind: 'receipt',
        fileName,
        contentType: 'application/pdf',
        sizeBytes: pdf.length,
      },
    }),
    201,
    DocumentUpload,
  );
  const ctx = await pwRequest.newContext();
  const put = await ctx.put(upload.uploadUrl, { headers: upload.uploadHeaders, data: pdf });
  await ctx.dispose();
  expect(put.status()).toBe(200);
  const ready = await expectContract(
    await request.post(`/api/documents/${upload.document.id}/complete`, {
      headers: await mutate('budget-owner'),
    }),
    200,
    DocumentSummary,
  );
  return ready.id;
}
