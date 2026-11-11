import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';

const StoreEnv = z.object({
  DOCUMENT_STORE_ENDPOINT: z.url().default('http://localhost:9000'),
  DOCUMENT_STORE_PUBLIC_URL: z.url().optional(),
  DOCUMENT_STORE_ACCESS_KEY: z.string().default('budgetflow'),
  DOCUMENT_STORE_SECRET_KEY: z.string().default('minio-dev-only'),
  DOCUMENT_STORE_BUCKET: z.string().default('budgetflow-documents'),
  DOCUMENT_STORE_REGION: z.string().default('us-east-1'),
});

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

/** Where documents live. MinIO in Compose and CI; any S3-compatible store in production. */
export interface DocumentStore {
  uploadUrl(key: string, contentType: string, expiresSeconds: number): string;
  downloadUrl(key: string, fileName: string, expiresSeconds: number): string;
  head(key: string): Promise<ObjectHead | null>;
  readStart(key: string, bytes: number): Promise<Buffer>;
  /** Reads a whole object the server wrote (for example a report file attached to an email). */
  read(key: string): Promise<Buffer>;
  /** Writes an object the server generated itself (a rendered report or pack). */
  put(key: string, contentType: string, body: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

const enc = (v: string) =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const hmac = (key: Buffer | string, v: string) => createHmac('sha256', key).update(v).digest();

/**
 * S3 signature version 4 with query-string presigning (no SDK): browsers get short-lived signed URLs
 * for the public endpoint; the API signs its own requests for the internal endpoint.
 */
@Injectable()
export class S3DocumentStore implements DocumentStore {
  private readonly log = new Logger('DocumentStore');
  private readonly cfg = StoreEnv.parse(process.env);
  private bucketReady: Promise<void> | null = null;

  private presign(
    method: string,
    base: string,
    key: string | null,
    expiresSeconds: number,
    extra: Record<string, string> = {},
    signedHeaders: Record<string, string> = {},
    now = new Date(),
  ): string {
    const url = new URL(base);
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${this.cfg.DOCUMENT_STORE_REGION}/s3/aws4_request`;
    const headers: Record<string, string> = { host: url.host, ...signedHeaders };
    const headerNames = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort();
    const path = `/${this.cfg.DOCUMENT_STORE_BUCKET}${key ? `/${key.split('/').map(enc).join('/')}` : ''}`;
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.cfg.DOCUMENT_STORE_ACCESS_KEY}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': headerNames.join(';'),
      ...extra,
    };
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${enc(k)}=${enc(query[k])}`)
      .join('&');
    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    );
    const canonical = [
      method,
      path,
      canonicalQuery,
      headerNames.map((h) => `${h}:${lower[h]}\n`).join(''),
      headerNames.join(';'),
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const kDate = hmac(`AWS4${this.cfg.DOCUMENT_STORE_SECRET_KEY}`, day);
    const kSigning = hmac(hmac(hmac(kDate, this.cfg.DOCUMENT_STORE_REGION), 's3'), 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
    return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private get publicBase(): string {
    return this.cfg.DOCUMENT_STORE_PUBLIC_URL ?? this.cfg.DOCUMENT_STORE_ENDPOINT;
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const head = await fetch(this.presign('HEAD', this.cfg.DOCUMENT_STORE_ENDPOINT, null, 60), {
        method: 'HEAD',
      });
      if (head.ok) return;
      const put = await fetch(this.presign('PUT', this.cfg.DOCUMENT_STORE_ENDPOINT, null, 60), {
        method: 'PUT',
      });
      if (!put.ok && put.status !== 409)
        throw new Error(`bucket create failed: HTTP ${put.status}`);
      this.log.log(`created bucket ${this.cfg.DOCUMENT_STORE_BUCKET}`);
    })().catch((e) => {
      this.bucketReady = null;
      throw e;
    });
    return this.bucketReady;
  }

  async prepare(): Promise<void> {
    await this.ensureBucket();
  }

  uploadUrl(key: string, contentType: string, expiresSeconds: number): string {
    return this.presign(
      'PUT',
      this.publicBase,
      key,
      expiresSeconds,
      {},
      { 'content-type': contentType },
    );
  }

  downloadUrl(key: string, fileName: string, expiresSeconds: number): string {
    const safe = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'document';
    return this.presign('GET', this.publicBase, key, expiresSeconds, {
      'response-content-disposition': `attachment; filename="${safe}"`,
    });
  }

  async head(key: string): Promise<ObjectHead | null> {
    await this.ensureBucket();
    const res = await fetch(this.presign('HEAD', this.cfg.DOCUMENT_STORE_ENDPOINT, key, 60), {
      method: 'HEAD',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD failed: HTTP ${res.status}`);
    return {
      sizeBytes: Number(res.headers.get('content-length') ?? 0),
      contentType: res.headers.get('content-type'),
    };
  }

  /**
   * Writes an object the API or worker generated. Signed against the internal endpoint, not the
   * public one: the browser-facing URL is not reachable from inside the API or worker container.
   */
  async put(key: string, contentType: string, body: Buffer): Promise<void> {
    await this.ensureBucket();
    const res = await fetch(
      this.presign(
        'PUT',
        this.cfg.DOCUMENT_STORE_ENDPOINT,
        key,
        600,
        {},
        { 'content-type': contentType },
      ),
      { method: 'PUT', headers: { 'content-type': contentType }, body: new Uint8Array(body) },
    );
    if (!res.ok) throw new Error(`PUT ${key} failed: HTTP ${res.status}`);
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const res = await fetch(this.presign('GET', this.cfg.DOCUMENT_STORE_ENDPOINT, key, 60), {
      headers: { range: `bytes=0-${bytes - 1}` },
    });
    if (!res.ok) throw new Error(`GET failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).subarray(0, bytes);
  }

  async read(key: string): Promise<Buffer> {
    const res = await fetch(this.presign('GET', this.cfg.DOCUMENT_STORE_ENDPOINT, key, 60));
    if (!res.ok) throw new Error(`GET ${key} failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    await fetch(this.presign('DELETE', this.cfg.DOCUMENT_STORE_ENDPOINT, key, 60), {
      method: 'DELETE',
    });
  }
}

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) =>
    b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  'text/csv': (b) =>
    b.length > 0 &&
    !b.includes(0) &&
    !Object.entries(SIGNATURES).some(([t, f]) => t !== 'text/csv' && f(b)),
};

/** The file's leading bytes match its declared type (the file name is never trusted). */
export function matchesSignature(contentType: string, start: Buffer): boolean {
  return SIGNATURES[contentType]?.(start) ?? false;
}
