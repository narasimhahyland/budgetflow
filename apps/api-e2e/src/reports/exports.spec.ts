// Gap A1 report exports: a CSV, XLSX or PDF file is rendered from the same run the screen makes,
// with the requester's filters and scope, stored under the tenant's own DocumentStore prefix and
// fetched through a five-minute signed link. CSV cells neutralise formulas, every export writes one
// audit event carrying the file's digest, and scheduled email deliveries carry the files attached.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import {
  AuditEventList,
  ReportExport,
  ReportExportDownload,
  ReportExportList,
  ReportResult,
  ReportSchedule,
  ScheduleRun,
  ScheduleRunList,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { createHash, randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { env } from '../support/env';
import { allocateOk, createChild, createRoot } from '../support/factory';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** `-123456` minor units with exponent 2 as `-1234.56`: what the file must carry. */
const decimal = (minor: number, exp = 2) => {
  const digits = Math.abs(minor)
    .toString()
    .padStart(exp + 1, '0');
  return `${minor < 0 ? '-' : ''}${digits.slice(0, digits.length - exp)}${exp ? `.${digits.slice(-exp)}` : ''}`;
};

/** A CSV with quoted cells (RFC 4180), parsed back into rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') continue;
    else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** The entries of a zip with stored (uncompressed) entries, which is how XLSX files are written. */
function unzipStored(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    expect(buf.readUInt16LE(at + 8), 'stored entry').toBe(0);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size).toString('utf8'));
    at = start + size;
  }
  return out;
}

async function exportOf(
  request: APIRequestContext,
  role: Parameters<typeof as>[0],
  reportId: string,
  format: 'csv' | 'xlsx' | 'pdf',
  filters: Record<string, unknown> = {},
  key = randomUUID(),
) {
  return expectContract(
    await request.post(`/api/reports/${reportId}/exports`, {
      headers: await mutate(role, key),
      data: { format, filters },
    }),
    201,
    ReportExport,
  );
}

async function fileOf(
  request: APIRequestContext,
  role: Parameters<typeof as>[0],
  exportId: string,
): Promise<{ link: ReportExportDownload; body: Buffer }> {
  const link = await expectContract(
    await request.get(`/api/reports/exports/${exportId}/download`, { headers: await as(role) }),
    200,
    ReportExportDownload,
  );
  const fetched = await request.get(link.url);
  expect(fetched.status(), await fetched.text()).toBe(200);
  expect(fetched.headers()['content-disposition']).toContain(link.fileName);
  return { link, body: await fetched.body() };
}

async function exportedAudit(request: APIRequestContext, exportId: string) {
  const audit = await expectContract(
    await request.get(`/api/audit/events?resourceType=report_export&resourceId=${exportId}`, {
      headers: await as('auditor'),
    }),
    200,
    AuditEventList,
  );
  return audit.items.filter((e) => e.action === 'report.exported');
}

const mailpit = () => `http://localhost:${env('BF_MAILPIT_PORT')}`;

interface MailAttachment {
  PartID: string;
  FileName: string;
  ContentType: string;
  Size: number;
}

/** The newest email to `to` whose subject contains `subject`, with its attachments' bytes. */
async function mailWithAttachments(
  to: string,
  subject: string,
): Promise<{ subject: string; files: Map<string, Buffer>; types: Map<string, string> }> {
  const ctx = await pwRequest.newContext();
  try {
    let id: string | undefined;
    await expect
      .poll(
        async () => {
          const res = await ctx.get(
            `${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
          );
          const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
          id = body.messages.find((m) => m.Subject.includes(subject))?.ID;
          return Boolean(id);
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    const msg = (await (await ctx.get(`${mailpit()}/api/v1/message/${id}`)).json()) as {
      Subject: string;
      Attachments: MailAttachment[];
    };
    const files = new Map<string, Buffer>();
    const types = new Map<string, string>();
    for (const a of msg.Attachments ?? []) {
      const part = await ctx.get(`${mailpit()}/api/v1/message/${id}/part/${a.PartID}`);
      files.set(a.FileName, await part.body());
      types.set(a.FileName, a.ContentType);
    }
    return { subject: msg.Subject, files, types };
  } finally {
    await ctx.dispose();
  }
}

async function mailCount(to: string, subject: string): Promise<number> {
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.get(
      `${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
    );
    const body = (await res.json()) as { messages: { Subject: string }[] };
    return body.messages.filter((m) => m.Subject.includes(subject)).length;
  } finally {
    await ctx.dispose();
  }
}

test.describe('report file exports (A1)', () => {
  // A subtree only the department head owns. Its root's name starts with a formula, so the CSV
  // must neutralise it, and the scoped files must carry exactly these two budgets.
  let rootId: string;
  let childId: string;
  let rootName: string;

  test.beforeAll(async ({ request }) => {
    rootName = `=SUM(1,2) A1 export root ${randomUUID().slice(0, 6)}`;
    const root = await createRoot(request, {
      amountMinor: 900_000,
      owner: 'department-head',
      name: rootName,
    });
    const child = await createChild(request, root.id, {
      currency: 'USD',
      as: 'finance-admin',
      owner: 'department-head',
    });
    await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 250_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    rootId = root.id;
    childId = child.id;
  });

  test('a CSV carries the screen run row for row, money in major units, formulas neutralised', async ({
    request,
  }) => {
    const screen = await expectContract(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${rootId}&limit=500`, {
        headers: await as('department-head'),
      }),
      200,
      ReportResult,
    );
    expect(screen.rows.map((r) => r.budgetId).sort()).toEqual([rootId, childId].sort());

    const exported = await exportOf(request, 'department-head', 'utilization', 'csv', {
      rootBudgetId: rootId,
    });
    expect(exported.status).toBe('ready');
    expect(exported.rowCount).toBe(2);
    expect(exported.fileName).toMatch(/^utilization-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.csv$/);

    const { link, body } = await fileOf(request, 'department-head', exported.id);
    // Short-lived, signed, and under this tenant's own prefix.
    expect(link.url).toContain('X-Amz-Signature');
    expect(link.url).toContain(`/tenants/${SEED.tenants.acme}/report-exports/${exported.id}.csv`);
    const ttl = Date.parse(link.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(body.length).toBe(exported.sizeBytes);

    const text = body.toString('utf8');
    const rows = parseCsv(text);
    const header = rows[0];
    expect(header).toEqual(
      screen.columns.map((c) =>
        c.type === 'money'
          ? `${c.label} (${screen.currency})`
          : c.type === 'percent'
            ? `${c.label} (%)`
            : c.label,
      ),
    );
    const body2 = rows.slice(1, 1 + screen.rows.length);
    expect(body2.map((r) => r[0])).toEqual(
      screen.rows.map((r) => (r.label.startsWith('=') ? `'${r.label}` : r.label)),
    );
    // The formula-looking name is text in the file, never a formula.
    expect(text).toContain(`"'${rootName}"`);
    expect(text).not.toMatch(/(^|,)=SUM/m);

    // Every money cell is the run's amount in major units of the reporting currency.
    for (const [i, row] of screen.rows.entries())
      for (const [c, col] of screen.columns.entries()) {
        const cell = row.cells[col.key];
        if (cell?.money)
          expect(body2[i][c], `${row.label} ${col.key}`).toBe(decimal(cell.money.amountMinor));
      }
    if (screen.totals) expect(rows[1 + screen.rows.length][0]).toBe('Total');
  });

  test('an XLSX holds the same table with typed number cells and an About sheet', async ({
    request,
  }) => {
    const screen = await expectContract(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${rootId}`, {
        headers: await as('department-head'),
      }),
      200,
      ReportResult,
    );
    const exported = await exportOf(request, 'department-head', 'utilization', 'xlsx', {
      rootBudgetId: rootId,
    });
    const { body } = await fileOf(request, 'department-head', exported.id);
    expect(body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);

    const zip = unzipStored(body);
    expect([...zip.keys()]).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ]),
    );
    expect(zip.get('xl/workbook.xml')).toContain('name="Report"');
    expect(zip.get('xl/workbook.xml')).toContain('name="About"');
    const sheet = zip.get('xl/worksheets/sheet1.xml')!;
    // Text is an inline string, which a spreadsheet never evaluates; there are no formulas at all.
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain(`<t>${rootName.replace(/&/g, '&amp;')}</t>`);
    const authorized = screen.rows.find((r) => r.budgetId === childId)!;
    const money = Object.values(authorized.cells).find((c) => c.money)!.money!;
    expect(sheet).toContain(`<v>${decimal(money.amountMinor)}</v>`);
    const about = zip.get('xl/worksheets/sheet2.xml')!;
    expect(about).toContain(screen.scope.label.replace(/&/g, '&amp;'));
    expect(about).toContain(`<t>Filter rootBudgetId</t>`);
    expect(about).toContain(`<t>${rootId}</t>`);
  });

  test('a PDF is a real paginated document carrying the rows', async ({ request }) => {
    const screen = await expectContract(
      await request.get('/api/reports/utilization/run?limit=500', {
        headers: await as('finance-controller'),
      }),
      200,
      ReportResult,
    );
    expect(screen.rows.length).toBeGreaterThan(0);
    const exported = await exportOf(request, 'finance-controller', 'utilization', 'pdf');
    expect(exported.rowCount).toBe(screen.rows.length);
    const { body } = await fileOf(request, 'finance-controller', exported.id);
    const text = body.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(1);
    // 50 lines a page: a tenant-wide run of this many rows needs at least this many pages.
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(exported.rowCount / 50));
    expect(text).toContain(`(${screen.name})`);
    expect(text).toContain(`page 1 of ${pages}`);
    // Every row label of the run is on a line of the document (long labels are shortened).
    // PDF strings escape parentheses and backslashes.
    const inPdf = (v: string) => v.slice(0, 8).replace(/([\\()])/g, '\\$1');
    for (const row of screen.rows) expect(text, row.label).toContain(inPdf(row.label));
    expect(text).toContain('Total');
  });

  test('a scoped owner exports only what they see and cannot reach other exports', async ({
    request,
  }) => {
    // Without filters the owner's file is their subtree alone; finance's file is the tenant.
    const owner = await exportOf(request, 'department-head', 'utilization', 'csv');
    const finance = await exportOf(request, 'finance-controller', 'utilization', 'csv');
    const ownerRun = await expectContract(
      await request.get('/api/reports/utilization/run?limit=500', {
        headers: await as('department-head'),
      }),
      200,
      ReportResult,
    );
    expect(owner.rowCount).toBe(ownerRun.rows.length);
    expect(finance.rowCount).toBeGreaterThan(owner.rowCount);
    const ownerRows = parseCsv(
      (await fileOf(request, 'department-head', owner.id)).body.toString('utf8'),
    );
    const labels = new Set(
      ownerRun.rows.map((r) => (r.label.startsWith('=') ? `'${r.label}` : r.label)),
    );
    for (const row of ownerRows.slice(1))
      if (row[0] !== 'Total') expect(labels.has(row[0]), row[0]).toBe(true);

    // The owner cannot widen the scope through an export either: same answer as the screen.
    await expectProblem(
      await request.post('/api/reports/utilization/exports', {
        headers: await mutate('location-manager'),
        data: { format: 'csv', filters: { rootBudgetId: SEED.budgets.europe } },
      }),
      404,
      'NOT_FOUND',
    );
    // A company-wide report is refused to the owner, not exported as a slice.
    await expectProblem(
      await request.post('/api/reports/spend-per-head/exports', {
        headers: await mutate('location-manager'),
        data: { format: 'csv', filters: {} },
      }),
      403,
      'FORBIDDEN',
    );
    // Someone else's file is not theirs to download; finance (tenant-wide) may fetch the owner's.
    await expectProblem(
      await request.get(`/api/reports/exports/${finance.id}/download`, {
        headers: await as('department-head'),
      }),
      403,
      'FORBIDDEN',
    );
    await fileOf(request, 'finance-controller', owner.id);
    // An employee has no reports area at all.
    await expectProblem(
      await request.get(`/api/reports/exports/${owner.id}/download`, {
        headers: await as('employee'),
      }),
      403,
      'FORBIDDEN',
    );
    // The owner's export list holds their own exports only.
    const listed = await expectContract(
      await request.get('/api/reports/exports', { headers: await as('department-head') }),
      200,
      ReportExportList,
    );
    expect(listed.items.map((i) => i.id)).toContain(owner.id);
    expect(listed.items.map((i) => i.id)).not.toContain(finance.id);
  });

  test('each export writes one audit event with the digest of the file, and a replay writes none', async ({
    request,
  }) => {
    const key = randomUUID();
    const first = await exportOf(
      request,
      'department-head',
      'utilization',
      'csv',
      { rootBudgetId: rootId },
      key,
    );
    const replay = await request.post('/api/reports/utilization/exports', {
      headers: await mutate('department-head', key),
      data: { format: 'csv', filters: { rootBudgetId: rootId } },
    });
    expect(replay.status()).toBe(201);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as { id: string }).id).toBe(first.id);

    const { body } = await fileOf(request, 'department-head', first.id);
    const events = await exportedAudit(request, first.id);
    expect(events).toHaveLength(1);
    expect(events[0].actorPersonId).toBe(userById('department-head').personId);
    expect(events[0].changes).toMatchObject({
      reportId: 'utilization',
      format: 'csv',
      filters: { rootBudgetId: rootId },
      rowCount: 2,
      fileName: first.fileName,
      sizeBytes: body.length,
      sha256: sha256(body),
    });
    expect(String(events[0].changes['scope'])).not.toBe('');

    // Each signed link handed out is audited too: one fetch so far, a second makes two.
    const downloads = async () => {
      const audit = await expectContract(
        await request.get(`/api/audit/events?resourceType=report_export&resourceId=${first.id}`, {
          headers: await as('auditor'),
        }),
        200,
        AuditEventList,
      );
      return audit.items.filter((e) => e.action === 'report.export_downloaded');
    };
    expect(await downloads()).toHaveLength(1);
    await fileOf(request, 'department-head', first.id);
    const after = await downloads();
    expect(after).toHaveLength(2);
    expect(after.every((e) => e.actorPersonId === userById('department-head').personId)).toBe(true);
  });

  test('an export recorded before files existed answers plainly instead of a broken link', async ({
    request,
  }) => {
    // The seeded India utilization export (screen 091) predates files: it was recorded only.
    const legacyId = SEED.p10.exports.indiaUtilizationPdf;
    const list = await expectContract(
      await request.get('/api/reports/exports', { headers: await as('finance-admin') }),
      200,
      ReportExportList,
    );
    expect(list.items.find((i) => i.id === legacyId)?.fileName).toBeNull();
    await expectProblem(
      await request.get(`/api/reports/exports/${legacyId}/download`, {
        headers: await as('finance-admin'),
      }),
      409,
      'REPORT_EXPORT_NO_FILE',
    );
  });

  test('a scheduled delivery attaches the files to recipients who can see the scope', async ({
    request,
  }) => {
    const name = `A1 delivery ${randomUUID().slice(0, 8)}`;
    const schedule = await expectContract(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: {
          name,
          reportId: 'utilization',
          filters: { rootBudgetId: rootId },
          formats: ['csv', 'xlsx'],
          frequency: 'weekly',
          weekday: 1,
          sendTime: '08:00',
          timezone: 'UTC',
          recipientPersonIds: [
            userById('department-head').personId!,
            userById('location-manager').personId!,
          ],
        },
      }),
      201,
      ReportSchedule,
    );
    const owner = schedule.recipients.find(
      (r) => r.personId === userById('department-head').personId,
    )!;
    const outsider = schedule.recipients.find(
      (r) => r.personId === userById('location-manager').personId,
    )!;
    expect(owner.hasAccess).toBe(true);
    expect(outsider.hasAccess).toBe(false);

    const run = await expectContract(
      await request.post(`/api/reports/schedules/${schedule.id}/runs`, {
        headers: await mutate('finance-admin'),
      }),
      202,
      ScheduleRun,
    );
    let done: ScheduleRun | undefined;
    await expect
      .poll(
        async () => {
          const list = await expectContract(
            await request.get(`/api/reports/schedules/${schedule.id}/runs`, {
              headers: await as('finance-admin'),
            }),
            200,
            ScheduleRunList,
          );
          done = list.items.find((r) => r.id === run.id);
          return done?.status;
        },
        { timeout: 45_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe('partly_delivered');
    expect(done!.deliveredCount).toBe(1);
    expect(done!.skippedCount).toBe(1);
    // One file per format for the run, not one per recipient.
    expect(done!.exportIds).toHaveLength(2);

    const exports = await expectContract(
      await request.get('/api/reports/exports', { headers: await as('finance-admin') }),
      200,
      ReportExportList,
    );
    const files = done!.exportIds.map((id) => exports.items.find((e) => e.id === id)!);
    expect(files.map((f) => f.format).sort()).toEqual(['csv', 'xlsx']);
    for (const f of files) {
      expect(f.scheduleId).toBe(schedule.id);
      expect(f.rowCount).toBe(2);
      expect(await exportedAudit(request, f.id)).toHaveLength(1);
    }

    // The recipient's email carries both files, byte for byte the stored exports.
    const mail = await mailWithAttachments(owner.email, name);
    expect([...mail.files.keys()].sort()).toEqual(files.map((f) => f.fileName!).sort());
    for (const f of files) {
      const stored = await fileOf(request, 'finance-admin', f.id);
      expect(sha256(mail.files.get(f.fileName!)!)).toBe(sha256(stored.body));
    }
    const csv = files.find((f) => f.format === 'csv')!;
    expect(mail.types.get(csv.fileName!)).toBe('text/csv');
    const csvRows = parseCsv(mail.files.get(csv.fileName!)!.toString('utf8'));
    expect(csvRows.slice(1).map((r) => r[0])).toEqual(expect.arrayContaining([`'${rootName}`]));

    // The person who cannot see the scope got nothing.
    expect(await mailCount(outsider.email, name)).toBe(0);

    await request.delete(`/api/reports/schedules/${schedule.id}`, {
      headers: await mutate('finance-admin'),
    });
  });
});
