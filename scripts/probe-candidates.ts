/**
 * Probe current pool + fresh candidate embed providers.
 * Measures: HTTP status, latency, body sniff, X-Frame-Options / CSP frame-ancestors.
 * Tests both TMDB and IMDB id forms with known-good titles:
 *   The Matrix    movie: tmdb 603,  imdb tt0133093
 *   Breaking Bad  tv:    tmdb 1396, imdb tt0903747  S01E01
 * Run: bun scripts/probe-candidates.ts
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface ProbeRow {
  name: string;
  url: string;
  status: number | string;
  ms: number;
  xfo: string;
  csp: string;
  sniff: string;
}

const SNIFF_BAD = [
  'cannot get',
  'not found',
  '<title>error',
  'just a moment', // CF challenge
  'enable javascript',
  'checking your browser',
];

async function probe(name: string, url: string): Promise<ProbeRow> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - started;
    let body = '';
    const reader = res.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      body = new TextDecoder().decode(value ?? new Uint8Array()).slice(0, 3000);
      void reader.cancel();
    }
    const lower = body.toLowerCase();
    const bad = SNIFF_BAD.find((p) => lower.includes(p));
    const xfo = res.headers.get('x-frame-options') ?? '-';
    const cspRaw = res.headers.get('content-security-policy') ?? '-';
    const csp = cspRaw.includes('frame-ancestors')
      ? `FA(${cspRaw.match(/frame-ancestors[^;]*/i)?.[0]?.slice(0, 40) ?? '?'})`
      : '-';
    const sniff = (bad ? `BAD:${bad}` : res.ok ? `ok len~${body.length}` : `http ${res.status}`).slice(0, 60);
    return { name, url, status: res.status, ms, xfo, csp, sniff };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 40) : 'err';
    return { name, url, status: 'ERR', ms: Date.now() - started, xfo: '-', csp: '-', sniff: msg };
  }
}

async function main() {
  const M_T = 603, M_I = 'tt0133093';
  const T_T = 1396, T_I = 'tt0903747', S = 1, E = 1;

  const candidates: Array<{ name: string; movie: string[]; tv: string[] }> = [
    // --- current pool re-verification ---
    { name: '2embed.cc', movie: [`https://www.2embed.cc/embed/${M_I}`, `https://www.2embed.cc/embed/${M_T}`], tv: [`https://www.2embed.cc/embedtv/${T_I}&s=${S}&e=${E}`] },
    { name: '2embed.skin', movie: [`https://2embed.skin/embed/${M_I}`], tv: [`https://2embed.skin/embedtv/${T_I}&s=${S}&e=${E}`] },
    { name: 'vidsrc.sh', movie: [`https://vidsrc.sh/embed/movie/${M_I}`, `https://vidsrc.sh/embed/movie/${M_T}`], tv: [`https://vidsrc.sh/embed/tv/${T_I}/${S}/${E}`] },
    { name: 'vidsrc.cc', movie: [`https://vidsrc.cc/embed/movie/${M_I}`], tv: [`https://vidsrc.cc/embed/tv/${T_I}/${S}/${E}`] },
    { name: 'vidsrc.su', movie: [`https://vidsrc.su/embed/movie/${M_I}`], tv: [`https://vidsrc.su/embed/tv/${T_I}/${S}/${E}`] },
    { name: 'vidfast.pro', movie: [`https://vidfast.pro/movie/${M_T}`, `https://vidfast.pro/movie/${M_I}`], tv: [`https://vidfast.pro/tv/${T_T}/${S}/${E}`] },
    { name: 'vidlink.pro', movie: [`https://vidlink.pro/movie/${M_T}`, `https://vidlink.pro/movie/${M_I}`], tv: [`https://vidlink.pro/tv/${T_T}/${S}/${E}`] },
    { name: 'videasy.to', movie: [`https://player.videasy.to/movie/${M_T}`, `https://player.videasy.to/movie/imdb/${M_I}`], tv: [`https://player.videasy.to/tv/${T_T}/${S}/${E}`] },
    { name: 'videasy.net', movie: [`https://player.videasy.net/movie/${M_T}`], tv: [`https://player.videasy.net/tv/${T_T}/${S}/${E}`] },
    // --- previously dead, quick re-check (things revive) ---
    { name: 'vidsrc.to (old king)', movie: [`https://vidsrc.to/embed/movie/${M_T}`], tv: [] },
    { name: 'vidsrc.me', movie: [`https://vidsrc.me/embed/movie/${M_T}`], tv: [] },
    { name: 'vidora.su', movie: [`https://vidora.su/movie/${M_T}`, `https://vidora.su/movie/${M_I}`], tv: [`https://vidora.su/tv/${T_T}/${S}/${E}`] },
    { name: 'multiembed.mov', movie: [`https://multiembed.mov/?video_id=${M_I}`], tv: [] },
    { name: 'embed.su', movie: [`https://embed.su/embed/movie/${M_T}`], tv: [] },
    { name: 'vidjoy.pro', movie: [`https://vidjoy.pro/embed/movie/${M_T}`], tv: [] },
    // --- never measured before ---
    { name: 'vixsrc.to', movie: [`https://vixsrc.to/movie/${M_T}`], tv: [`https://vixsrc.to/tv/${T_T}/${S}/${E}`] },
    { name: 'xprime.gg', movie: [`https://xprime.gg/embed/movie/${M_T}`, `https://xprime.gg/movie/${M_I}`], tv: [`https://xprime.gg/embed/tv/${T_T}/${S}/${E}`] },
    { name: 'xprime.tv', movie: [`https://xprime.tv/watch/${M_I}`], tv: [] },
    { name: 'vidzee.wtf', movie: [`https://player.vidzee.wtf/embed/movie/${M_T}`, `https://vidzee.wtf/embed/movie/${M_T}`], tv: [`https://player.vidzee.wtf/embed/tv/${T_T}/${S}/${E}`] },
    { name: 'vidcore.org', movie: [`https://vidcore.org/embed/movie/${M_T}`, `https://vidcore.created.app/embed/movie/${M_T}`], tv: [`https://vidcore.org/embed/tv/${T_T}/${S}/${E}`] },
    { name: 'rgshows.me', movie: [`https://player.rgshows.me/embed/movie/${M_T}`], tv: [] },
    { name: 'uembed.site', movie: [`https://uembed.site/embed/movie/${M_T}`], tv: [] },
    { name: 'vidsrc.wtf', movie: [`https://vidsrc.wtf/embed/movie/${M_T}`], tv: [] },
  ];

  const rows: ProbeRow[] = [];
  for (const c of candidates) {
    for (const u of [...c.movie, ...c.tv]) {
      rows.push(await probe(`${c.name}${c.tv.includes(u) ? ' [TV]' : ''}`, u));
    }
  }

  console.log(
    ['provider'.padEnd(24), 'st'.padEnd(6), 'ms'.padEnd(6), 'xfo'.padEnd(12), 'csp'.padEnd(46), 'sniff'].join('  '),
  );
  for (const r of rows) {
    console.log(
      [
        r.name.padEnd(24),
        String(r.status).padEnd(6),
        String(r.ms).padEnd(6),
        r.xfo.padEnd(12),
        r.csp.padEnd(46),
        r.sniff,
      ].join('  '),
    );
  }
}

void main();
// Module marker — without this the file compiles as a global script and its
// `probe` helper collides with scripts/diag-player.ts (TS2393).
export {};
