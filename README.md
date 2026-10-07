# CineDeck

A free, keyless-first streaming frontend: movies, series, Finnish content, live sports, replays and a small arcade — driven by TMDB/IMDB ids. Built with **Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + Prisma (SQLite) + React Query + bun**.

Everything in this README is also true for the platform preview/publish flow: the app must render inside the platform's iframe, `bun run build` must be clean, and a fresh machine must be able to `bun run start` with zero manual steps.

---

## Quick start

```bash
bun install
bun run db:push        # or: bunx prisma migrate deploy
bun run dev            # http://localhost:3000 (0.0.0.0:3000)
```

Production:

```bash
bun run build          # standalone output in .next/standalone
bun run start
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | SQLite file (`file:./db/custom.db`). Prisma migrate works out of the box on a fresh file. |
| `AUTH_SECRET` | no (dev) / effectively yes (prod) | Session/token signing. If missing, the app **self-heals**: it generates a stable random secret and persists it into `.env` (a warning is logged). It only hard-fails when `NODE_ENV=production` **and** `PUBLISH_STRICT=1`. |
| `TMDB_API_KEY` | no | Optional server-wide TMDB key. Users can also paste their own free key in Settings (stored in their browser, sent per-request). Without any key the app runs fully keyless via Cinemeta/TVmaze/ESPN/TheSportsDB. |
| `PUBLISH_STRICT` | no | Set to `1` to make missing critical env vars a hard startup failure instead of a warning. |
| `E2E_RATELIMIT_BYPASS` | no | Dev-only rate-limit bypass for Playwright (loopback + header gated; never affects production). |

See `.env.example` for the annotated list.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Dev server on `0.0.0.0:3000` (isolated `.next-dev` distDir so it never corrupts publish builds). |
| `bun run build` | Type-safe production build (no `ignoreBuildErrors`). |
| `bun run start` | Serves the standalone build. |
| `bun run lint` | ESLint (strict, react-hooks rules). |
| `bunx tsc --noEmit` | Typecheck. |
| `bun run db:push` | Fast schema sync for development. |
| `bunx prisma migrate deploy` | Applies migrations (the only supported way in production). |
| `bun run doctor` | PASS/FAIL self-check: env vars, DB connection, migrations, port 3000, `GET /` 200, CSP frame-ancestors, build artifacts, `/api/health`. |
| `bunx vitest run` | Unit tests (security core + feature logic). |
| `bun run test:e2e` | Playwright e2e (auth persistence). |

## Health & self-check

- `GET /api/health` → `{ok:true, db:{ok, latencyMs}, uptimeSeconds}` (used by platform monitors).
- `bun run doctor` → run before publishing; every required row must PASS.

## Architecture (one paragraph)

Single route (`/`) with a param-driven view system (`?id= watch · ?view=sports|stats|admin · ?person= · ?share=`) in `src/components/site/app-root.tsx`. Metadata comes from **keyless** sources (Cinemeta, TVmaze, ESPN, TheSportsDB, iptv-org) with an optional TMDB layer (rich details, discover-powered Explore filters, recommendations). Playback probes multiple public embed providers per title (`/api/scan`, health×reliability ranking, auto-failover watchdog); sports HLS goes through an SSRF-hardened proxy (`/api/sports/stream`, `/api/player-proxy`). Accounts/guests share the same library APIs with a device cookie; signed-in users get sessions (hashed tokens, sliding expiry, revocation), profiles (incl. kids), custom lists, comments, notifications and arcade scores. All mutating routes are Zod-validated, same-origin-checked and rate-limited.

```
src/
  app/                     # Next.js App Router
    page.tsx               # server hero seed + OG metadata for share links
    api/                   # ~40 route handlers (meta, tmdb, library, sports, auth, admin, arcade, og…)
    manifest.ts            # PWA manifest
  components/site/         # view system, player, sports, arcade, admin, banners…
  components/ui/           # shadcn/ui primitives
  hooks/                   # react-query hooks, voice search, media queries
  lib/                     # client libs (tmdb, library, store, settings, arcade-data…)
  lib/server/              # auth/sessions, rate limiting, CSRF, SSRF guards, caches, providers
  scripts/ (root)          # doctor.ts, verify-prod.sh, view sweeps
prisma/                    # schema + 4 idempotent migrations (fresh-DB deploy verified in CI)
tests/                     # vitest unit + playwright e2e
```

## Deploy / publish checklist

1. `bun run lint && bunx tsc --noEmit && bun run build` — all clean.
2. `bun run doctor` — all required checks PASS (CSP must list the platform hosts: `frame-ancestors 'self' https://*.z.ai https://chat.z.ai https://*.space-z.ai http://localhost:*`).
3. `bunx prisma migrate deploy` — applies cleanly to a fresh database.
4. `bun run start` → `GET /` 200, `GET /api/health` 200.

**Never** add `X-Frame-Options` (it breaks the platform iframe; `frame-ancestors` in `next.config.ts` is the single source of truth). `dev.sh` runs the dev server in an isolated distDir — publishing builds must own `.next` (this fixed a real chunk-corruption publish break).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Preview blank / publish button broken | Check CSP `frame-ancestors` + absence of `X-Frame-Options` (`bun run doctor`). |
| `ChunkLoadError` on deployed app | Re-run `bun run build` with the dev server stopped (or use the isolated dev distDir); verify with `scripts/verify-prod.sh`. |
| "migrations not applied" on fresh DB | `bunx prisma migrate deploy` (never rely on a committed `db/custom.db`). |
| Provider plays a black screen | Use the player's Skip-source / "Not playing?" pill — the scanner ranks and fails over automatically. |
| TMDB features missing (cast, filters, recommendations) | Add a free TMDB key in Settings — everything else stays keyless. |
| Arcade leaderboard empty after DB reset | Re-run `bunx prisma migrate deploy` (ArcadeScore table). |
