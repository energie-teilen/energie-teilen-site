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
echo "  health: $(curl -s "$B/api/health")"
LEAD=$(curl -s -X POST "$B/api/lead" -H 'content-type: application/json' -d '{"email":"smoke@example.com","source":"newsletter","consent":true,"website":""}')
echo "  POST /api/lead → $LEAD"
case "$LEAD" in *'"ok":true'*) echo "  PASS lead"; pass=$((pass+1));; *) echo "  FAIL lead"; fail=$((fail+1));; esac
echo ""; echo "RESULT: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
