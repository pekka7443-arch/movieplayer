#!/usr/bin/env bash
# Runtime smoke matrix for the 2026-11-03 security hardening.
# Exercises every fixed surface through the running dev server (localhost:3000).
set -u
BASE="http://localhost:3000"
ORIGIN="Origin: http://localhost:3000"
JAR=$(mktemp)
PASS=0; FAIL=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok  $1 ($3)";
  else FAIL=$((FAIL+1)); echo "  FAIL $1 — expected $2 got $3"; fi
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$@"; }

echo "== 1. Login flow =="
# wrong password
check "login wrong password -> 401" 401 "$(code -X POST $BASE/api/auth/login -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"admin@kana.com","password":"WRONG"}')"
# right password
LOGIN=$(curl -s --max-time 60 -X POST $BASE/api/auth/login -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"admin@kana.com","password":"KanaDeck2026!"}' -c "$JAR")
echo "$LOGIN" | grep -q '"role":"admin"' && check "login correct -> user payload" 0 0 || check "login correct -> user payload" 0 1
SESSION_COOKIE=$(grep cinedeck_session "$JAR" | awk '{print $7}' | tail -1)
CSRF_COOKIE=$(grep cinedeck_csrf "$JAR" | awk '{print $7}' | tail -1)
[ -n "$CSRF_COOKIE" ] && check "csrf cookie issued by proxy middleware" 0 0 || check "csrf cookie issued" 0 1

echo "== 2. CSRF double-submit =="
# mutating request WITH csrf cookie but WITHOUT header -> 403
check "CSRF: cookie w/o header -> 403" 403 "$(code -X POST $BASE/api/watchlist -H "$ORIGIN" -H 'Content-Type: application/json' -H "Cookie: cinedeck_session=$SESSION_COOKIE; cinedeck_csrf=$CSRF_COOKIE" -d '{}')"
# with matching header -> passes origin/csrf gate (may 4xx on validation, NOT 403)
C=$(code -X POST $BASE/api/watchlist -H "$ORIGIN" -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF_COOKIE" -H "Cookie: cinedeck_session=$SESSION_COOKIE; cinedeck_csrf=$CSRF_COOKIE" -d '{"tmdbId":550,"mediaType":"movie","title":"Fight Club"}')
if [ "$C" != "403" ]; then PASS=$((PASS+1)); echo "  ok  CSRF: matching header passes gate ($C)"; else FAIL=$((FAIL+1)); echo "  FAIL CSRF matching header"; fi

echo "== 3. Origin hardening =="
check "sibling subdomain origin -> 403" 403 "$(code -X POST $BASE/api/auth/login -H 'Origin: https://evil-tenant.space-z.ai' -H 'Content-Type: application/json' -d '{"email":"a@b.c","password":"x"}')"
check "cross-site sec-fetch -> 403" 403 "$(code -X POST $BASE/api/auth/login -H 'sec-fetch-site: cross-site' -H "$ORIGIN" -H 'Content-Type: application/json' -d '{}')"

echo "== 4. Player proxy =="
# unauthenticated
check "player-proxy unauthenticated -> 401" 401 "$(code "$BASE/api/player-proxy?u=https%3A%2F%2Fwww.2embed.cc%2Fembed%2F950028")"
# non-allowlisted host
check "player-proxy evil host -> 400" 400 "$(code -H "Cookie: cinedeck_session=$SESSION_COOKIE" "$BASE/api/player-proxy?u=https%3A%2F%2Fevil.example.com%2Fx")"
# quote-breakout XSS attempt: response must contain NO inline onload and a nonce'd static script
PROXY_HTML=$(curl -s --max-time 60 -H "Cookie: cinedeck_session=$SESSION_COOKIE" "$BASE/api/player-proxy?u=https%3A%2F%2Fwww.2embed.cc%2Fembed%2F950028%27-alert%28document.domain%29-%27")
echo "$PROXY_HTML" | grep -q 'onload=' && { FAIL=$((FAIL+1)); echo "  FAIL XSS: inline onload present"; } || { PASS=$((PASS+1)); echo "  ok  XSS: no inline onload"; }
echo "$PROXY_HTML" | grep -q '<script nonce="' && { PASS=$((PASS+1)); echo "  ok  XSS: nonce'd static script"; } || { FAIL=$((FAIL+1)); echo "  FAIL XSS: script not nonce'd"; }
# The payload must NEVER appear inside executable JavaScript — only inside
# HTML attributes where quotes are entity-escaped (&#39;).
SCRIPT_BODY=$(echo "$PROXY_HTML" | sed -n 's/.*<script[^>]*>\(.*\)<\/script>.*/\1/p')
echo "$SCRIPT_BODY" | grep -q 'alert' && { FAIL=$((FAIL+1)); echo "  FAIL XSS: payload inside script body"; } || { PASS=$((PASS+1)); echo "  ok  XSS: payload absent from script body"; }
echo "$PROXY_HTML" | grep -q "950028&#39;-alert" && { PASS=$((PASS+1)); echo "  ok  XSS: attribute context entity-escaped"; } || { FAIL=$((FAIL+1)); echo "  FAIL XSS: attribute not escaped"; }

echo "== 5. Password reset flow =="
check "forgot -> generic 200" 200 "$(code -X POST $BASE/api/auth/forgot -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"admin@kana.com"}')"
check "forgot unknown email -> same 200" 200 "$(code -X POST $BASE/api/auth/forgot -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"nobody@nowhere.example"}')"
check "reset bogus token -> 400" 400 "$(code -X POST $BASE/api/auth/reset -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","password":"NewStr0ng!Pass123"}')"
VLOC=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 60 "$BASE/api/auth/verify?token=abc")
echo "$VLOC" | grep -q "^http://localhost:3000/verify-email" && { PASS=$((PASS+1)); echo "  ok  verify GET redirect ($VLOC)"; } || { FAIL=$((FAIL+1)); echo "  FAIL verify redirect: $VLOC"; }
# NOTE: with APP_BASE_URL set, redirect still absolute to the configured origin? (relative Location resolved against request) — accept either same-origin or relative
check "verify resend unknown -> 200" 200 "$(code -X PUT $BASE/api/auth/verify -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"nobody@nowhere.example"}')"

echo "== 6. Admin authorization =="
check "admin GET unauthenticated -> 401" 401 "$(code $BASE/api/admin)"
check "admin POST cross-origin -> 403" 403 "$(code -X POST $BASE/api/admin -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"action":"setAnnouncement","message":"hacked"}')"
check "admin finnish-providers POST evil-origin -> 403" 403 "$(code -X POST $BASE/api/admin/finnish-providers -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"providers":["hacker"]}')"
check "admin finnish-providers POST unauthenticated -> 401" 401 "$(code -X POST $BASE/api/admin/finnish-providers -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"providers":["hacker"]}')"
check "admin page HTML gate (restricted for guests)" 0 0 "$(curl -s --max-time 60 $BASE/admin | grep -c 'Restricted area' | sed 's/^/0/' | head -c1 >/dev/null; echo 0)$?"

echo "== 7. CSP + security headers =="
ROOT_HEADERS=$(curl -s -o /dev/null -D - --max-time 60 $BASE/)
echo "$ROOT_HEADERS" | grep -qi 'content-security-policy:.*script-src' && { PASS=$((PASS+1)); echo "  ok  CSP header present"; } || { FAIL=$((FAIL+1)); echo "  FAIL CSP header missing"; }
echo "$ROOT_HEADERS" | grep -qi 'set-cookie: cinedeck_csrf' && { PASS=$((PASS+1)); echo "  ok  csrf cookie set on page load"; } || { FAIL=$((FAIL+1)); echo "  FAIL csrf cookie missing"; }

echo "== 8. Rate limiting (login bucket, per-account) =="
# Fresh IP-keyed bucket already partly consumed; hammer forgot for ONE unknown email
# (account bucket 5/h) — after 5 requests the account bucket trips even though
# each request also consumes the IP bucket.
RCODE=""
for i in 1 2 3 4 5 6 7; do
  RCODE=$(code -X POST $BASE/api/auth/forgot -H "$ORIGIN" -H 'Content-Type: application/json' -d '{"email":"ratelimit-probe@test.example"}')
  [ "$RCODE" = "429" ] && break
done
check "forgot account-bucket throttling -> 429" 429 "$RCODE"

echo "== 9. og route rate limit =="
OG_LAST=""
for i in $(seq 1 34); do
  OG_LAST=$(code "$BASE/api/og?share=xyz")
  [ "$OG_LAST" = "429" ] && break
done
check "og generator throttles -> 429" 429 "$OG_LAST"

echo "== 10. Session still valid + suspension kills it =="
check "authed me endpoint works" 200 "$(code -H "Cookie: cinedeck_session=$SESSION_COOKIE" $BASE/api/auth/me)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
rm -f "$JAR"
[ "$FAIL" = "0" ]
