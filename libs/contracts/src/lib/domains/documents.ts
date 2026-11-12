import { z } from 'zod';
import { Id, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

export const DOCUMENT_OWNER_TYPES = [
  'event',
  'request',
  'contribution',
  'commitment',
  'actual',
] as const;
export const DocumentOwnerType = z.enum(DOCUMENT_OWNER_TYPES);
export const DOCUMENT_KINDS = [
  'supporting',
  'receipt',
  'quotation',
  'invoice',
  'evidence',
] as const;
export const DocumentKind = z.enum(DOCUMENT_KINDS);

/** Allowed upload types and the size limit (checked on the declared type and on the file's signature). */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const DocumentContentType = z.enum(DOCUMENT_CONTENT_TYPES);
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const DocumentSummary = named(
  'DocumentSummary',
  z
    .object({
      id: Id,
      ownerType: DocumentOwnerType,
      ownerId: Id,
      kind: DocumentKind,
      fileName: z.string(),
      contentType: z.string(),
      sizeBytes: z.int(),
      status: z.enum(['pending', 'available']),
      uploadedByName: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A supporting document stored behind the DocumentStore.'),
);
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const DocumentList = named(
  'DocumentList',
  z.object({ items: z.array(DocumentSummary) }).strict(),
);

export const DocumentListQuery = z.object({ ownerType: DocumentOwnerType, ownerId: Id }).strict();

export const CreateDocumentUploadRequest = named(
  'CreateDocumentUploadRequest',
  z
    .object({
      ownerType: DocumentOwnerType,
      ownerId: Id,
      kind: DocumentKind.optional(),
      fileName: z.string().trim().min(1).max(200),
      contentType: DocumentContentType,
      sizeBytes: z.int().min(1).max(DOCUMENT_MAX_BYTES),
    })
    .strict()
    .describe(
      'Step 1 of an upload: declare the file; the response carries a short-lived signed URL.',
    ),
);

export const DocumentUpload = named(
  'DocumentUpload',
  z
    .object({
      document: DocumentSummary,
      uploadUrl: z.string().describe('Signed PUT URL (expires in 10 minutes).'),
      uploadHeaders: z.record(z.string(), z.string()).describe('Headers the PUT must send.'),
      expiresAt: IsoDateTime,
    })
    .strict(),
);

export const DocumentDownload = named(
  'DocumentDownload',
  z
    .object({
      url: z.string().describe('Signed GET URL (expires in 5 minutes).'),
      expiresAt: IsoDateTime,
    })
    .strict(),
);

const DocParams = z.object({ documentId: Id }).strict();

export type DocumentList = z.infer<typeof DocumentList>;
export type CreateDocumentUploadRequest = z.infer<typeof CreateDocumentUploadRequest>;
export type DocumentUpload = z.infer<typeof DocumentUpload>;
export type DocumentDownload = z.infer<typeof DocumentDownload>;

export const documentEndpoints = {
  listDocuments: {
    operationId: 'listDocuments',
    method: 'get',
    path: '/api/documents',
    summary: 'Documents attached to an event, request, contribution or commitment',
    tags: ['documents'],
    auth: true,
    query: DocumentListQuery,
    response: { status: 200, schema: DocumentList },
    errors: [400, 401, 403, 404],
  },
  createDocumentUpload: {
    operationId: 'createDocumentUpload',
    method: 'post',
    path: '/api/documents/uploads',
    summary: 'Declare an upload (allowlisted type and size) and get a signed upload URL',
    tags: ['documents'],
    auth: true,
    idempotent: true,
    body: CreateDocumentUploadRequest,
    response: { status: 201, schema: DocumentUpload },
    errors: [400, 401, 403, 404, 422],
  },
  completeDocumentUpload: {
    operationId: 'completeDocumentUpload',
    method: 'post',
    path: '/api/documents/{documentId}/complete',
    summary: 'Verify the uploaded file (size, type signature) and make it available',
    tags: ['documents'],
    auth: true,
    idempotent: true,
    params: DocParams,
    response: { status: 200, schema: DocumentSummary },
    errors: [400, 401, 403, 404, 409, 422],
  },
  downloadDocument: {
    operationId: 'downloadDocument',
    method: 'get',
    path: '/api/documents/{documentId}/download',
    summary: 'A short-lived signed download URL',
    tags: ['documents'],
    auth: true,
    params: DocParams,
    response: { status: 200, schema: DocumentDownload },
    errors: [401, 403, 404, 409],
  },
} as const satisfies Record<string, Endpoint>;
