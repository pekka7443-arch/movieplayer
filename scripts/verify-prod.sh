#!/bin/bash
# Verify production build integrity: every chunk referenced by / must exist,
# and key API routes must return 200.
set -u
cd /home/z/my-project
export DATABASE_URL="file:/home/z/my-project/db/custom.db"

env PORT=3100 HOSTNAME=127.0.0.1 NODE_ENV=production bun .next/standalone/server.js > /tmp/prod-server.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:3100/" && break; sleep 0.5; done

HTML=$(curl -s http://127.0.0.1:3100/)
echo "$HTML" | grep -oE '/_next/static/chunks/[a-z0-9]+\.js' | sort -u > /tmp/chunks-referenced.txt
echo "referenced chunks: $(wc -l < /tmp/chunks-referenced.txt)"
MISS=0
while read -r c; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3100$c")
  if [ "$CODE" != "200" ]; then
    echo "MISSING/BROKEN $CODE $c"
    MISS=$((MISS+1))
  fi
done < /tmp/chunks-referenced.txt
echo "broken chunks: $MISS"
for API in / /api/health /api/flags "/api/meta/popular?type=all" /manifest.webmanifest; do
  echo "$API => $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3100$API")"
done
ls .next/standalone/.next/static/chunks 2>/dev/null | wc -l | xargs echo "standalone chunk files:"
ls .next/static/chunks | wc -l | xargs echo "build chunk files:"
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
