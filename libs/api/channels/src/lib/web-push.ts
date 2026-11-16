import { devSecretsAllowed, secretOrDev } from '@bf/api/core';
import {
  createECDH,
  createHash,
  createCipheriv,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { z } from 'zod';

/**
 * Web Push (B8, screen 059c) on `node:crypto` only, so no new runtime dependency:
 * - RFC 8291 message encryption (`aes128gcm`, RFC 8188) to the subscription's P-256 key and auth secret;
 * - RFC 8292 VAPID: an ES256 JWT for the push service's origin plus the application server key;
 * - RFC 8030 delivery: POST to the subscription endpoint with TTL and Urgency.
 *
 * Outbound calls only reach hosts on `PUSH_ALLOWED_HOSTS` (the browsers' push services by default), so
 * a registered endpoint can never make the worker call an arbitrary address.
 */

const Env = z.object({
  /** Base64url P-256 private key (32 bytes). Required in production; the public key is derived. */
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** Contact the push service can reach (RFC 8292 `sub`). */
  VAPID_SUBJECT: z.string().default('mailto:budgetflow-push@example.test'),
  PUSH_ALLOWED_HOSTS: z
    .string()
    .default(
      'fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com,*.notify.windows.com',
    ),
  PUSH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  PUSH_TTL_SECONDS: z.coerce.number().int().min(0).max(2_419_200).default(86_400),
});

/**
 * Dev-only VAPID private key, derived from a public string: it protects nothing and is used only
 * where `secretOrDev` allows it (local stack, tests). Production refuses to start without a real key.
 */
const DEV_VAPID_PRIVATE_KEY = createHash('sha256')
  .update('budgetflow-vapid-dev-only-0001')
  .digest('base64url');

export interface PushConfig {
  publicKey: string;
  subject: string;
  allowedHosts: string[];
  timeoutMs: number;
  ttlSeconds: number;
  /** ES256 signing key for VAPID JWTs. */
  signingKey: KeyObject;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const parsed = Env.parse(env);
  const privateB64 = secretOrDev(
    'VAPID_PRIVATE_KEY',
    parsed.VAPID_PRIVATE_KEY,
    DEV_VAPID_PRIVATE_KEY,
    env,
  );
  const d = Buffer.from(privateB64, 'base64url');
  if (d.length !== 32)
    throw new Error('VAPID_PRIVATE_KEY must be a base64url P-256 key (32 bytes)');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 65 bytes, uncompressed
  const signingKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString('base64url'),
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  return {
    publicKey: pub.toString('base64url'),
    subject: parsed.VAPID_SUBJECT,
    allowedHosts: parsed.PUSH_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    timeoutMs: parsed.PUSH_HTTP_TIMEOUT_MS,
    ttlSeconds: parsed.PUSH_TTL_SECONDS,
    signingKey,
  };
}

/** True when the endpoint is http(s) on an allowed host (`*.example.com` matches subdomains). */
export function pushHostAllowed(endpoint: string, allowedHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // Real push services are https. Plain http is only for the local stack's mock push service.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && devSecretsAllowed())) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((h) =>
    h.startsWith('*.') ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h,
  );
}

/** RFC 8291 + RFC 8188: one `aes128gcm` record carrying `plaintext`, keyed to the subscription. */
export function encryptPushPayload(
  p256dh: string,
  authSecret: string,
  plaintext: Buffer,
  // Injectable for tests of the wire format; production always uses fresh randomness.
  opts: { salt?: Buffer; serverEcdh?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const auth = Buffer.from(authSecret, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04)
    throw new PushPermanentError('The subscription key is not an uncompressed P-256 point');
  if (auth.length < 16) throw new PushPermanentError('The subscription auth secret is too short');
  const server = opts.serverEcdh ?? createECDH('prime256v1');
  if (!opts.serverEcdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  let shared: Buffer;
  try {
    shared = server.computeSecret(uaPublic);
  } catch {
    throw new PushPermanentError('The subscription key is not a valid P-256 point');
  }
  const salt = opts.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  // 0x02 marks the last (only) record; no padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, body, tag]);
}

/** RFC 8292 `Authorization: vapid t=<jwt>, k=<key>` for the endpoint's origin, valid 12 hours. */
export function vapidAuthorization(
  endpoint: string,
  cfg: Pick<PushConfig, 'publicKey' | 'subject' | 'signingKey'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const aud = new URL(endpoint).origin;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud,
    exp: nowSeconds + 12 * 3600,
    sub: cfg.subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: cfg.signingKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${cfg.publicKey}`;
}

/** A push that can never succeed (bad keys, host not allowed, 4xx other than gone or rate limit). */
export class PushPermanentError extends Error {}

export type PushOutcome =
  | { kind: 'sent'; status: number; messageId: string | null }
  | { kind: 'gone'; status: number }
  | { kind: 'retry'; status: number | null; message: string }
  | { kind: 'rejected'; status: number | null; message: string };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  authKey: string;
}

/** Sends one encrypted message and classifies the push service's answer. Never throws. */
export async function sendWebPush(
  target: PushTarget,
  message: Record<string, unknown>,
  cfg: PushConfig,
  urgency: 'normal' | 'high' = 'normal',
): Promise<PushOutcome> {
  if (!pushHostAllowed(target.endpoint, cfg.allowedHosts))
    return {
      kind: 'rejected',
      status: null,
      message: 'The push service host is not on the allowed list',
    };
  let body: Buffer;
  try {
    body = encryptPushPayload(target.p256dh, target.authKey, Buffer.from(JSON.stringify(message)));
  } catch (e) {
    return { kind: 'rejected', status: null, message: (e as Error).message };
  }
  let res: Response;
  try {
    res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthorization(target.endpoint, cfg),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(cfg.ttlSeconds),
        urgency,
      },
      body: new Uint8Array(body),
      redirect: 'error',
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    return {
      kind: 'retry',
      status: null,
      message: `Push service unreachable: ${(e as Error).message}`,
    };
  }
  // The body of an error answer is not needed and may be large; drop it.
  await res.body?.cancel().catch(() => undefined);
  if (res.status >= 200 && res.status < 300) {
    const location = res.headers.get('location');
    return { kind: 'sent', status: res.status, messageId: location ? location.slice(-120) : null };
  }
  if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status };
  if (res.status === 429 || res.status >= 500)
    return { kind: 'retry', status: res.status, message: `Push service answered ${res.status}` };
  return { kind: 'rejected', status: res.status, message: `Push service answered ${res.status}` };
}

/**
 * Lock-screen privacy (059c): unless the person opted in, push text carries the request and the
 * person but no amount. Removes the job's own formatted amount and any "<ISO code> <number>" figure.
 */
export function hideAmounts(text: string, knownAmounts: string[] = []): string {
  let out = text;
  for (const a of knownAmounts) if (a) out = out.split(a).join('');
  return out
    .replace(/\(?\b[A-Z]{3}\s-?\d[\d,]*(?:\.\d+)?\)?/g, '')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/\s*,\s*$/, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
