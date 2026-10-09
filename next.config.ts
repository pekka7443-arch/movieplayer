import type { NextConfig } from "next";
import { PROVIDERS } from "./src/lib/providers";

// ---------------------------------------------------------------------------
// Player frame hosts — derived from the provider list so a new source can
// never be forgotten in the CSP. The player itself is loaded same-origin via
// /api/player-proxy, which nests the provider iframe; frame-src must allow
// both.
// ---------------------------------------------------------------------------
function playerFrameHosts(): string[] {
  const hosts = new Set<string>();
  const sample = (url: string) => {
    try {
      const u = new URL(url);
      hosts.add(`https://${u.host}`);
      if (!u.host.startsWith("www.")) hosts.add(`https://www.${u.host}`);
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
  return [...hosts];
}

// ---------------------------------------------------------------------------
// Framing allowlist — the z.ai platform preview (and the published site's
// dashboard) embed this app inside an iframe on chat.z.ai / *.z.ai /
// *.space-z.ai. Blocking those ancestors breaks the platform's preview and
// Publish flow, so they must stay allowed. Everything else is still denied.
// NOTE: no X-Frame-Options header is emitted anywhere — it cannot express
// multiple origins and would conflict with frame-ancestors.
// ---------------------------------------------------------------------------
const FRAME_ANCESTORS = [
  "'self'",
  "https://*.z.ai",
  "https://chat.z.ai",
  "https://*.space-z.ai",
  "http://localhost:*",
].join(" ");

// Outbound embed hosts — the User Experience layer's legacy-media reference
// clip plays from the privacy-preserving archive host. Kept explicit: the
// default frame-src is 'self' + player providers only.
const EMBED_FRAME_HOSTS = [
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
];

const FRAME_SOURCES = ["'self'", ...EMBED_FRAME_HOSTS, ...playerFrameHosts()].join(" ");

const CSP = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts and dev needs eval — scoped as
  // far as the framework allows without per-request nonces.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  `frame-src ${FRAME_SOURCES}`,
  // hls.js spins up blob: workers for some transmuxing paths; the service
  // worker shell is same-origin.
  "worker-src 'self' blob:",
  // Allow the platform preview iframe + same-origin nesting, nothing else.
  `frame-ancestors ${FRAME_ANCESTORS}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Native/dirname-dependent server packages must stay outside the bundler:
  // geoip-lite loads its MaxMind .dat files relative to __dirname, which the
  // bundler rewrites to a virtual /ROOT and breaks module init.
  serverExternalPackages: ["geoip-lite", "qrcode", "nodemailer"],
  // Type errors fail the build — no more silent ignoreBuildErrors.
  typescript: {
    ignoreBuildErrors: false,
  },
  // ---------------------------------------------------------------------------
  // Isolated artifact dirs — dev and build never share .next anymore.
  //
  // WHY: `next build` while `next dev` is live (the platform publish flow)
  // made Turbopack emit HTML/chunks referencing chunk hashes the build later
  // pruned — the deployed app 500'd on 3 static chunks (ChunkLoadError).
  // - `bun run dev`  → NEXT_DEV_DIST_DIR=.next-dev (preview keeps its own tree,
  //   immune to publish builds; builds must own .next exclusively)
  // - `bun run build` → plain `next build` into .next (the platform's
  //   .zscripts/build.sh hard-codes .next/standalone + .next/static paths).
  // ---------------------------------------------------------------------------
  distDir: process.env.NEXT_DEV_DIST_DIR
    ? `${process.env.NEXT_DEV_DIST_DIR}`
    : ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "www.themoviedb.org" },
      // Cinemeta / Stremio poster CDN (keyless mode).
      { protocol: "https", hostname: "assets.metahub.space" },
      { protocol: "https", hostname: "images.metahub.space" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // X-Frame-Options deliberately omitted: it cannot express the
          // multi-origin allowlist the platform preview needs — CSP
          // frame-ancestors above is the single source of truth.
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // The player proxy page nests provider iframes. Its frame-ancestors
        // must match the main app's: frame-ancestors validates the FULL
        // ancestor chain, so when the app itself is embedded in the platform
        // preview iframe, the proxy page's ancestors include chat.z.ai too.
        source: "/api/player-proxy",
        headers: [
          { key: "Content-Security-Policy", value: `frame-src 'self' ${playerFrameHosts().join(" ")}; frame-ancestors ${FRAME_ANCESTORS}; object-src 'none'; base-uri 'none'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
