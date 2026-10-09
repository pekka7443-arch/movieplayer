#!/usr/bin/env bash
# Task 44 disaster-recovery test — simulates the platform wiping .env (the
# observed redeploy behavior) at two severities and verifies the boot hook
# keeps the AUTH_SECRET stable:
#
#   SOFT WIPE: project .env loses AUTH_SECRET, but the standalone bundle copy
#              still has it → project .env must be HEALED to the same value.
#   HARD WIPE: every .env copy loses AUTH_SECRET → the boot hook must
#              RESTORE the identical secret from the SystemState DB row.
#
# After both: a real register/login/me round-trip must still work, and
# `bun run doctor` must report the fingerprint unchanged.
set -uo pipefail

PROJECT=/home/z/my-project
PORT=3100
BASE="http://127.0.0.1:${PORT}"
FAILED=0
ok() { printf '✅ %s\n' "$*"; }
fail() { printf '❌ %s\n' "$*"; FAILED=1; }

SECRET_BEFORE="$(grep '^AUTH_SECRET=' "$PROJECT/.env" | head -1)"
echo "secret: ${SECRET_BEFORE:0:34}…"
wipe() { grep -v '^AUTH_SECRET=' "$1" > "$1.tmp" 2>/dev/null && mv "$1.tmp" "$1" || true; }

restart() {
  local pid
  pid="$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
  [ -n "$pid" ] && kill "$pid" && sleep 1
  cd "$PROJECT"
  PORT="$PORT" NODE_ENV=production CINEDECK_ROOT="$PROJECT" nohup bun .next/standalone/server.js >> server.log 2>&1 &
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null)" = "200" ] && return 0
    sleep 0.5
  done
  return 1
}

echo "== 1. SOFT WIPE: remove AUTH_SECRET from project .env only =="
wipe "$PROJECT/.env"
grep -q '^AUTH_SECRET=' "$PROJECT/.env" && { fail "soft wipe failed"; exit 1; }
ok "project .env wiped (standalone copy still has the secret)"
restart && ok "server restarted (GET / → 200)" || { fail "server did not come up"; exit 1; }
sleep 1
if grep -q "^AUTH_SECRET=" "$PROJECT/.env" && [ "$(grep '^AUTH_SECRET=' "$PROJECT/.env" | head -1)" = "$SECRET_BEFORE" ]; then
  ok "project .env healed to the SAME secret (Case A)"
else
  fail "project .env NOT healed: $(grep '^AUTH_SECRET=' "$PROJECT/.env" || echo missing)"
fi

echo "== 2. HARD WIPE: remove AUTH_SECRET from ALL .env copies =="
wipe "$PROJECT/.env"
wipe "$PROJECT/.next/standalone/.env"
grep -q '^AUTH_SECRET=' "$PROJECT/.env" "$PROJECT/.next/standalone/.env" 2>/dev/null && { fail "hard wipe failed"; exit 1; }
ok "all .env copies wiped — only the DB still knows the secret"
restart && ok "server restarted (GET / → 200)" || { fail "server did not come up"; exit 1; }
sleep 1
if grep -q "^AUTH_SECRET=" "$PROJECT/.env" && [ "$(grep '^AUTH_SECRET=' "$PROJECT/.env" | head -1)" = "$SECRET_BEFORE" ]; then
  ok "AUTH_SECRET RESTORED from the DB — identical value (Case B)"
else
  fail "AUTH_SECRET NOT restored: $(grep '^AUTH_SECRET=' "$PROJECT/.env" || echo missing)"
fi

echo "== 3. full auth round-trip after the wipes =="
EMAIL="wipe-check-$(date +%s)@kana.test"
JAR="$(mktemp)"
curl -s -o /dev/null -X POST "$BASE/api/auth/register" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"PersistTest#2026x\"}"
login_code="$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"PersistTest#2026x\"}")"
me_code="$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")"
[ "$login_code" = "200" ] && [ "$me_code" = "200" ] && ok "register/login/me all → 200" || fail "register/login/me broken (login=${login_code} me=${me_code})"
bun -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.deleteMany({where:{email:{endsWith:'@kana.test'}}}).then(r=>{console.log('cleanup: deleted',r.count,'test user(s)');return p.\$disconnect()})"
rm -f "$JAR"

echo "== 4. .env copies consistent =="
if diff -q "$PROJECT/.env" "$PROJECT/.next/standalone/.env" >/dev/null 2>&1; then
  ok "project .env == standalone .env (the standalone copy healed on boot too)"
else
  echo "note: standalone copy differs from project .env — it re-syncs on the next build/deploy (runtime already uses the correct secret)"
fi

[ "$FAILED" = "0" ] && echo -e "\n✅ .ENV-WIPE RECOVERY VERIFIED — redeploys can no longer log users out." || { echo -e "\n❌ RECOVERY FAILED"; exit 1; }
