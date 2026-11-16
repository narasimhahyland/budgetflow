// Web Push helpers (B8). A scenario plays the browser: it makes its own P-256 subscription keys,
// registers an endpoint on the mock push service, and decrypts what arrives there. The decryption
// follows RFC 8291 / RFC 8188 from the documented wire format rather than reusing the API's code,
// so the scenarios prove what a real browser would receive.
import { expect, type APIRequestContext } from '@playwright/test';
import { ChannelDeliveryList, PushDevice, type ChannelDeliveryLogView } from '@bf/contracts';
import type { SeedUserId } from '@bf/seed';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { as, mutate } from './auth';
import { expectContract } from './contract';
import { MOCK_INTERNAL_BASE, mockApi } from './p12';

export type PushMode = 'ok' | 'gone' | 'missing' | 'down';

export interface MockSubscription {
  /** The id in the mock endpoint path; what the mock files received messages under. */
  mockId: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
  decrypt(bodyBase64: string): Record<string, unknown>;
}

export interface ReceivedPush {
  subscription: string;
  mode: PushMode;
  at: string;
  answered: number;
  vapidValid: boolean;
  vapidError: string | null;
  vapidSubject: string | null;
  vapidPublicKey: string | null;
  contentEncoding: string | null;
  ttl: string | null;
  urgency: string | null;
  body: string;
}

/** A browser-side subscription on the mock push service: keys the scenario holds. */
export function mockSubscription(mode: PushMode): MockSubscription {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const mockId = `b8-${randomUUID()}`;
  return {
    mockId,
    endpoint: `${MOCK_INTERNAL_BASE}/push/v1/${mode}/${mockId}`,
    p256dh: ua.getPublicKey().toString('base64url'),
    authKey: auth.toString('base64url'),
    decrypt(bodyBase64: string) {
      const msg = Buffer.from(bodyBase64, 'base64');
      // Header: salt (16) | record size (4) | key id length (1) | key id = sender public key.
      const salt = msg.subarray(0, 16);
      const idLen = msg[20];
      const asPublic = msg.subarray(21, 21 + idLen);
      const cipherText = msg.subarray(21 + idLen);
      const shared = ua.computeSecret(asPublic);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
      const cek = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
      );
      const nonce = Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
      );
      const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(cipherText.subarray(cipherText.length - 16));
      const plain = Buffer.concat([
        decipher.update(cipherText.subarray(0, cipherText.length - 16)),
        decipher.final(),
      ]);
      // Strip the padding: the last non-zero byte is the delimiter (2 = last record).
      let end = plain.length - 1;
      while (end >= 0 && plain[end] === 0) end--;
      expect(plain[end], 'last-record delimiter').toBe(2);
      return JSON.parse(plain.subarray(0, end).toString('utf8')) as Record<string, unknown>;
    },
  };
}

/** Registers the subscription for `user`, as their browser would after PushManager.subscribe. */
export async function registerDevice(
  request: APIRequestContext,
  user: SeedUserId,
  sub: MockSubscription,
  label = 'Scenario phone, Chrome',
): Promise<PushDevice> {
  return expectContract(
    await request.post('/api/me/push-devices', {
      headers: await mutate(user),
      data: {
        deviceLabel: label,
        userAgentFamily: 'Android, Chrome',
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        authKey: sub.authKey,
      },
    }),
    201,
    PushDevice,
  );
}

export async function removeDevice(
  request: APIRequestContext,
  user: SeedUserId,
  id: string,
): Promise<void> {
  // 404 is fine: a gone subscription was already removed by the worker.
  const res = await request.delete(`/api/me/push-devices/${id}`, { headers: await mutate(user) });
  expect([200, 404]).toContain(res.status());
}

/** The push deliveries for one device, as its owner sees them in the delivery log. */
export async function deliveriesFor(
  request: APIRequestContext,
  user: SeedUserId,
  deviceId: string,
): Promise<ChannelDeliveryLogView[]> {
  const list = await expectContract(
    await request.get(
      `/api/channels/deliveries?channel=push&pushSubscriptionId=${deviceId}&limit=100`,
      { headers: await as(user) },
    ),
    200,
    ChannelDeliveryList,
  );
  return list.items;
}

/** Polls the delivery log until a delivery for the device matches `settled`, and returns it. */
export async function waitForDelivery(
  request: APIRequestContext,
  user: SeedUserId,
  deviceId: string,
  settled: (d: ChannelDeliveryLogView) => boolean,
  timeout = 45_000,
): Promise<ChannelDeliveryLogView> {
  let found: ChannelDeliveryLogView | undefined;
  await expect
    .poll(
      async () => {
        found = (await deliveriesFor(request, user, deviceId)).find(settled);
        return Boolean(found);
      },
      { timeout, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  return found!;
}

/** Messages the mock push service received for one subscription, oldest first. */
export async function receivedBy(sub: MockSubscription): Promise<ReceivedPush[]> {
  const api = await mockApi();
  const res = await api.get(`/_control/push/received?subscription=${sub.mockId}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: ReceivedPush[] }).items;
}
