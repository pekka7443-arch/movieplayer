/**
 * Frame-blocking header check — X-Frame-Options / CSP frame-ancestors on
 * every provider embed URL. A DENY/SAMEORIGIN here = blank player in every
 * real browser even though the sandbox scan sees HTTP 200.
 */
export {};

const TARGETS: Array<[string, string]> = [
  ['twoembed_cc', 'https://www.2embed.cc/embedtv/tt0903747&s=1&e=1'],
  ['twoembed_skin', 'https://2embed.skin/embedtv/tt0903747&s=1&e=1'],
  ['vidsrc_sh', 'https://vidsrc.sh/embed/tv/tt0903747/1/1'],
  ['vidsrc_cc', 'https://vidsrc.cc/embed/tv/tt0903747/1/1'],
  ['vidsrc_su', 'https://vidsrc.su/embed/tv/tt0903747/1/1'],
  ['vidfast', 'https://vidfast.pro/tv/tt0903747/1/1'],
  ['videasy', 'https://player.videasy.to/tv/imdb/tt0903747/1/1'],
  ['videasy_net', 'https://player.videasy.net/tv/imdb/tt0903747/1/1'],
];

for (const [name, url] of TARGETS) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,*/*',
      },
      signal: AbortSignal.timeout(8000),
    });
    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const ancestors = csp?.match(/frame-ancestors[^;]*/i)?.[0] ?? null;
    const cfo = res.headers.get('cross-origin-opener-policy');
    const corp = res.headers.get('cross-origin-resource-policy');
    const coep = res.headers.get('cross-origin-embedder-policy');
    console.log(
      `${name.padEnd(14)} ${res.status}  XFO=${xfo ?? '-'}  ancestors=${ancestors ?? '-'}  COOP=${cfo ?? '-'} CORP=${corp ?? '-'} COEP=${coep ?? '-'}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(14)} FAIL ${(e as Error).message}`);
  }
}
