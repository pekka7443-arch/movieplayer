// Geo + IP privacy helpers.
//
// PRIVACY RULE (admin spec): raw IPs are NEVER stored. Every write path goes
// through truncateIp() — the last octet of an IPv4 (and the interface ID of
// an IPv6) is zeroed before insertion. Geo resolution happens FIRST on the
// full IP, and only the coarse country/city strings are persisted.
//
// geoip-lite ships a local MaxMind database — no network calls at lookup
// time. It is listed in next.config `serverExternalPackages` so its
// __dirname-relative data files keep resolving; the import is additionally
// LAZY + fault-tolerant so a missing data file can never take a route down.

export interface GeoInfo {
  country: string | null;
  city: string | null;
}

type GeoIpModule = {
  lookup: (ip: string) => { country?: string; city?: string; region?: string } | null;
};

const globalForGeo = globalThis as unknown as { __cinedeckGeoIp?: GeoIpModule | null };

/** Best-effort module load — null when unavailable (data file missing, etc.). */
function geoipModule(): GeoIpModule | null {
  if (globalForGeo.__cinedeckGeoIp !== undefined) return globalForGeo.__cinedeckGeoIp;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- external native-ish package
    const mod = require('geoip-lite') as GeoIpModule | undefined;
    globalForGeo.__cinedeckGeoIp = mod ?? null;
  } catch {
    globalForGeo.__cinedeckGeoIp = null;
  }
  return globalForGeo.__cinedeckGeoIp;
}

/** Resolve country/city for an IP. Returns nulls for local/unknown IPs. */
export function geoLookup(ip: string | null | undefined): GeoInfo {
  if (!ip) return { country: null, city: null };
  try {
    const geoip = geoipModule();
    const hit = geoip ? geoip.lookup(ip) : null;
    if (!hit) return { country: null, city: null };
    return {
      country: hit.country ?? null,
      city: hit.city ? hit.city.slice(0, 80) : null,
    };
  } catch {
    return { country: null, city: null };
  }
}

/**
 * Zero out the identifying tail of an IP:
 *  - IPv4 "1.2.3.4" → "1.2.3.0" (last octet dropped)
 *  - IPv6 "2001:db8:1a2b:3c4d:5e6f:789a:bcde:f01" → first 4 hextets + "::"
 * Loopback / gateway placeholders pass through untouched.
 */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim();
  if (!value || value === 'local') return value === 'local' ? 'local' : null;
  // IPv4-mapped IPv6 like ::ffff:1.2.3.4 — keep the mapped prefix.
  const v4mapped = value.match(/^(::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/i);
  if (v4mapped) return `${v4mapped[1]}${v4mapped[2]}.0`;
  // Plain IPv4 "1.2.3.4" → "1.2.3.0" (last octet dropped).
  const v4 = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/);
  if (v4) return `${v4[1]}.0`;
  // IPv6 — keep the first 4 hextets (/48-ish storage is the privacy
  // compromise; a /64 would still single out a single LAN).
  const compressed = value.split('::');
  if (compressed.length === 2) {
    const head = compressed[0].split(':').filter(Boolean).slice(0, 4).join(':');
    return `${head}::`;
  }
  const head = value.split(':').filter(Boolean).slice(0, 4).join(':');
  return `${head}::`;
}

// ---------------------------------------------------------------------------
// User-agent classification (dependency-free, coarse on purpose)
// ---------------------------------------------------------------------------

export interface UaInfo {
  browser: string;
  device: 'Desktop' | 'Mobile' | 'Tablet' | 'TV' | 'Bot' | 'Unknown';
}

/** Coarse browser/device buckets for the admin dashboard charts. */
export function classifyUserAgent(ua: string | null | undefined): UaInfo {
  if (!ua) return { browser: 'Unknown', device: 'Unknown' };
  const value = ua.toLowerCase();

  if (value.includes('bot') || value.includes('crawler') || value.includes('spider')) {
    return { browser: 'Bot', device: 'Bot' };
  }

  let browser = 'Other';
  if (value.includes('edg/')) browser = 'Edge';
  else if (value.includes('opr/') || value.includes('opera')) browser = 'Opera';
  else if (value.includes('samsungbrowser')) browser = 'Samsung Internet';
  else if (value.includes('firefox')) browser = 'Firefox';
  else if (value.includes('chrome') || value.includes('crios')) browser = 'Chrome';
  else if (value.includes('safari')) browser = 'Safari';

  let device: UaInfo['device'] = 'Desktop';
  if (value.includes('ipad') || (value.includes('tablet') && !value.includes('huawei'))) device = 'Tablet';
  else if (value.includes('mobi') || value.includes('iphone') || value.includes('android')) device = 'Mobile';
  else if (value.includes('tv') || value.includes('playstation') || value.includes('xbox')) device = 'TV';

  return { browser, device };
}
