/**
 * Player pipeline diagnostic — login, scan a known-good title, load the
 * player proxy and report exactly where "shows nothing" comes from.
 */
const BASE = 'http://localhost:3000';

async function main() {
  // 1. Login as admin (credentials from ADMIN_EMAIL/ADMIN_PASSWORD env)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) {
    console.error('set ADMIN_EMAIL and ADMIN_PASSWORD (in .env) before running');
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPass }),
  });
  console.log('login:', login.status);
  const setCookie = login.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) {
    console.log('NO SESSION COOKIE — login failed:', await login.text());
    return;
  }

  // 2. Scan a hugely popular title (Breaking Bad S01E01) — embeds must have it
  const scan = await fetch(
    `${BASE}/api/scan?imdb=tt0903747&type=tv&s=1&e=1`,
    { headers: { cookie } },
  );
  console.log('scan:', scan.status);
  const scanBody = (await scan.json()) as { results?: Array<{ providerId: string; ok: boolean; status: number | null; ms: number; url?: string; lang?: string | null; finnishAudioConfirmed?: boolean }> };
  for (const r of scanBody.results ?? []) {
    console.log(
      `  ${r.providerId.padEnd(16)} ok=${String(r.ok).padEnd(5)} status=${String(r.status).padEnd(4)} ms=${String(r.ms).padEnd(5)} lang=${r.lang ?? '-'} fi=${r.finnishAudioConfirmed ? 'Y' : 'n'}`,
    );
    if (r.url) console.log(`      url: ${r.url}`);
  }
  const okCount = (scanBody.results ?? []).filter((r) => r.ok).length;
  console.log('online sources:', okCount, '/', (scanBody.results ?? []).length);

  // 3. Player proxy with the winning URL (or first provider URL)
  const firstOk = (scanBody.results ?? []).find((r) => r.ok);
  const probeUrl =
    firstOk?.url ??
    'https://2embed.cc/embed/tt0903747';
  const proxy = await fetch(
    `${BASE}/api/player-proxy?u=${encodeURIComponent(probeUrl)}`,
    { headers: { cookie }, redirect: 'manual' },
  );
  const proxyText = await proxy.text();
  console.log('proxy:', proxy.status, proxy.headers.get('content-type'), `len=${proxyText.length}`);
  console.log('proxy head:', proxyText.slice(0, 160).replace(/\n/g, ' '));

  // 4. Direct reachability of each provider embed page from sandbox
  const targets = [
    ['2embed', 'https://2embed.cc/embed/tt0903747'],
    ['2embed-alt', 'https://www.2embed.cc/embed/tt0903747'],
    ['vidsrc.cc', 'https://vidsrc.cc/v2/embed/tv/tt0903747/1/1'],
    ['vidsrc.to', 'https://vidsrc.to/embed/tv/tt0903747/1/1'],
    ['vidsrc.su', 'https://vidsrc.su/embed/tv/tt0903747/1/1'],
    ['vidlink', 'https://vidlink.pro/tv/tt0903747/1/1'],
    ['vidfast', 'https://vidfast.pro/tv/tt0903747/1/1'],
    ['embed.su', 'https://embed.su/embed/tv/tt0903747/1/1'],
    ['2embed tv', 'https://2embed.cc/embedtv/tt0903747&s=1&e=1'],
    ['vidsrc.vip', 'https://vidsrc.vip/embed/tv/tt0903747/1/1'],
  ];
  for (const [name, url] of targets) {
    const t0 = Date.now();
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
      const body = await res.text();
      const looksPlayer = /player|iframe|jwplayer|video|source/i.test(body.slice(0, 4000));
      const looksError = /not found|404|cannot get|error/i.test(body.slice(0, 1500));
      console.log(
        `  ${name.padEnd(10)} ${res.status} ${String(Date.now() - t0).padStart(5)}ms len=${String(body.length).padStart(7)} player-ish=${looksPlayer} err-ish=${looksError}`,
      );
    } catch (e) {
      console.log(`  ${name.padEnd(10)} FAIL ${(e as Error).message} (${Date.now() - t0}ms)`);
    }
  }
}

main().catch((e) => {
  console.error('diag failed:', e);
  process.exit(1);
});
