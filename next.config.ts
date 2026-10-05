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
  `frame-src 'self' ${playerFrameHosts().join(" ")}`,
  // The app must not be framed by third parties (clickjacking).
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Type errors fail the build — no more silent ignoreBuildErrors.
  typescript: {
    ignoreBuildErrors: false,
  },
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
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // The player proxy page nests provider iframes — it must stay
        // frameable by our own page only.
        source: "/api/player-proxy",
        headers: [
          { key: "Content-Security-Policy", value: `frame-src 'self' ${playerFrameHosts().join(" ")}; frame-ancestors 'self'; object-src 'none'; base-uri 'none'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
