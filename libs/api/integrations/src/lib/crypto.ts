import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { integrationsConfig } from './config';

/** Derives the AES key from the configured secret; the salt is fixed so existing rows stay readable. */
const keyFor = (secret: string): Buffer => scryptSync(secret, 'budgetflow-integrations', 32);

export interface EncryptedSecret {
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** Encrypts an integration credential for storage. The plaintext never leaves this function. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(integrationsConfig().secretKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(stored: EncryptedSecret): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(integrationsConfig().secretKey),
    Buffer.from(stored.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(stored.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(stored.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Bearer secrets are `bf_<live|scim>_<tenant tag>_<random>`. The tenant tag is the tenant's own id,
 * so a request can set the tenant context before it touches the database and row level security
 * applies to the key lookup itself. A forged tag simply finds no key: the hash will not match.
 * Only the hash and the short prefix are stored.
 */
export function newBearerSecret(
  label: 'live' | 'scim',
  tenantId: string,
): { secret: string; prefix: string } {
  // Hex throughout: the underscore separators stay unambiguous whatever the random bytes are.
  const random = randomBytes(24).toString('hex');
  const tag = tenantId.replace(/-/g, '');
  return { secret: `bf_${label}_${tag}_${random}`, prefix: `bf_${label}_${random.slice(0, 4)}` };
}

/** Reads the tenant a bearer secret belongs to, without trusting anything else about it. */
export function tenantFromSecret(secret: string): string | null {
  const parts = secret.split('_');
  if (parts.length !== 4 || parts[0] !== 'bf') return null;
  const hex = parts[2];
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `BudgetFlow-Signature: t=<unix seconds>,v1=<hmac-sha256 of "<t>.<body>">`. */
export function signWebhookPayload(secret: string, timestampSeconds: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

export function webhookDigest(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}

const SENSITIVE_KEY =
  /secret|token|password|credential|signature|authorization|apikey|api_key|pan|card_number/i;

/**
 * Masks tokens, signatures, card numbers and anything that looks like a credential before a payload
 * is stored or shown (100: payloads are always redacted).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (/^\d{12,19}$/.test(value)) return `****${value.slice(-4)}`;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return value;
}
