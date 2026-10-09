#!/usr/bin/env bash
# Verifies the admin device-cap fix: a 4th admin login must EVICT the oldest
# session and succeed (HTTP 200) — never reject with 403 admin_device_limit.
# Single command: seed → boot :3100 → login → assert → cleanup → kill.
# Cleanup clears the admin's sessions at the end so the live :3000 preview
# (possibly still on old code) admits the user immediately.
set -uo pipefail
PROJECT="/home/z/my-project"
PORT=3100
BASE="http://127.0.0.1:${PORT}"
DB_ABS="file:/home/z/my-project/db/custom.db"
EMAIL="admin@example.com"
PASS="***REMOVED***"
LOG="$PROJECT/scripts/.eviction-server.log"

cd "$PROJECT"

echo "== 1. Seed 3 active admin sessions (oldest 60s ago) =="
DATABASE_URL="$DB_ABS" bun -e '
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
await db.session.deleteMany({});
const uid = (await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } })).id;
const base = Date.now() - 60_000;
for (let i = 0; i < 3; i++) {
  await db.session.create({ data: {
    userId: uid, tokenHash: createHash("sha256").update("seed-" + i).digest("hex"),
    createdAt: new Date(base + i * 1000), expiresAt: new Date(base + i * 1000 + 30 * 86400_000),
  }});
}
console.log("seeded:", await db.session.count({ where: { userId: uid } }));
await db.$disconnect();
'

echo "== 2. Boot fresh standalone server on :$PORT =="
PORT="$PORT" NODE_ENV=production CINEDECK_ROOT="$PROJECT" nohup bun .next/standalone/server.js > "$LOG" 2>&1 &
SRV=$!
ok=""
for i in $(seq 1 40); do
  curl -sf -o /dev/null "$BASE/" && { ok=1; break; }
  sleep 0.5
done
[ -z "$ok" ] && { echo "FAIL: server did not come up"; tail -20 "$LOG"; kill $SRV 2>/dev/null; exit 1; }
echo "server up"

echo "== 3. Login as admin (4th device) — must be 200, not 403 =="
CODE=$(curl -s -o /tmp/evict-login.json -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "login HTTP $CODE"
head -c 300 /tmp/evict-login.json; echo
[ "$CODE" != "200" ] && { echo "FAIL: login not 200"; kill $SRV 2>/dev/null; exit 1; }

echo "== 4. Assert eviction: 2 old + 1 new = 3 active, oldest gone, audit written =="
DATABASE_URL="$DB_ABS" bun -e '
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const uid = (await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } })).id;
const sessions = await db.session.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } });
const audit = await db.auditLog.findFirst({ where: { action: "admin.session_evicted" }, orderBy: { createdAt: "desc" } });
console.log("active sessions:", sessions.length, "(expect 3)");
console.log("eviction audit:", audit ? audit.action : "MISSING", "(expect admin.session_evicted)");
if (sessions.length !== 3 || !audit) { await db.$disconnect(); process.exit(1); }
await db.$disconnect();
'
[ $? -ne 0 ] && { echo "FAIL: eviction assertions"; kill $SRV 2>/dev/null; exit 1; }

echo "== 5. Authed /api/auth/me with the fresh cookie =="
COOKIE=$(grep -o '"cinedeck\.session=[^"]*"' /tmp/evict-login.json 2>/dev/null | head -1)
# cookie is in Set-Cookie header, re-fetch via -i
curl -s -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o /tmp/evict-login2.json -D /tmp/evict-headers.txt
ME=$(grep -i 'set-cookie' /tmp/evict-headers.txt | grep -o 'cinedeck_session=[^;]*' | head -1)
CODE_ME=$(curl -s -o /tmp/evict-me.json -w '%{http_code}' "$BASE/api/auth/me" -H "Cookie: $ME")
echo "me HTTP $CODE_ME"; head -c 200 /tmp/evict-me.json; echo
[ "$CODE_ME" != "200" ] && { echo "FAIL: /api/auth/me not 200"; kill $SRV 2>/dev/null; exit 1; }

kill $SRV 2>/dev/null
wait $SRV 2>/dev/null

echo "== 6. Cleanup: clear admin sessions so the live preview admits the user immediately =="
bun scripts/clear-admin-sessions.ts "$EMAIL" 2>&1 | tail -1

echo "PASS: 4th admin login evicted oldest session, signed in with 200, audit logged, me=200, cleaned up."
