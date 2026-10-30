#!/usr/bin/env bash
# Guarded `prisma db push` entrypoint — the implementation behind `bun run db:push`.
#
# WHY THIS EXISTS (Task 48): the platform pipeline hard-codes `bun run db:push`
# in TWO places and both fail hard when the script is missing:
#   - .zscripts/dev.sh (sandbox dev boot)                 → plain `bun run db:push`
#   - .zscripts/database-runtime-build.sh (deploy packaging)
#         → DATABASE_URL="file:$BUILD_DIR/db/custom.db" bun run db:push
# Task 47 removed the script (to keep destructive pushes away from the live
# DB) — with `set -euo pipefail` both pipelines then died on
# "error: Missing script: db:push", which is exactly the recurring
# "Sorry, there was a problem deploying the code" failure.
#
# CONTRACT: `bun run db:push` must exist and exit 0 in the platform flows, so
# this wrapper restores it — but keeps the live database protected:
#   * target resolves to the LIVE project DB (or DATABASE_URL unset)
#       → non-destructive `prisma migrate deploy` (additive, journal-replayed,
#         never drops data) — also self-heals a platform-reset empty DB.
#   * target is any other file (e.g. the /tmp/build_fullstack_* packaging copy)
#       → real `prisma db push --skip-generate`, exactly what packaging expects.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DB="$(realpath -m "$PROJECT_ROOT/db/custom.db")"

DB_URL="${DATABASE_URL:-}"
case "$DB_URL" in
  file:/*) TARGET_DB="$(realpath -m "${DB_URL#file:}")" ;;
  file:*)  TARGET_DB="$(realpath -m "$PROJECT_ROOT/${DB_URL#file:}")" ;;
  *)       TARGET_DB="$LIVE_DB" ;;
esac

cd "$PROJECT_ROOT"

if [ "$TARGET_DB" = "$LIVE_DB" ]; then
  echo "[db-push-guard] target is the LIVE database ($TARGET_DB)"
  echo "[db-push-guard] 'prisma db push' can drop data — running safe 'prisma migrate deploy' instead."
  if bunx prisma migrate deploy; then
    exit 0
  fi
  # Drift fallback (2026-10-30 incident): the platform snapshot restore can
  # bring back a PRE-migrations DB — tables exist but there is no
  # `_prisma_migrations` journal — so `migrate deploy` can never apply the
  # baseline and every DB-backed feature 500s (login showed "Wrong email or
  # password."). Detect that exact shape, back the stale file up, and replay
  # migrations on a fresh DB. Never silently destroys: the old file is kept.
  echo "[db-push-guard] 'migrate deploy' failed — checking for a pre-migrations DB (no journal)."
  if [ -f "$TARGET_DB" ] &&
     ! echo "SELECT 1 FROM _prisma_migrations LIMIT 1;" |
        bunx prisma db execute --stdin --schema prisma/schema.prisma >/dev/null 2>&1; then
    STALE_BAK="${TARGET_DB}.stale-$(date +%Y%m%d-%H%M%S).bak"
    echo "[db-push-guard] schema-stale DB without migrations journal detected."
    echo "[db-push-guard] backing it up to ${STALE_BAK} and replaying migrations on a fresh DB."
    mv "$TARGET_DB" "$STALE_BAK"
    if bunx prisma migrate deploy; then
      echo "[db-push-guard] migrations replayed OK — stale DB preserved at ${STALE_BAK}."
      exit 0
    fi
  fi
  echo "[db-push-guard] could not heal the database automatically — failing loudly."
  exit 1
fi

echo "[db-push-guard] target is a build/packaging copy ($TARGET_DB) — running real 'prisma db push'."
exec bunx prisma db push --skip-generate
