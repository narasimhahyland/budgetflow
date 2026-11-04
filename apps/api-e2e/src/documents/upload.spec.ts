// Documents behind the DocumentStore (MinIO): uploads are declared first (allowlisted type and size),
// stored under a tenant-scoped key through a short-lived signed URL, and only become available once the
// object's size and leading bytes match the declaration; downloads are signed URLs for people who may see
// the owning record.
import { expect, request as pwRequest, test } from '@playwright/test';
import { DocumentList, DocumentSummary, DocumentUpload, RequestDetail } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { directorTree, spendingRequest, usd } from '../support/p5';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

test.describe('documents on the DocumentStore', () => {
  test('declare, upload, verify and download; wrong type, size and owner are refused', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(20_000)),
      201,
      RequestDetail,
    );
    const declare = async (user: Parameters<typeof mutate>[0], data: Record<string, unknown>) =>
      request.post('/api/documents/uploads', {
        headers: await mutate(user),
        data: {
          ownerType: 'request',
          ownerId: r.id,
          fileName: 'quote.pdf',
          contentType: 'application/pdf',
          sizeBytes: PDF.length,
          ...data,
        },
      });
    const put = async (
      u: { uploadUrl: string; uploadHeaders: Record<string, string> },
      body: Buffer,
    ) => {
      const ctx = await pwRequest.newContext();
      const res = await ctx.put(u.uploadUrl, { headers: u.uploadHeaders, data: body });
      await ctx.dispose();
      return res.status();
    };
    const complete = async (id: string, user: Parameters<typeof mutate>[0] = 'budget-owner') =>
      request.post(`/api/documents/${id}/complete`, { headers: await mutate(user) });

    const upload = await expectContract(
      await declare('budget-owner', { kind: 'quotation' }),
      201,
      DocumentUpload,
    );
    expect(upload.document.status).toBe('pending');
    expect(upload.uploadUrl).toContain(`/tenants/${SEED.tenants.acme}/request/${r.id}/`);
    expect(upload.uploadUrl).not.toContain('quote.pdf');
    await expectProblem(await complete(upload.document.id), 409, 'DOCUMENT_NOT_UPLOADED');
    expect(await put(upload, PDF)).toBe(200);
    const ready = await expectContract(await complete(upload.document.id), 200, DocumentSummary);
    expect(ready).toMatchObject({ status: 'available', kind: 'quotation', sizeBytes: PDF.length });

    // The approver above (Lena) sees it on the request; an unrelated director does not.
    const lena = await expectContract(
      await request.get(`/api/documents?ownerType=request&ownerId=${r.id}`, {
        headers: await as('department-head'),
      }),
      200,
      DocumentList,
    );
    expect(lena.items.map((d) => d.id)).toEqual([ready.id]);
    expect(
      (
        await request.get(`/api/documents?ownerType=request&ownerId=${r.id}`, {
          headers: await as('regional-manager'),
        })
      ).status(),
    ).toBe(404);
    const detail = await expectContract(
      await request.get(`/api/requests/${r.id}`, { headers: await as('budget-owner') }),
      200,
      RequestDetail,
    );
    expect(detail.documents.map((d) => d.fileName)).toEqual(['quote.pdf']);

    const dl = (await (
      await request.get(`/api/documents/${ready.id}/download`, {
        headers: await as('department-head'),
      })
    ).json()) as { url: string };
    const ctx = await pwRequest.newContext();
    const file = await ctx.get(dl.url);
    expect(file.status()).toBe(200);
    expect(Buffer.from(await file.body()).equals(PDF)).toBe(true);
    expect(file.headers()['content-disposition']).toContain('attachment');
    await ctx.dispose();

    // Declared PNG, uploaded PDF bytes: the signature does not match.
    const fake = await expectContract(
      await declare('budget-owner', { fileName: 'receipt.png', contentType: 'image/png' }),
      201,
      DocumentUpload,
    );
    expect(await put(fake, PDF)).toBe(200);
    await expectProblem(await complete(fake.document.id), 422, 'DOCUMENT_TYPE_NOT_ALLOWED');
    // Declared size differs from the uploaded object.
    const short = await expectContract(
      await declare('budget-owner', { sizeBytes: PDF.length + 10 }),
      201,
      DocumentUpload,
    );
    expect(await put(short, PDF)).toBe(200);
    await expectProblem(await complete(short.document.id), 422, 'DOCUMENT_TOO_LARGE');
    // Not on the allowlist, too large, or not the requester's record.
    expect((await declare('budget-owner', { contentType: 'application/zip' })).status()).toBe(400);
    expect((await declare('budget-owner', { sizeBytes: 11 * 1024 * 1024 })).status()).toBe(400);
    expect((await declare('department-head', {})).status()).toBe(403);
  });
});
