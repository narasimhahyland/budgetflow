import { BlockList, isIP } from 'node:net';
import type { ApiRequest } from './http';

/**
 * Who is calling, by network address, for IP allow-lists on API keys and SCIM tokens.
 *
 * The address is the connection's own peer address. `X-Forwarded-For` is read only when that peer is
 * a proxy the deployment trusts (`TRUSTED_PROXY_CIDRS`): anyone can send the header, so trusting it
 * by default would let a caller holding a leaked key claim an allowed address and walk past the very
 * allow-list meant to contain the leak. With no trusted proxies configured the header is ignored.
 */

const normalize = (ip: string): string => ip.trim().replace(/^::ffff:/, '');

function family(ip: string): 'ipv4' | 'ipv6' | null {
  const v = isIP(ip);
  return v === 4 ? 'ipv4' : v === 6 ? 'ipv6' : null;
}

/** Whether `entry` is an address or a CIDR range `isCidr` can match. */
export function isCidr(entry: string): boolean {
  const [base, bits, extra] = entry.trim().split('/');
  if (extra !== undefined) return false;
  const f = family(normalize(base));
  if (!f) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  const n = Number(bits);
  return f === 'ipv4' ? n <= 32 : n <= 128;
}

/**
 * Whether `ip` falls inside any of `entries` (addresses or CIDR ranges), matched bit by bit.
 * Invalid entries match nothing.
 */
export function inCidrs(ip: string | null, entries: readonly string[]): boolean {
  if (!ip) return false;
  const addr = normalize(ip);
  const f = family(addr);
  if (!f) return false;
  const list = new BlockList();
  for (const entry of entries) {
    if (!isCidr(entry)) continue;
    const [base, bits] = entry.trim().split('/');
    const b = normalize(base);
    const bf = family(b)!;
    if (bits === undefined) list.addAddress(b, bf);
    else list.addSubnet(b, Number(bits), bf);
  }
  return list.check(addr, f);
}

type WithSocket = ApiRequest & { socket?: { remoteAddress?: string | null } };

/**
 * The caller's address: the connection peer, or - only when the peer is a trusted proxy - the
 * nearest untrusted address in `X-Forwarded-For`, read from the right so a caller cannot prepend a
 * forged hop.
 */
export function clientIpOf(req: WithSocket, trustedProxies: readonly string[]): string | null {
  const peer = req.socket?.remoteAddress ? normalize(req.socket.remoteAddress) : null;
  if (!peer || !inCidrs(peer, trustedProxies)) return peer;
  const raw = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map(normalize)
    .filter((h) => family(h));
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!inCidrs(chain[i], trustedProxies)) return chain[i];
  }
  return chain[0] ?? peer;
}
