import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Security headers live in TWO places, deliberately:
//   * src/middleware.ts — everything dynamic: the nonce-based Content
//     Security Policy (production: 'strict-dynamic' + per-request nonce, no
//     unsafe-inline/unsafe-eval for scripts), HSTS, the CSRF cookie, and the
//     general security headers for application responses.
//   * src/app/api/player-proxy/route.ts — its own tight CSP (provider
//     frame-src allowlist + the middleware nonce).
//   * below — static asset responses only (the middleware matcher excludes
//     _next/static and _next/image, so they get their headers here).
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Tree-shake barrel imports — lucide-react pulls 1500+ icons otherwise.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
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
        // Static assets only — dynamic responses get the full middleware
        // treatment (CSP/HSTS/nosniff/etc.).
        source: "/_next/static/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
