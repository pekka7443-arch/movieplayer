#!/bin/bash
# Lighthouse against the production build THROUGH a compression proxy
# (mirrors the deployed platform path: Caddy `encode zstd gzip` → Next
# standalone, which does not compress on its own). All in one session —
# the sandbox reaps background processes between tool calls.
set -u
cd /home/z/my-project
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export CHROME_PATH=/home/z/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome

PORT=3100
PROXY=8181

env PORT=$PORT HOSTNAME=127.0.0.1 NODE_ENV=production bun .next/standalone/server.js > /tmp/prod-server.log 2>&1 &
SRV=$!

printf ':8181 {\n\tencode zstd gzip\n\n\thandle {\n\t\treverse_proxy 127.0.0.1:3100\n\t}\n}\n' > /tmp/Caddyfile-test
caddy run --config /tmp/Caddyfile-test --adapter caddyfile > /tmp/caddy-test.log 2>&1 &
CDY=$!

for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
sleep 1

OUT=/tmp/lh-via-caddy.json
lighthouse "http://127.0.0.1:$PROXY${1:-/}" \
  --only-categories=performance,accessibility,best-practices,seo \
  --form-factor=mobile --screenEmulation.mobile --quiet \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
  --output=json --output-path="$OUT" 2>&1 | grep -iE "^Runtime|error:" | head -2

kill $CDY $SRV 2>/dev/null
wait $CDY $SRV 2>/dev/null

python3 - "$OUT" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
for k, v in d['categories'].items():
    s = v['score']
    print(f"{k}: {'ERR' if s is None else round(s*100)}")
audits = d.get('audits', {})
def dv(k): return audits.get(k, {}).get('displayValue', 'n/a')
print(f"FCP: {dv('first-contentful-paint')} | LCP: {dv('largest-contentful-paint')} | TBT: {dv('total-blocking-time')} | CLS: {dv('cumulative-layout-shift')} | SI: {dv('speed-index')}")
EOF
