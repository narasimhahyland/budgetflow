import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, pk, tenantRef, ts } from './_columns';
import { people } from './org';
import { tenants } from './tenancy';

/**
 * Supporting documents (receipts, quotations, invoices, approval evidence) stored behind the
 * DocumentStore (MinIO locally). The object key is tenant-scoped; the file name is display only.
 */
export const documents = pgTable(
  'documents',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    ownerType: varchar('owner_type', { length: 30 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    kind: varchar('kind', { length: 30 }).notNull().default('supporting'),
    fileName: text('file_name').notNull(),
    contentType: varchar('content_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull(),
    /** `pending` until the uploaded object is verified (size, declared and sniffed type), then `available`. */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    verifiedAt: ts('verified_at'),
    uploadedByPersonId: uuid('uploaded_by_person_id').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('documents_owner').on(t.tenantId, t.ownerType, t.ownerId),
    uniqueIndex('documents_storage_key').on(t.storageKey),
  ],
);
