#!/bin/bash
# Run Lighthouse against the production build in ONE session (the sandbox
# reaps background servers between tool calls, so server + audit share a shell).
set -u
cd /home/z/my-project

PORT=${2:-3100}
URL=${1:-/}
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export CHROME_PATH=/home/z/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome

env PORT=$PORT HOSTNAME=127.0.0.1 NODE_ENV=production bun .next/standalone/server.js > /tmp/prod-server.log 2>&1 &
SRV=$!

# wait for readiness
for i in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

OUT=/tmp/lh-$(echo "$URL" | tr '/?=&' '____').json
lighthouse "http://127.0.0.1:$PORT$URL" \
  --only-categories=performance,accessibility,best-practices,seo \
  --form-factor=mobile --screenEmulation.mobile --quiet \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
  --output=json --output-path="$OUT" 2>&1 | grep -iE "error|runtime" | head -3

kill $SRV 2>/dev/null
wait $SRV 2>/dev/null

python3 - "$OUT" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
for k, v in d['categories'].items():
    s = v['score']
    print(f"{k}: {'ERR' if s is None else round(s*100)}")
audits = d.get('audits', {})
lcp = audits.get('largest-contentful-paint', {}).get('displayValue', 'n/a')
tbt = audits.get('total-blocking-time', {}).get('displayValue', 'n/a')
cls = audits.get('cumulative-layout-shift', {}).get('displayValue', 'n/a')
si = audits.get('speed-index', {}).get('displayValue', 'n/a')
print(f"LCP: {lcp} | TBT: {tbt} | CLS: {cls} | SI: {si}")
EOF
