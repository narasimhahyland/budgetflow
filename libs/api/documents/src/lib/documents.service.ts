import { ApiProblem, CommandRunner, DB, type CommandResult, type RequestActor } from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import { documents, people, withTenant, type Db, type Tx } from '@bf/api/db';
import {
  DOCUMENT_MAX_BYTES,
  type CreateDocumentUploadRequest,
  type DocumentDownload,
  type DocumentSummary,
  type DocumentUpload,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { matchesSignature, S3DocumentStore } from './document-store';

export type DocumentOwnerType = 'event' | 'request' | 'contribution' | 'commitment';

/** Each owning module says who may read and attach documents to its records. */
export interface DocumentOwner {
  type: DocumentOwnerType;
  canRead(tx: Tx, actor: RequestActor, id: string): Promise<boolean>;
  canWrite(tx: Tx, actor: RequestActor, id: string): Promise<boolean>;
}

type DocumentRow = typeof documents.$inferSelect;

const UPLOAD_TTL = 600;
const DOWNLOAD_TTL = 300;

/**
 * Supporting documents behind the DocumentStore: an upload is declared first (allowlisted type and
 * size, tenant-scoped key, signed PUT URL), then verified (object size and leading bytes must match
 * the declaration) before it becomes available. Downloads are short-lived signed URLs.
 */
@Injectable()
export class DocumentsService {
  private readonly owners = new Map<DocumentOwnerType, DocumentOwner>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly store: S3DocumentStore,
  ) {}

  registerOwner(owner: DocumentOwner): void {
    this.owners.set(owner.type, owner);
  }

  private owner(type: string): DocumentOwner {
    const o = this.owners.get(type as DocumentOwnerType);
    if (!o) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Documents cannot be attached to this.');
    return o;
  }

  private async toSummaries(tx: Tx, rows: DocumentRow[]): Promise<DocumentSummary[]> {
    const ids = [
      ...new Set(rows.map((r) => r.uploadedByPersonId).filter((x): x is string => Boolean(x))),
    ];
    const names = ids.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, n: people.displayName })
              .from(people)
              .where(inArray(people.id, ids))
          ).map((p) => [p.id, p.n]),
        )
      : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      ownerType: r.ownerType as DocumentOwnerType,
      ownerId: r.ownerId,
      kind: r.kind as DocumentSummary['kind'],
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      status: r.status as 'pending' | 'available',
      uploadedByName: r.uploadedByPersonId ? (names.get(r.uploadedByPersonId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Available documents of an owner, for detail views (the caller has authorized the owner). */
  async listTx(
    tx: Tx,
    ownerType: string,
    ownerId: string,
    viewerId?: string | null,
  ): Promise<DocumentSummary[]> {
    const rows = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.ownerType, ownerType),
          eq(documents.ownerId, ownerId),
          viewerId
            ? or(eq(documents.status, 'available'), eq(documents.uploadedByPersonId, viewerId))
            : eq(documents.status, 'available'),
        ),
      )
      .orderBy(asc(documents.createdAt));
    return this.toSummaries(tx, rows);
  }

  list(
    actor: RequestActor,
    ownerType: string,
    ownerId: string,
  ): Promise<{ items: DocumentSummary[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!(await this.owner(ownerType).canRead(tx, actor, ownerId)))
        throw ApiProblem.notFound(ownerType);
      return { items: await this.listTx(tx, ownerType, ownerId, actor.personId) };
    });
  }

  createUpload(
    actor: RequestActor,
    req: CreateDocumentUploadRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<DocumentUpload>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'documents.upload',
        request: req,
        status: 201,
      },
      async (tx) => {
        const owner = this.owner(req.ownerType);
        if (!(await owner.canRead(tx, actor, req.ownerId)))
          throw ApiProblem.notFound(req.ownerType);
        if (!(await owner.canWrite(tx, actor, req.ownerId)))
          throw ApiProblem.forbidden('You cannot attach documents to this.');
        if (req.sizeBytes > DOCUMENT_MAX_BYTES) {
          throw new ApiProblem(422, 'DOCUMENT_TOO_LARGE', 'Documents can be at most 10 MB.', {
            maxBytes: DOCUMENT_MAX_BYTES,
          });
        }
        const id = randomUUID();
        const key = `tenants/${actor.tenantId}/${req.ownerType}/${req.ownerId}/${id}`;
        const [row] = await tx
          .insert(documents)
          .values({
            id,
            tenantId: actor.tenantId,
            ownerType: req.ownerType,
            ownerId: req.ownerId,
            kind: req.kind ?? 'supporting',
            fileName: req.fileName,
            contentType: req.contentType,
            sizeBytes: req.sizeBytes,
            sha256: '',
            storageKey: key,
            status: 'pending',
            uploadedByPersonId: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'document.upload_requested',
          resourceType: req.ownerType,
          resourceId: req.ownerId,
          requestId: ctx.requestId,
          changes: {
            documentId: { from: null, to: id },
            contentType: { from: null, to: req.contentType },
            sizeBytes: { from: null, to: req.sizeBytes },
          },
        });
        await this.store.prepare().catch(() => {
          throw new ApiProblem(
            503,
            'DOCUMENT_STORE_UNAVAILABLE',
            'The document store is unavailable; try again.',
          );
        });
        return {
          document: (await this.toSummaries(tx, [row]))[0],
          uploadUrl: this.store.uploadUrl(key, req.contentType, UPLOAD_TTL),
          uploadHeaders: { 'content-type': req.contentType },
          expiresAt: new Date(Date.now() + UPLOAD_TTL * 1000).toISOString(),
        };
      },
    );
  }

  complete(
    actor: RequestActor,
    documentId: string,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<DocumentSummary>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `documents.complete:${documentId}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const [doc] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, documentId))
          .for('update');
        if (!doc) throw ApiProblem.notFound('document');
        const owner = this.owner(doc.ownerType);
        if (!(await owner.canRead(tx, actor, doc.ownerId))) throw ApiProblem.notFound('document');
        if (doc.uploadedByPersonId !== actor.personId)
          throw ApiProblem.forbidden('Only the uploader can complete an upload.');
        if (doc.status === 'available') return (await this.toSummaries(tx, [doc]))[0];
        const head = await this.store.head(doc.storageKey);
        if (!head)
          throw new ApiProblem(409, 'DOCUMENT_NOT_UPLOADED', 'The file has not been uploaded yet.');
        if (head.sizeBytes > DOCUMENT_MAX_BYTES || head.sizeBytes !== doc.sizeBytes) {
          await this.store.remove(doc.storageKey);
          throw new ApiProblem(
            422,
            'DOCUMENT_TOO_LARGE',
            'The uploaded file is not the declared size (10 MB at most).',
            {
              declaredBytes: doc.sizeBytes,
              uploadedBytes: head.sizeBytes,
            },
          );
        }
        const body = await this.store.readStart(doc.storageKey, head.sizeBytes);
        if (!matchesSignature(doc.contentType, body.subarray(0, 16))) {
          await this.store.remove(doc.storageKey);
          throw new ApiProblem(
            422,
            'DOCUMENT_TYPE_NOT_ALLOWED',
            'The file content does not match its type. Upload a PDF, PNG, JPEG, CSV or XLSX file.',
          );
        }
        const [row] = await tx
          .update(documents)
          .set({
            status: 'available',
            verifiedAt: new Date(),
            sha256: createHash('sha256').update(body).digest('hex'),
          })
          .where(eq(documents.id, doc.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'document.attached',
          resourceType: doc.ownerType,
          resourceId: doc.ownerId,
          requestId: ctx.requestId,
          changes: {
            documentId: { from: null, to: doc.id },
            status: { from: 'pending', to: 'available' },
          },
        });
        return (await this.toSummaries(tx, [row]))[0];
      },
    );
  }

  download(actor: RequestActor, documentId: string): Promise<DocumentDownload> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
      if (!doc) throw ApiProblem.notFound('document');
      if (!(await this.owner(doc.ownerType).canRead(tx, actor, doc.ownerId)))
        throw ApiProblem.notFound('document');
      if (doc.status !== 'available')
        throw new ApiProblem(409, 'DOCUMENT_NOT_UPLOADED', 'This document is not available yet.');
      return {
        url: this.store.downloadUrl(doc.storageKey, doc.fileName, DOWNLOAD_TTL),
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000).toISOString(),
      };
    });
  }
}
