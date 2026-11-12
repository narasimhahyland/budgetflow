import { PolicyService } from '@bf/api/core';
import { actuals } from '@bf/api/db';
import { DocumentsService } from '@bf/api/documents';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/**
 * Receipts a connector copied from its provider (Navan, 16a) belong to the actual they came with.
 * Whoever may read actuals may read and download them; nobody attaches to an actual by hand.
 */
@Injectable()
export class ActualDocuments implements OnModuleInit {
  constructor(
    private readonly documents: DocumentsService,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit(): void {
    this.documents.registerOwner({
      type: 'actual',
      canRead: async (tx, actor, id) => {
        if (
          !this.policy.can(actor, 'actuals.read', { kind: 'tenant', tenantId: actor.tenantId })
            .allowed
        )
          return false;
        const [row] = await tx.select({ id: actuals.id }).from(actuals).where(eq(actuals.id, id));
        return Boolean(row);
      },
      canWrite: async () => false,
    });
  }
}
