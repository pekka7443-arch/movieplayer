// SSRF guard — validates an outbound URL AND pins the DNS answer so the
// actual connection cannot be re-bound to a private address after the check
// (TOCTOU / DNS-rebinding protection).
//
// Blocks, on EVERY redirect hop:
//  - non-http(s) schemes, credentials in URLs
//  - loopback, private (RFC1918 + CGNAT), link-local (169.254/16 + fe80::),
//    unique-local (fc00::/7), multicast, reserved and 0.0.0.0/8 targets
//  - IPv4-mapped IPv6 (::ffff:10.0.0.1 and friends) in every encoding
//  - obfuscated IP forms: pure-decimal (2130706433), hex (0x7f.0.0.1,
//    0x7f000001) and octal (0177.0.0.1) hostnames

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedTarget {
  /** Normalized URL with the hostname as the user supplied it. */
  url: string;
  /** Hostname exactly as it appeared (used for TLS SNI). */
  hostname: string;
  /** Every DNS answer, validated as public. Connect pins to the first. */
  addresses: string[];
  port: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/** True for addresses that must never be fetched from a user-supplied URL. */
export function isForbiddenIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    // Normalize IPv4-mapped IPv6 written as dotted quad.
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    if (
      n === 0 || // 0.0.0.0/8 "this network"
      (n >>> 24) === 10 || // 10/8
      (n >>> 24) === 127 || // loopback
      (n >>> 16) === 0xa9fe || // 169.254/16 link-local
      ((n >>> 16) & 0xfff0) === 0xac10 || // 172.16/12
      (n >>> 16) === 0xc0a8 || // 192.168/16
      ((n >>> 16) & 0xffc0) === 0x6440 || // 100.64/10 CGNAT
      (n >>> 16) === 0xc612 && (n & 0xff00) === 0xfe00 || // 198.18/15 benchmark
      (n >>> 28) === 0xe || // 224/4 multicast
      (n >>> 28) === 0xf || // 240/4 reserved (incl. 255.255.255.255)
      (n >>> 24) === 192 && (n >>> 16) === 0xc000 // 192.0.0/24 — covered above
    ) {
      return true;
    }
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase().split('%')[0]; // strip zone id
    // IPv4-mapped / IPv4-compatible IPv6 — validate the embedded IPv4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isForbiddenIp(mapped[1]);
    const hexMapped = lower.match(/^::(ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      // ::ffff:7f00:0001 style — decode the last two groups to an IPv4 int.
      const hi = parseInt(hexMapped[2], 16);
      const lo = parseInt(hexMapped[3], 16);
      const n = (hi << 16) | lo;
      const dotted = `${n >>> 24 & 255}.${n >>> 16 & 255}.${n >>> 8 & 255}.${n & 255}`;
      if (hexMapped[1] || n !== 0) return isForbiddenIp(dotted);
    }
    if (lower === '::' || lower === '::1') return true; // unspecified + loopback
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('ff')) return true; // multicast
    if (lower.startsWith('2001:db8')) return true; // documentation range
    if (lower.startsWith('::ffff:')) {
      // ::ffff:x.y.z.w already handled above; anything else mapped → check.
      const embedded = lower.slice(7);
      if (isIP(embedded) === 4) return isForbiddenIp(embedded);
      return true;
    }
    return false;
  }
  return true; // unparseable → refuse
}

/**
 * Decode obfuscated hostname forms into a plain dotted IPv4 (or the original
 * hostname when it is a name):
 *  - 2130706433        → 127.0.0.1   (pure decimal)
 *  - 0x7f000001        → 127.0.0.1   (pure hex)
 *  - 017700000001      → 127.0.0.1   (pure octal)
 *  - 0x7f.1.1.1        → 127.1.1.1   (mixed hex/decimal parts)
 *  - 0177.0.0.1        → 127.0.0.1   (octal parts)
 */
export function normalizeHostname(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  // Pure decimal (no leading zeros — those are octal): 2130706433 → 127.0.0.1
  if (/^(0|[1-9]\d*)$/.test(h)) {
    const n = Number(h);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
    }
    return h;
  }
  if (h.startsWith('0x') && /^[0-9a-fx.]+$/.test(h)) {
    const parts = h.split('.');
    if (parts.length >= 1 && parts.length <= 4 && parts.every((p) => /^0x[0-9a-f]+$|^\d+$/.test(p))) {
      // Mixed-hex dotted form (0x7f.0.0.1) — each part ≤ 255.
      if (parts.length > 1) {
        const nums = parts.map((p) => Number.parseInt(p, 16));
        if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
          return nums.join('.');
        }
        return h;
      }
      // Single hex number (0x7f000001) — a full 32-bit address.
      const n = Number.parseInt(h, 16);
      if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
        return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
      }
    }
    return h;
  }
  // Dotted octal (at least the first octet written with a leading zero):
  // 0177.0.0.1 → 127.0.0.1
  if (h.startsWith('0') && h.split('.').every((p) => /^[0-7]+$/.test(p))) {
    const parts = h.split('.');
    if (parts.length > 1 && parts.length <= 4) {
      // Dotted octal (0177.0.0.1) — each part ≤ 255.
      const nums = parts.map((p) => Number.parseInt(p, 8));
      if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return nums.join('.');
      }
      return h;
    }
    if (parts.length === 1) {
      // Single octal number (017700000001) — a full 32-bit address.
      const n = Number.parseInt(h, 8);
      if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
        return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
      }
    }
    return h;
  }
  return h;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Parse + DNS-resolve a user-supplied URL and assert every resolved address
 * is public. Throws SsrfError on any violation. Returns the addresses the
 * caller should pin its socket to (see `pinnedLookup`).
 */
export async function assertPublicHttpUrl(raw: string): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfError('bad_protocol');
  }
  if (url.username || url.password) {
    throw new SsrfError('credentials_not_allowed');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new SsrfError('bad_port');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new SsrfError('bad_host');
  // Bare-IP hostnames are checked directly; names go through DNS.
  if (isIP(hostname)) {
    if (isForbiddenIp(hostname)) throw new SsrfError('private_address');
    return { url: url.toString(), hostname, addresses: [hostname], port };
  }
  // Hostnames that resolve to forbidden literals are caught by the lookup.
  let addresses: string[];
  try {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    addresses = answers.map((a) => a.address);
  } catch {
    throw new SsrfError('dns_failure');
  }
  if (addresses.length === 0) throw new SsrfError('dns_failure');
  for (const address of addresses) {
    if (isForbiddenIp(address)) throw new SsrfError('private_address');
  }
  return { url: url.toString(), hostname, addresses, port };
}

/**
 * A node `lookup` function that returns ONLY the pre-validated addresses —
 * pass it as `lookup` to http/https.request so a DNS rebinding between the
 * check and the connect cannot reach a private network.
 */
export function pinnedLookup(target: ResolvedTarget) {
  let cursor = 0;
  return (
    _hostname: string,
    _options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ): void => {
    if (target.addresses.length === 0) {
      callback(Object.assign(new Error('no validated address'), { code: 'EAI_AGAIN' }), '', 4);
      return;
    }
    const address = target.addresses[cursor % target.addresses.length];
    cursor += 1;
    callback(null, address, isIP(address) === 6 ? 6 : 4);
  };
}

/** Media content types the stream proxy is allowed to pipe through. */
export const STREAM_CONTENT_TYPES = new Set([
  // playlists
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'application/mpegurl',
  'vnd.apple.mpegurl',
  // segments
  'video/mp2t',
  'video/mp4',
  'video/iso.segment',
  'segment/mp4',
  // audio-only renditions
  'audio/aac',
  'audio/mp4',
  'audio/aacp',
  'audio/mpeg',
  // EXT-X-KEY / EXT-X-MAP payloads are often opaque
  'application/octet-stream',
  'binary/octet-stream',
  'text/plain',
]);

export function contentTypeAllowed(contentType: string | null | undefined, urlPath: string): boolean {
  const clean = urlPath.toLowerCase().split('?')[0];
  // Allowlist by extension too — many CDNs send application/octet-stream.
  if (/\.(m3u8|ts|mp4|m4s|aac|key|cmf|mpd)$/.test(clean)) return true;
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return STREAM_CONTENT_TYPES.has(base);
}
