// HLS proxy for the Live Sports → TV Channels player.
//
// Why: iptv-org streams live on third-party CDNs that almost never send
// CORS headers, so hls.js in the browser can't fetch the playlists directly.
// This route pipes playlists + media segments through CineDeck's origin and
// rewrites every URI inside master/media playlists to point back at the
// proxy (variants, segments, EXT-X-KEY, EXT-X-MAP, renditions…).
// It also fixes mixed content: http:// segment URLs become same-origin https.
//
// Safety (SSRF-hardened):
//  - only http(s), no credentials, host allowlist not possible for IPTV so
//    instead EVERY target is DNS-resolved and validated as public
//  - private / loopback / link-local / CGNAT / multicast / reserved /
//    IPv4-mapped-IPv6 addresses blocked on EVERY redirect hop
//  - obfuscated hosts (decimal / hex / octal encodings) are normalized
//    before checks — 2130706433, 0x7f000001, 017700000001 all die
//  - sockets are PINNED to the validated DNS answer, so a rebinding attack
//    between check and connect cannot reach an internal network
//  - redirects followed manually (max 4), each hop re-validated
//  - playlists capped at 2 MB / 10 s; segments streamed with a 64 MB cap
//  - content types limited to HLS media (m3u8/ts/mp4/aac/key/octet-stream)

import https from 'node:https';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';

import {
  assertPublicHttpUrl,
  pinnedLookup,
  contentTypeAllowed,
  type ResolvedTarget,
} from '@/lib/server/ssrf-guard';
import { withApi } from '@/lib/server/api';
import { enforceRateLimit } from '@/lib/server/rate-limit';

const OPEN_TIMEOUT_MS = 12_000;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const SEGMENT_MAX_BYTES = 64 * 1024 * 1024;
const PLAYLIST_READ_TIMEOUT_MS = 10_000;

interface OpenResult {
  res: IncomingMessage;
  target: ResolvedTarget;
  redirected: boolean;
}

/** Open a GET stream against an already-validated target, following ≤4 redirects. */
function openStream(target: ResolvedTarget, depth = 0): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    if (depth > 4) {
      resolve(null);
      return;
    }
    const isHttps = target.url.startsWith('https:');
    const mod = isHttps ? https : http;
    const url = new URL(target.url);
    const req = mod.get(
      {
        // Pin the socket to the validated DNS answer (anti-rebinding).
        lookup: pinnedLookup(target),
        hostname: url.hostname,
        port: target.port,
        path: `${url.pathname}${url.search}`,
        protocol: target.url.startsWith('https:') ? 'https:' : 'http:',
        servername: isHttps ? url.hostname : undefined, // keep TLS SNI correct
        headers: {
          accept: '*/*',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) CineDeck/1.0',
        },
        timeout: OPEN_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          // Re-validate EVERY hop — redirects must never escape to intranet.
          assertPublicHttpUrl(new URL(location, target.url).toString())
            .then((next) => resolve(openStream(next, depth + 1)))
            .catch(() => resolve(null));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          resolve(null);
          return;
        }
        resolve({ res, target, redirected: depth > 0 });
      },
    );
    req.on('timeout', () => req.destroy(new Error('stream_timeout')));
    req.on('error', () => resolve(null));
  });
}

function readBody(res: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      res.destroy();
      resolve(text);
    };
    // Absolute cap — a trickling upstream must not hold the playlist hostage.
    const deadline = setTimeout(() => finish(''), PLAYLIST_READ_TIMEOUT_MS);
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        finish('');
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    res.on('error', () => finish(''));
  });
}

function proxify(uri: string, base: string): string {
  const abs = new URL(uri, base).toString();
  return `/api/sports/stream?u=${encodeURIComponent(abs)}`;
}

/** Rewrite every URI in a playlist (segment lines + URI="…" attributes). */
function rewritePlaylist(text: string, baseUrl: string): string {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        if (!t.includes('URI="')) return line;
        return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${proxify(u, baseUrl)}"`);
      }
      return proxify(t, baseUrl);
    })
    .join('\n');
}

function isPlaylist(res: IncomingMessage, url: string): boolean {
  const ct = (res.headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('mpegurl')) return true;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.m3u8');
}

export const GET = withApi('sports/stream', async (request) => {
  const limited = enforceRateLimit(request, 'stream');
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('u');
  if (!raw) return new Response('missing u', { status: 400 });

  // Full SSRF gate: scheme, credentials, obfuscated-host normalization,
  // DNS resolution and public-IP assertion.
  let target: ResolvedTarget;
  try {
    target = await assertPublicHttpUrl(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'blocked';
    return new Response(`blocked: ${reason}`, { status: 403 });
  }

  const opened = await openStream(target);
  if (!opened) {
    return new Response('upstream unreachable', { status: 502 });
  }
  const { res, target: finalTarget } = opened;

  // Abort the upstream fetch if the browser goes away.
  request.signal.addEventListener('abort', () => res.destroy());

  const upstreamPath = new URL(finalTarget.url).pathname;

  if (isPlaylist(res, finalTarget.url)) {
    const body = await readBody(res, PLAYLIST_MAX_BYTES);
    if (!body.startsWith('#EXTM3U')) {
      return new Response('not a playlist', { status: 502 });
    }
    res.destroy(); // body fully consumed
    return new Response(rewritePlaylist(body, finalTarget.url), {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
      },
    });
  }

  // Media segment / key / map — content-type must look like media.
  if (!contentTypeAllowed(res.headers['content-type'] ?? null, upstreamPath)) {
    res.destroy();
    return new Response('content type not allowed', { status: 415 });
  }

  const contentType = res.headers['content-type'] ?? 'video/mp2t';
  let forwarded = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      res.on('data', (c: Buffer) => {
        forwarded += c.length;
        if (forwarded > SEGMENT_MAX_BYTES) {
          res.destroy();
          try {
            controller.close();
          } catch {
            // already closed
          }
          return;
        }
        try {
          controller.enqueue(new Uint8Array(c));
        } catch {
          // downstream gone
        }
      });
      res.on('end', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      res.on('error', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      res.destroy();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
    },
  });
});
