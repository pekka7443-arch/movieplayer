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
    const req = https.get(
      url,
      { family: 4, headers: { accept: '*/*' }, timeout: TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve(httpsText(new URL(location, url).toString(), depth + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => req.destroy(new Error('iptv_timeout')));
    req.on('error', () => resolve(null));
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
};

/** All parsed sports channels (cached 6h — the playlist updates daily). */
export async function sportsChannels(): Promise<SportsChannel[] | null> {
  const cached = globalForIptv.__cinedeckIptvCache;
  if (cached && cached.expiresAt > Date.now()) return cached.channels;

  const text = await httpsText(PLAYLIST_URL);
  if (!text || !text.startsWith('#EXTM3U')) return null;

  const channels = parseM3U(text).sort((a, b) => a.name.localeCompare(b.name));
  globalForIptv.__cinedeckIptvCache = { channels, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return channels;
}
