#!/usr/bin/env bash
set -euo pipefail

# Runtime smoke: Next.js must compile, serve /api/v1/health, and render /login.
# Uses a dedicated dist dir and port so it can run alongside `next dev`.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PORT="${SMOKE_PORT:-3010}"
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-phase1-smoke-secret-phase1-smoke-secret}"
export DATABASE_URL="${DATABASE_URL:-postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp}"
export DATABASE_OWNER_URL="${DATABASE_OWNER_URL:-postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp}"
LOG="${SMOKE_LOG:-/tmp/schoolapp-smoke-next.log}"
PID=""

cleanup() {
  if [ -n "${PID}" ]; then
    kill "${PID}" 2>/dev/null || true
    pkill -P "${PID}" 2>/dev/null || true
  fi
  pkill -f "next start --hostname 127.0.0.1 --port ${PORT}" 2>/dev/null || true
}
trap cleanup EXIT

pnpm --filter @schoolapp/web build
pnpm --filter @schoolapp/web exec next start --hostname 127.0.0.1 --port "${PORT}" >"${LOG}" 2>&1 &
PID=$!

ok=0
for _ in $(seq 1 45); do
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "next start exited before becoming ready. log:" >&2
    cat "${LOG}" >&2 || true
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${PORT}/api/v1/health" | grep -q '"ok":true'; then
    ok=1
    break
  fi
  sleep 1
done

if [ "${ok}" -ne 1 ]; then
  echo "timed out waiting for /api/v1/health. log:" >&2
  cat "${LOG}" >&2 || true
  exit 1
fi

health="$(curl -sS "http://127.0.0.1:${PORT}/api/v1/health")"
tenant="$(curl -sS "http://127.0.0.1:${PORT}/api/v1/public/tenant")"
unknown_code="$(curl -sS -o /dev/null -w "%{http_code}" -H "Host: nosuch.localhost:${PORT}" "http://127.0.0.1:${PORT}/api/v1/public/tenant")"

expect_page() {
  local path="$1"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}${path}")"
  if [ "${code}" != "200" ]; then
    echo "${path} returned ${code}" >&2
    exit 1
  fi
}

expect_page "/login"
expect_page "/platform"
expect_page "/school"
expect_page "/school/students"
expect_page "/school/staff"
expect_page "/school/parents"
expect_page "/school/admissions"
expect_page "/school/attendance"
expect_page "/school/attendance/registers"
expect_page "/school/attendance/school"
expect_page "/school/student-portal"
expect_page "/parent"
expect_page "/student"
expect_page "/student/attendance"

code="$(curl -sS -o /tmp/schoolapp-smoke-login.html -w "%{http_code}" "http://127.0.0.1:${PORT}/login")"

if [ "${health}" != '{"ok":true}' ]; then
  echo "unexpected health body: ${health}" >&2
  exit 1
fi
if ! echo "${tenant}" | grep -q '"kind":"platform"'; then
  echo "unexpected public tenant on 127.0.0.1: ${tenant}" >&2
  exit 1
fi
if [ "${unknown_code}" != "404" ]; then
  echo "unknown school host returned ${unknown_code}" >&2
  exit 1
fi
if [ "${code}" != "200" ]; then
  echo "/login returned ${code}" >&2
  exit 1
fi
if ! grep -q "Sign in" /tmp/schoolapp-smoke-login.html; then
  echo "/login HTML did not include Sign in" >&2
  exit 1
fi

echo "web smoke ok (health 200, platform tenant, unknown host 404, login/school/parent/student/admissions/attendance pages 200)"
