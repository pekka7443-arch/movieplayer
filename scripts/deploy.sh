#!/usr/bin/env bash
# CineDeck deploy — SAFE BY DESIGN. This is the ONLY supported deploy path.
#
# What it does (and NOTHING else):
#   1. AUTH_SECRET — generate ONCE on the very first boot into .env.
#      If a valid value already exists it is NEVER touched, so stateless auth
#      links keep working across redeploys (sessions never depended on it).
#   2. Snapshot backup of the SQLite database into db/backups/ (keep last 10)
#      — a rollback point in case anything unexpected happens later.
#   3. `prisma migrate deploy` — applies PENDING migrations only. It NEVER
#      resets, drops or recreates data.
#   4. `prisma generate` + `bun run build`.
#
# NEVER run on deploy (destroys all users/sessions instantly):
#   prisma db push, prisma db push --force-reset, prisma migrate reset.
# These scripts were removed from package.json on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- 1. AUTH_SECRET: restore from DB if wiped, else generate ONCE -----------
# The database (SystemState.auth_secret, written on the first boot) is the
# source of truth: if the platform reset wiped .env, the ORIGINAL secret is
# restored so reset/verification links keep working. A fresh secret is only
# generated on the literal first boot (no .env value AND nothing stored).
bun scripts/restore-auth-secret.ts || echo "[deploy] note: restore step skipped"
if grep -q "^AUTH_SECRET=..*" .env 2>/dev/null; then
  echo "[deploy] AUTH_SECRET already set — leaving it untouched"
else
  SECRET="$(openssl rand -hex 32)"
  if grep -q "^AUTH_SECRET=" .env 2>/dev/null; then
    # Line exists but is empty/placeholder — fill it in place.
    sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${SECRET}|" .env
  elif [ -f .env ]; then
    printf '\nAUTH_SECRET=%s\n' "$SECRET" >> .env
  else
    printf 'AUTH_SECRET=%s\n' "$SECRET" > .env
  fi
  echo "[deploy] AUTH_SECRET generated once into .env (will never be regenerated)"
fi

# --- 2. DATABASE_URL sanity: must point at the persistent SQLite file -------
if ! grep -q "^DATABASE_URL=file:" .env 2>/dev/null; then
  echo "[deploy] FATAL: DATABASE_URL missing from .env — refusing to deploy" >&2
  exit 1
fi
DB_FILE="$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's|^file:||')"
echo "[deploy] DATABASE_URL → ${DB_FILE} (persistent project path, never deleted)"

# --- 3. Safety-net backup (best-effort; a deploy never continues without it being taken) ---
if [ -f "$DB_FILE" ]; then
  mkdir -p db/backups
  cp "$DB_FILE" "db/backups/custom-$(date +%Y%m%d-%H%M%S).db"
  # Keep the 10 most recent snapshots.
  ls -1t db/backups/custom-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
  echo "[deploy] DB snapshot written to db/backups/"
else
  echo "[deploy] note: DB file does not exist yet — migrations will create it"
fi

# --- 4. Migrations (deploy only) + client + build ---------------------------
bunx prisma migrate deploy
bunx prisma generate
bun run build

# --- 5. Runtime environment for the standalone bundle -----------------------
# SECURITY (2026-11-03): the standalone bundle NO LONGER receives a copy of
# the project .env — packaging secrets into a distributable artifact is a
# leak vector. The platform start command (package.json "start") provides the
# only non-secret the runtime needs (DATABASE_URL) and sets CINEDECK_ROOT,
# under which the auth-secret-store / seed resolve AUTH_SECRET, ADMIN_* and
# APP_BASE_URL from the PROJECT .env at boot. Nothing sensitive ships inside
# .next/standalone.
if [ -f .next/standalone/.env ]; then
  rm -f .next/standalone/.env
  echo "[deploy] removed stale .env copy from the standalone bundle"
fi

# --- 6. Database file permissions -------------------------------------------
# The SQLite file holds password hashes, session hashes and sealed TOTP
# secrets — restrict it to the owning user (2026-11-03 hardening).
if [ -f "$DB_FILE" ]; then
  chmod 600 "$DB_FILE"
  echo "[deploy] db file permissions set to 0600"
fi

echo "[deploy] done — no data was touched."
