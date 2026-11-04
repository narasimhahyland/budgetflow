import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const LinkEnv = z.object({
  APPROVAL_LINK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.length >= 16 ? v : undefined)),
  APPROVAL_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
});

const DEV_SECRET = 'approval-links-dev-only-secret';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signs and verifies actionable email links: `v1.<tenant>.<token id>.<HMAC-SHA256>`. The signature
 * lets the public endpoint set the tenant context before it reads the single-use token row; the row
 * holds the action, approver, subject version and expiry.
 */
@Injectable()
export class ApprovalLinks {
  private readonly log = new Logger('ApprovalLinks');
  private readonly secret: string;
  readonly ttlHours: number;

  constructor() {
    const env = LinkEnv.parse(process.env);
    if (!env.APPROVAL_LINK_SECRET) {
      this.log.warn('APPROVAL_LINK_SECRET is not set; using the development secret');
    }
    this.secret = env.APPROVAL_LINK_SECRET ?? DEV_SECRET;
    this.ttlHours = env.APPROVAL_LINK_TTL_HOURS;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url').slice(0, 43);
  }

  token(tenantId: string, tokenId: string): string {
    const body = `v1.${tenantId}.${tokenId}`;
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string): { tenantId: string; tokenId: string } | null {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const [, tenantId, tokenId, sig] = parts;
    if (!UUID.test(tenantId) || !UUID.test(tokenId)) return null;
    const expected = Buffer.from(this.sign(`v1.${tenantId}.${tokenId}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { tenantId, tokenId };
  }
}
