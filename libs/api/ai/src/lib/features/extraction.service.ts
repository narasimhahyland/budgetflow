import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { S3DocumentStore } from '@bf/api/documents';
import { aiSuggestions, documents, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiSourceRef,
  ExtractedField,
  ExtractionRequest,
  ExtractionResult,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { AiSuggestionsService } from '../suggestions.service';

const ExtractOutput = z
  .object({
    readable: z.boolean(),
    fields: z
      .array(
        z
          .object({
            field: z.string().max(40),
            value: z.string().max(200).nullable(),
            confidence: z.enum(['high', 'medium', 'low']),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

/** Read from the document and deliberately thrown away: never stored, never shown, never sent on. */
const DISCARDED_FIELDS = ['cardNumber', 'cardholderSignature', 'contactDetails'] as const;

const FIELD_LABELS: Record<string, string> = {
  merchant: 'Merchant',
  vendorName: 'Vendor',
  receiptDate: 'Receipt date',
  totalMinor: 'Total',
  taxNote: 'Tax',
  paymentMethod: 'Payment method',
  validUntil: 'Valid until',
  depositPct: 'Deposit',
  cancellationTerms: 'Cancellation',
  currency: 'Currency',
};

/**
 * 121a: reads a verified receipt or quote and prefills the form. Extracted values never post money
 * and are never saved on their own: the person checks them, and the normal upload or quote command
 * saves what they confirmed. Fields the extractor is unsure about are left empty, never guessed.
 */
@Injectable()
export class AiExtractionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly gateway: AiGateway,
    private readonly suggestions: AiSuggestionsService,
    private readonly store: S3DocumentStore,
  ) {}

  extract(actor: RequestActor, req: ExtractionRequest): Promise<ExtractionResult> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.settings.assertEnabled(tx, actor.tenantId, 'extraction');
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.tenantId, actor.tenantId), eq(documents.id, req.documentId)));
      if (!doc) throw ApiProblem.notFound('document');
      // The uploader always sees their own extraction; finance sees it for lines they work on.
      const isUploader = Boolean(actor.personId) && doc.uploadedByPersonId === actor.personId;
      if (
        !isUploader &&
        !this.policy.can(actor, 'actuals.read', { kind: 'tenant', tenantId: actor.tenantId })
          .allowed
      )
        throw ApiProblem.notFound('document');
      if (doc.status !== 'available')
        throw new ApiProblem(
          409,
          'DOCUMENT_NOT_UPLOADED',
          'That file has not been verified yet. Extraction runs after the upload is verified.',
        );

      const sources: AiSourceRef[] = [{ type: 'document', id: doc.id, label: doc.fileName }];
      // The verified file itself is what the model reads; a file we cannot read is "not readable".
      const bytes = await this.store.read(doc.storageKey).catch(() => null);
      const result = await this.gateway.run({
        tx,
        actor,
        feature: 'extraction',
        channel: req.channel ?? 'web',
        task: 'extract_fields',
        facts: [
          {
            type: 'document',
            id: doc.id,
            label: doc.fileName,
            fields: {
              fileName: doc.fileName,
              mimeType: doc.contentType,
              documentKind: req.kind,
              sizeBytes: doc.sizeBytes,
              expectedCurrency: actor.reportingCurrency,
            },
          },
        ],
        attachments: bytes ? [{ contentType: doc.contentType, bytes }] : undefined,
        sources,
        scope: {
          action: 'request.create',
          scope: this.retrieval.scopeKind(actor, 'request.create'),
          consideredCount: 1,
          permittedCount: 1,
        },
        schema: ExtractOutput,
        successOutcome: 'suggested',
      });

      const readable = result.output?.readable ?? false;
      const fields: ExtractedField[] = (result.output?.fields ?? [])
        .map((f) => toField(f.field, f.value, f.confidence, actor.reportingCurrency))
        .sort((a, b) => a.field.localeCompare(b.field));
      const suggestion = await this.suggestions.upsert(tx, {
        tenantId: actor.tenantId,
        feature: 'extraction',
        subjectType: 'document',
        subjectId: doc.id,
        confidence: fields.some((f) => f.confidence === 'low') ? 'low' : 'high',
        payload: { kind: req.kind, readable, fields, queryLogId: result.queryLogId },
        sources,
        createdByPersonId: actor.personId,
        provider: this.gateway.providerId,
        modelId: this.gateway.modelId,
        modelVersion: this.gateway.modelVersion,
      });
      return {
        id: suggestion.id,
        documentId: doc.id,
        kind: req.kind,
        readable,
        message: readable
          ? 'We read these details from your file. Check them before you upload.'
          : "We couldn't read this file. Enter the details yourself.",
        fields,
        droppedFields: [...DISCARDED_FIELDS],
        status: 'open',
        confirmedFields: null,
        sources,
        provenance: { ...result.provenance, suggestionId: suggestion.id },
      } satisfies ExtractionResult;
    });
  }

  async result(actor: RequestActor, suggestionId: string): Promise<ExtractionResult> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.suggestions.row(tx, actor.tenantId, suggestionId);
      return this.toResult(tx, actor, row);
    });
  }

  private async toResult(
    _tx: Tx,
    _actor: RequestActor,
    row: typeof aiSuggestions.$inferSelect,
  ): Promise<ExtractionResult> {
    const payload = row.payload as {
      kind: 'receipt' | 'quote';
      readable: boolean;
      fields: ExtractedField[];
      queryLogId: string;
      confirmedFields?: Record<string, string>;
    };
    return {
      id: row.id,
      documentId: row.subjectId,
      kind: payload.kind,
      readable: payload.readable,
      message: null,
      fields: payload.fields,
      droppedFields: [...DISCARDED_FIELDS],
      status: row.status === 'accepted' ? 'accepted' : row.status === 'open' ? 'open' : 'dismissed',
      confirmedFields: payload.confirmedFields ?? null,
      sources: (row.sources as AiSourceRef[]) ?? [],
      provenance: {
        suggestionId: row.id,
        queryLogId: payload.queryLogId,
        provider: row.provider,
        modelId: row.modelId,
        modelVersion: row.modelVersion,
        generatedAt: row.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        latencyMs: 0,
      },
    };
  }
}

/** A money field keeps its minor units so the form can show it with the normal formatter. */
function toField(
  field: string,
  value: string | null,
  confidence: 'high' | 'medium' | 'low',
  currency: string,
): ExtractedField {
  const isMoney = field.endsWith('Minor');
  const amountMinor = isMoney && value !== null ? Number(value) : null;
  return {
    field,
    label: FIELD_LABELS[field] ?? field,
    value,
    amount: amountMinor !== null && Number.isFinite(amountMinor) ? { amountMinor, currency } : null,
    confidence: value === null ? null : confidence,
    needsCheck: value === null || confidence === 'low',
  };
}
