// HLS proxy for the Live Sports → TV Channels player.
//
// Why: iptv-org streams live on third-party CDNs that almost never send
// CORS headers, so hls.js in the browser can't fetch the playlists directly.
// This route pipes playlists + media segments through CineDeck's origin and
// rewrites every URI inside master/media playlists to point back at the
// proxy (variants, segments, EXT-X-KEY, EXT-X-MAP, renditions…).
// It also fixes mixed content: http:// segment URLs become same-origin https.
//
// Safety: only http(s) targets, private/loopback hosts blocked, redirects
// followed manually (max 4), nothing else is forwarded.

import https from 'node:https';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';

const OPEN_TIMEOUT_MS = 12_000;

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

/** Open a GET stream, following up to 4 redirects, pinned to IPv4. */
function openStream(url: string, depth = 0): Promise<{ res: IncomingMessage; url: string } | null> {
  return new Promise((resolve) => {
    if (depth > 4) {
      resolve(null);
      return;
    }
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(
      url,
      {
        family: 4,
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
          resolve(openStream(new URL(location, url).toString(), depth + 1));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          resolve(null);
          return;
        }
        resolve({ res, url });
      },
    );
    req.on('timeout', () => req.destroy(new Error('stream_timeout')));
    req.on('error', () => resolve(null));
  });
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      res.destroy();
      resolve(text);
    };
    // Absolute cap — a trickling upstream must not hold the playlist hostage.
    const deadline = setTimeout(() => finish(''), 10_000);
    res.on('data', (c: Buffer) => chunks.push(c));
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('u');
  if (!raw) return new Response('missing u', { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response('bad u', { status: 400 });
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return new Response('bad protocol', { status: 400 });
  }
  if (isPrivateHost(target.hostname)) {
    return new Response('blocked host', { status: 403 });
  }

  const opened = await openStream(target.toString());
  if (!opened) {
    return new Response('upstream unreachable', { status: 502 });
  }
  const { res, url } = opened;

  // Abort the upstream fetch if the browser goes away.
  request.signal.addEventListener('abort', () => res.destroy());

  if (isPlaylist(res, url)) {
    const body = await readBody(res);
    if (!body.startsWith('#EXTM3U')) {
      return new Response('not a playlist', { status: 502 });
    }
    res.destroy(); // body fully consumed
    return new Response(rewritePlaylist(body, url), {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
      },
    });
  }

  // Media segment / key / map — pipe bytes straight through.
  const contentType = res.headers['content-type'] ?? 'video/mp2t';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      res.on('data', (c: Buffer) => {
        controller.enqueue(new Uint8Array(c));
      });
      res.on('end', () => controller.close());
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
}
