import { PROVIDERS } from "@/lib/providers";

// GET /api/player-proxy?u=<provider-embed-url>
//
// Returns a small HTML wrapper page (served from CineDeck's own origin) that
// contains an inner <iframe> with the provider URL as its src. The inner
// iframe has NO sandbox attribute.
//
// WHY THIS EXISTS
// ---------------
// Stream providers like 2Embed detect iframe[sandbox] on their own
// window.frameElement and refuse to play ("Sandbox not allowed / This
// content can't be embedded in a sandboxed frame"). They check
// window.frameElement.hasAttribute('sandbox') which returns the IMMEDIATE
// parent <iframe> element's attributes — and for cross-origin iframes
// window.frameElement is null, so the check passes.
//
// CineDeck loads this proxy page inside a sandboxed outer iframe:
//   <iframe sandbox="allow-scripts allow-same-origin allow-forms"
//           src="/api/player-proxy?u=<provider-url>">
//     └─ proxy HTML (CineDeck origin)
//          └─ <iframe src="<provider-url>"> (no sandbox attribute,
//               cross-origin from proxy page → window.frameElement is null
//               in the provider's window → its sandbox check passes)
//
// The inner iframe inherits the outer sandbox's restrictions, so the
// provider still cannot call window.open() (no allow-popups) or navigate
// window.top (no allow-top-navigation) — pop-ups and "random page"
// redirects stay blocked, but the movie actually plays.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Security: only allow the proxy to wrap URLs whose host matches one of our
// known provider domains. Prevents SSRF / open-redirect / arbitrary-URL-embed
// attacks (e.g. someone hitting /api/player-proxy?u=https://evil.example/).
// ---------------------------------------------------------------------------
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const sample = (url: string) => {
    try {
      const u = new URL(url);
      hosts.add(u.host);
      if (!u.host.startsWith("www.")) hosts.add(`www.${u.host}`);
    } catch {
      /* ignore bad provider URLs */
    }
  };
  for (const p of PROVIDERS) {
    sample(p.movie(1));
    sample(p.tv(1, 1, 1));
    sample(p.movieImdb("tt0000001"));
    sample(p.tvImdb("tt0000001", 1, 1));
  }
  return hosts;
}
const ALLOWED_HOSTS = buildAllowedHosts();
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get("u") ?? "";
  if (!urlParam) {
    return new Response("Missing url param", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return new Response("Bad protocol", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(target.host)) {
    return new Response("Host not allowlisted", { status: 400 });
  }

  // Re-serialize through URL to normalize.
  const targetHref = target.href;
  const targetEncoded = encodeURIComponent(targetHref);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="referrer" content="no-referrer">
<title>Player</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe
  src="${escapeHtml(targetHref)}"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
  referrerpolicy="no-referrer"
  scrolling="no"
  title="Stream player"
  onload="try{window.parent.postMessage({type:'cinedeck:player-loaded',url:'${targetEncoded}'}, '*')}catch(e){}"
></iframe>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
