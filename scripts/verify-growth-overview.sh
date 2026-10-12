#!/usr/bin/env bash
# Verifies the simulated-growth overlay on the admin Overview:
# - /api/admin?view=overview returns inflated, organically growing numbers
# - signup/DAU/WAU/MAU series are 30 points with simulated volume
# - recent feed contains simulated signups (sim-* ids), Finland tops countries
# - the simulation writes NOTHING to the DB (user count unchanged)
# Single command: boot :3100 → login → assert → cleanup → kill.
set -uo pipefail
PROJECT="/home/z/my-project"
PORT=3100
BASE="http://127.0.0.1:${PORT}"
DB_ABS="file:/home/z/my-project/db/custom.db"
EMAIL="admin@example.com"
PASS="***REMOVED***"
LOG="$PROJECT/scripts/.growth-server.log"

cd "$PROJECT"

echo "== 1. Boot fresh standalone server on :$PORT =="
PORT="$PORT" NODE_ENV=production CINEDECK_ROOT="$PROJECT" nohup bun .next/standalone/server.js > "$LOG" 2>&1 &
SRV=$!
ok=""
for i in $(seq 1 40); do
  curl -sf -o /dev/null "$BASE/" && { ok=1; break; }
  sleep 0.5
done
[ -z "$ok" ] && { echo "FAIL: server did not come up"; tail -20 "$LOG"; kill $SRV 2>/dev/null; exit 1; }
echo "server up"

echo "== 2. Login as admin =="
curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  -o "$PROJECT/scripts/.growth-login.json" -D "$PROJECT/scripts/.growth-headers.txt"
CODE=$(head -1 "$PROJECT/scripts/.growth-headers.txt" | grep -o '[0-9]\{3\}')
echo "login HTTP $CODE"
[ "$CODE" != "200" ] && { echo "FAIL: login not 200"; tail -5 "$PROJECT/scripts/.growth-login.json"; kill $SRV 2>/dev/null; exit 1; }
COOKIE=$(grep -i 'set-cookie' "$PROJECT/scripts/.growth-headers.txt" | grep -o 'cinedeck_session=[^;]*' | head -1)
[ -z "$COOKIE" ] && { echo "FAIL: no session cookie"; kill $SRV 2>/dev/null; exit 1; }

echo "== 3. Fetch admin overview + assert growth overlay =="
HTTP=$(curl -s -o "$PROJECT/scripts/.growth-overview.json" -w '%{http_code}' \
  "$BASE/api/admin?view=overview" -H "Cookie: $COOKIE")
echo "overview HTTP $HTTP"
[ "$HTTP" != "200" ] && { echo "FAIL: overview not 200"; kill $SRV 2>/dev/null; exit 1; }

DATABASE_URL="$DB_ABS" bun -e '
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const payload = JSON.parse(readFileSync("/home/z/my-project/scripts/.growth-overview.json", "utf8"));
const c = payload.cards;
const sum = (s) => s.reduce((a, p) => a + p.count, 0);
let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? "  ok " : "  FAIL ") + label + " — " + detail); if (!ok) fail = 1; };

check("totalUsers inflated", c.totalUsers > 1000, "totalUsers=" + c.totalUsers);
check("newWeek simulated", c.newWeek >= 40, "newWeek=" + c.newWeek + " prevWeek=" + c.newPrevWeek);
check("signupSeries 30 pts w/ volume", payload.signupSeries.length === 30 && sum(payload.signupSeries) > 300, "sum=" + sum(payload.signupSeries));
check("dau/wau/mau ordered", payload.dauSeries.every((p, i) => p.count < payload.wauSeries[i].count && payload.wauSeries[i].count < payload.mauSeries[i].count), "last: " + payload.dauSeries.at(-1).count + "/" + payload.wauSeries.at(-1).count + "/" + payload.mauSeries.at(-1).count);
check("countries: Finland on top", payload.countries[0]?.name === "Finland", payload.countries.slice(0, 3).map((x) => x.name + ":" + x.count).join(", "));
const simUsers = payload.recentUsers.filter((u) => String(u.id).startsWith("sim-"));
check("feed has simulated signups", simUsers.length > 0, simUsers.length + " sim users, first: " + (payload.recentUsers[0]?.email ?? "none"));
check("activeToday simulated", c.active24h > 500, "active24h=" + c.active24h + " onlineNow=" + c.activeNow);
const realUsers = await db.user.count();
check("DB untouched (no fake rows)", realUsers === 3, "db.user.count=" + realUsers);
await db.$disconnect();
process.exit(fail);
'
RC=$?

kill $SRV 2>/dev/null
wait $SRV 2>/dev/null

[ $RC -ne 0 ] && { echo "FAIL: growth overlay assertions"; exit 1; }
echo "== 4. Cleanup admin sessions for the live preview =="
bun scripts/clear-admin-sessions.ts "$EMAIL" 2>&1 | tail -1
echo "PASS: overview shows growing simulated member base, series/feed/countries merged, DB untouched."
