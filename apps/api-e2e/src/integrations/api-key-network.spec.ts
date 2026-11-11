// Phase 18: an API key's allowed networks hold against a caller who claims an address.
//
// The allow-list exists to contain a leaked key: whoever holds it can only use it from the networks
// its owner named. The API used to take the caller's address from the first X-Forwarded-For entry,
// which any client can set, so a leaked key restricted to a company network could be used from
// anywhere by sending that network's address in the header. It now uses the connection's own
// address and believes the header only from a configured trusted proxy (TRUSTED_PROXY_CIDRS; none on
// the local stack). Invalid allow-list entries are refused when the key is made.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { mutate } from '../support/auth';
import { expectProblem } from '../support/contract';

// 203.0.113.0/24 is TEST-NET-3 (RFC 5737): reserved for documentation, never a real caller.
const TEST_NET = '203.0.113.0/24';

async function keyFor(request: APIRequestContext, allowedCidrs: string[]) {
  const res = await request.post('/api/integrations/api-keys', {
    headers: await mutate('integration-admin'),
    data: {
      name: `network check ${randomUUID().slice(0, 8)}`,
      ownerPersonId: userById('integration-admin').personId,
      scopes: ['budgets.read'],
      expiresInDays: 1,
      allowedCidrs,
    },
  });
  return res;
}

async function secretFor(request: APIRequestContext, allowedCidrs: string[]): Promise<string> {
  const res = await keyFor(request, allowedCidrs);
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

test.describe('API key allowed networks', () => {
  test('a key restricted to a network is refused when the caller only claims that network', async ({
    request,
  }) => {
    const secret = await secretFor(request, [TEST_NET]);
    await expectProblem(
      await request.get('/api/public/v1/meta', {
        headers: { authorization: `Bearer ${secret}`, 'x-forwarded-for': '203.0.113.9' },
      }),
      403,
      'API_KEY_IP_NOT_ALLOWED',
    );
    // A forged hop prepended or appended changes nothing: the header is not believed at all here.
    await expectProblem(
      await request.get('/api/public/v1/meta', {
        headers: {
          authorization: `Bearer ${secret}`,
          'x-forwarded-for': '203.0.113.9, 203.0.113.10',
        },
      }),
      403,
      'API_KEY_IP_NOT_ALLOWED',
    );
  });

  test('a key whose networks include the caller works without any forwarding header', async ({
    request,
  }) => {
    // Every IPv4 and IPv6 address: proves a direct request is judged by its own address, which the
    // old code could not do - with no header it had no address at all and refused every request.
    const secret = await secretFor(request, ['0.0.0.0/0', '::/0']);
    const res = await request.get('/api/public/v1/meta', {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test('an allowed-network entry that is not an address or a CIDR range is refused', async ({
    request,
  }) => {
    await expectProblem(await keyFor(request, ['office network']), 422, 'VALIDATION_FAILED');
    await expectProblem(await keyFor(request, ['10.0.0.0/99']), 422, 'VALIDATION_FAILED');
  });
});
