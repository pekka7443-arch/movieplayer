// Server-only helper for iptv-org's public channel playlists
// (https://github.com/iptv-org/iptv) — free, publicly available TV streams.
// CineDeck uses the "Sports" category playlist to power the Live Sports →
// TV Channels player (HLS via hls.js on the client). Zero keys, zero signup.
// Never import from client components.

import https from 'node:https';

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/categories/sports.m3u';
const TIMEOUT_MS = 15_000;

export interface SportsChannel {
  /** tvg-id when present, else the normalized name — stable React key. */
  id: string;
  name: string;
  /** HLS (.m3u8) or TS stream URL — https only (mixed content blocks http on https pages). */
  url: string;
  logo: string | null;
  group: string;
}

function httpsText(url: string, depth = 0): Promise<string | null> {
  return new Promise((resolve) => {
    if (depth > 3) {
      resolve(null);
      return;
    }
    // Absolute deadline for the WHOLE request (DNS + connect + body). Node's
    // socket `timeout` option only fires on inactivity once a socket exists —
    // a hung DNS lookup or a half-open socket would otherwise dangle forever
    // and pin the sports player on "Scanning live feeds…".
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let req: ReturnType<typeof https.get> | null = null;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(value);
    };
    req = https.get(
      url,
      { family: 4, headers: { accept: '*/*' }, timeout: TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          const next = new URL(location, url).toString();
          res.resume();
          settled = true; // hand the deadline over to the recursive call
          if (deadline) clearTimeout(deadline);
          httpsText(next, depth + 1).then(resolve);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
        res.on('error', () => finish(null));
      },
    );
    req.on('timeout', () => req?.destroy(new Error('iptv_timeout')));
    req.on('error', () => finish(null));
    deadline = setTimeout(() => {
      req?.destroy();
      finish(null);
    }, TIMEOUT_MS);
  });
}

/** Parse an #EXTM3U playlist into structured channels (https-only). */
export function parseM3U(text: string): SportsChannel[] {
  const lines = text.split('\n');
  const channels: SportsChannel[] = [];
  let pending: { name: string; logo: string | null; group: string; id: string | null } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF')) {
      const name = line.slice(line.lastIndexOf(',') + 1).trim();
      const logo = /tvg-logo="([^"]*)"/.exec(line)?.[1] ?? null;
      const group = /group-title="([^"]*)"/.exec(line)?.[1] ?? 'Sports';
      const id = /tvg-id="([^"]*)"/.exec(line)?.[1] ?? null;
      pending = { name, logo: logo || null, group, id };
    } else if (line && !line.startsWith('#') && pending) {
      // Any http(s) stream is accepted: playback goes through CineDeck's
      // /api/sports/stream proxy, which fixes CORS and mixed content, so
      // even plain-http playlists are playable from the https site.
      if (line.startsWith('https://') || line.startsWith('http://')) {
        channels.push({
          id: pending.id || pending.name.toLowerCase().replace(/\s+/g, '-'),
          name: pending.name,
          url: line,
          logo: pending.logo,
          group: pending.group,
        });
      }
      pending = null;
    }
  }
  return channels;
}

const globalForIptv = globalThis as unknown as {
  __cinedeckIptvCache?: { channels: SportsChannel[]; expiresAt: number } | null;
  __cinedeckIptvInflight?: Promise<SportsChannel[] | null>;
};

/**
 * All parsed sports channels (cached 6h — the playlist updates daily).
 * Concurrent callers share one in-flight fetch so a cold cache can't
 * stampede the upstream with parallel playlist downloads.
 */
export async function sportsChannels(): Promise<SportsChannel[] | null> {
  const cached = globalForIptv.__cinedeckIptvCache;
  if (cached && cached.expiresAt > Date.now()) return cached.channels;

  if (!globalForIptv.__cinedeckIptvInflight) {
    const fetchPromise = httpsText(PLAYLIST_URL).then((text) => {
      const channels =
        text && text.startsWith('#EXTM3U')
          ? parseM3U(text).sort((a, b) => a.name.localeCompare(b.name))
          : null;
      if (channels) {
        globalForIptv.__cinedeckIptvCache = {
          channels,
          expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        };
      }
      return channels;
    });
    globalForIptv.__cinedeckIptvInflight = fetchPromise;
    // Clear the in-flight slot once settled (keep the value out of memory).
    void fetchPromise.catch(() => undefined).finally(() => {
      if (globalForIptv.__cinedeckIptvInflight === fetchPromise) {
        globalForIptv.__cinedeckIptvInflight = undefined;
      }
    });
  }

  return globalForIptv.__cinedeckIptvInflight;
}
