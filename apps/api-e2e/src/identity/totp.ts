// TOTP codes for the MFA test user. Keycloak refuses a code that was already used and accepts the previous,
// current and next 30-second window, so runs pick an unused code from that window and record it in tmp/
// (shared with the web journeys) to stay repeatable; when all are used they wait for the next window.
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LEDGER = resolve(__dirname, '../../../../tmp/e2e-totp-used.json');
const PERIOD = 30_000;

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / PERIOD)));
  const h = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const now = Date.now();
    const used: Record<string, number> = existsSync(LEDGER)
      ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as Record<string, number>)
      : {};
    for (const code of Object.keys(used)) if (now - used[code] > 4 * PERIOD) delete used[code];
    for (const window of [0, 1]) {
      const code = totp(secret, now + window * PERIOD);
      if (!used[code]) {
        used[code] = now;
        mkdirSync(resolve(LEDGER, '..'), { recursive: true });
        writeFileSync(LEDGER, JSON.stringify(used));
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, PERIOD - (now % PERIOD) + 500));
  }
}
