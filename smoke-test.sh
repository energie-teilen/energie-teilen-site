#!/usr/bin/env bash
# Energie Teilen — endpoint & route smoke test.  Usage: bash smoke-test.sh [BASE_URL]
set -uo pipefail
B="${1:-http://localhost:3000}"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS $1 ($2)"; pass=$((pass+1)); else echo "  FAIL $1: got '$2' want '$3'"; fail=$((fail+1)); fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$1"; }
echo "Testing $B"
chk "GET /"               "$(code "$B/")"                  200
chk "GET /impressum"      "$(code "$B/impressum")"         200
chk "GET /datenschutz"    "$(code "$B/datenschutz")"       200
chk "GET /agb"            "$(code "$B/agb")"               200
chk "GET /og-image.png"   "$(code "$B/og-image.png")"      200
chk "GET /favicon-32.png" "$(code "$B/favicon-32.png")"    200
chk "GET /apple-touch"    "$(code "$B/apple-touch-icon.png")" 200
chk "GET /sitemap.xml"    "$(code "$B/sitemap.xml")"       200
chk "GET /api/health"     "$(code "$B/api/health")"        200
chk "GET /api/nope (404)" "$(code "$B/api/nope")"          404
# Fulfillment leg: the order lookup must reject malformed references before it
# ever talks to Stripe. 400 here is config-independent, so it is a real assertion.
chk "GET /api/pilot-order/<bad> (400)" "$(code "$B/api/pilot-order/not-a-session")" 400
chk "GET /api/pilot-order/ (404)"      "$(code "$B/api/pilot-order/")"              404
# Admin ledger must never be reachable without a bearer token. 401 whether the
# token is wrong or unset — no probing difference.
chk "GET /api/admin/orders (401)"      "$(code "$B/api/admin/orders")"              401
chk "GET /api/admin/orders bad token"  "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong-token-value-here' "$B/api/admin/orders")" 401
chk "POST /api/admin/orders/../stage (401)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"stage":"closed"}' "$B/api/admin/orders/ET-AAAAAAAA/stage")" 401
echo "  health: $(curl -s "$B/api/health")"
# Confirmation transport must be configured, or paying customers hear nothing.
H="$(curl -s "$B/api/health")"
case "$H" in
  *'"customerConfirmation":true'*) echo "  PASS customer confirmation configured"; pass=$((pass+1));;
  *) echo "  WARN customer confirmation NOT configured (set RESEND_API_KEY + ET_CUSTOMER_REPLY_TO)";;
esac
# Launch blocker: without durable orders, paid work is not enumerable.
case "$H" in
  *'"durableOrders":true'*) echo "  PASS order ledger durable"; pass=$((pass+1));;
  *) echo "  WARN ORDER LEDGER NOT DURABLE — paid orders live only in Stripe + email (set UPSTASH_REDIS_REST_*)";;
esac
case "$H" in
  *'"adminApi":true'*) echo "  PASS admin API enabled"; pass=$((pass+1));;
  *) echo "  WARN admin API disabled (set ADMIN_API_TOKEN, >= 32 chars)";;
esac
LEAD=$(curl -s -X POST "$B/api/lead" -H 'content-type: application/json' -d '{"email":"smoke@example.com","source":"newsletter","consent":true,"website":""}')
echo "  POST /api/lead → $LEAD"
case "$LEAD" in *'"ok":true'*) echo "  PASS lead"; pass=$((pass+1));; *) echo "  FAIL lead"; fail=$((fail+1));; esac
echo ""; echo "RESULT: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
