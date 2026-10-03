#!/usr/bin/env bash
# Proves the container image does what the Dockerfile claims, using the REAL image:
#   1. with NO secrets it refuses to start (the prod profile has no defaults),
#   2. with secrets it starts, answers health, runs as a non-root user, and serves a login.
# Usage: bash scripts/prove_container.sh [image]   (default clinic-call-console-api:test)
set -u
IMG="${1:-clinic-call-console-api:test}"
PORT=18080
fail=0
say() { printf '%s\n' "$*"; }

docker rm -f ccc-nosecret ccc-secret >/dev/null 2>&1

say "1. no secrets: the container must exit instead of falling back to a demo value"
docker run -d --name ccc-nosecret -p $PORT:8080 "$IMG" >/dev/null
for i in $(seq 1 40); do
  [ "$(docker inspect -f '{{.State.Running}}' ccc-nosecret 2>/dev/null)" = "false" ] && break
  sleep 2
done
state=$(docker inspect -f '{{.State.Running}} exit={{.State.ExitCode}}' ccc-nosecret)
say "   state: $state"
docker logs ccc-nosecret 2>&1 | grep -m1 -i "Could not resolve placeholder" | sed 's/^/   /' | cut -c1-200
case "$state" in "false exit=0") say "   FAIL: exited 0"; fail=1 ;; false*) say "   PASS: refused to start" ;; *) say "   FAIL: still running"; fail=1 ;; esac
docker rm -f ccc-nosecret >/dev/null 2>&1

say "2. with secrets: starts, healthy, non-root, can sign in"
docker run -d --name ccc-secret -p $PORT:8080 \
  -e JWT_SECRET="proof-signing-secret-0123456789abcdef-xyz" \
  -e FIELD_KEY="$(head -c 32 /dev/urandom | base64)" \
  -e WEBHOOK_SECRET="proof-webhook-secret" \
  -e CORS_ORIGINS="http://localhost:4200" \
  -e REVIEWER_PASSWORD="reviewer-proof-pw" -e ADMIN_PASSWORD="admin-proof-pw" \
  "$IMG" >/dev/null
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/actuator/health" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
say "   health: $code"; [ "$code" = "200" ] || fail=1
user=$(docker exec ccc-secret id -un)
say "   runs as: $user"; [ "$user" != "root" ] || { say "   FAIL: running as root"; fail=1; }
tok=$(curl -s -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin@demo.test","password":"admin-proof-pw"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$tok" ] && say "   login with the env password: ok" || { say "   FAIL: login"; fail=1; }
n=$(curl -s "http://127.0.0.1:$PORT/api/calls?size=1" -H "Authorization: Bearer $tok" | sed -n 's/.*"totalElements":\([0-9]*\).*/\1/p')
say "   seeded calls visible: ${n:-none}"; [ "${n:-0}" -ge 1 ] || fail=1
old=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin@demo.test","password":"admin-demo-pass"}')
say "   the public DEMO password is refused when the env sets another: $old (must be 401)"; [ "$old" = "401" ] || fail=1
docker rm -f ccc-secret >/dev/null 2>&1

[ $fail -eq 0 ] && say "PASS, the image behaves as documented" || say "FAIL"
exit $fail
