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

expect_page "/"
expect_page "/login"
expect_page "/forgot-password"
expect_page "/reset-password"
expect_page "/activate"
expect_page "/invite"
expect_page "/platform"
expect_page "/school"
expect_page "/school/setup"
expect_page "/school/setup/welcome"
expect_page "/school/setup?step=branding"
expect_page "/school/setup?step=academic_structure"
expect_page "/school/setup?step=school_day"
expect_page "/school/settings"
expect_page "/school/settings/email"
expect_page "/school/subjects"
expect_page "/school/academic-years"
expect_page "/school/academic-years/example/terms"
expect_page "/school/term-dates"
expect_page "/school/year-groups"
expect_page "/school/timetable"
expect_page "/school/timetable/schedule"
expect_page "/school/classes"
expect_page "/school/imports"
expect_page "/school/imports?returnTo=%2Fschool%2Fsetup%3Fstep%3Dpupils"
expect_page "/school/timetable/school-day?returnTo=%2Fschool%2Fsetup%3Fstep%3Dschool_day"
expect_page "/school/students"
expect_page "/school/staff"
expect_page "/school/profile"
expect_page "/school/parents"
expect_page "/school/parents/example"
expect_page "/parent/account"
expect_page "/student/profile"
expect_page "/school/admissions"
expect_page "/school/admissions/applications"
expect_page "/school/admissions/applications/new"
expect_page "/school/admissions/forms"
expect_page "/school/admissions/campaigns"
expect_page "/admissions/enquiry/year-3-enquiry"
expect_page "/admissions/apply/year-3-application"
expect_page "/admissions/embed/enquiry/year-3-enquiry"
expect_page "/school/attendance"
expect_page "/school/attendance/registers"
expect_page "/school/attendance/school"
expect_page "/school/student-portal"
expect_page "/school/teaching"
expect_page "/school/teaching/assignments"
expect_page "/school/teaching/submissions"
expect_page "/school/assessment"
expect_page "/school/assessment/assessments"
expect_page "/school/assessment/results"
expect_page "/school/assessment/reports"
expect_page "/school/communications"
expect_page "/school/communications/announcements"
expect_page "/school/communications/calendar"
expect_page "/school/messages"
expect_page "/school/messages/new"
expect_page "/parent/messages"
expect_page "/parent/messages/new"
expect_page "/school/activities"
expect_page "/school/activities/new"
expect_page "/school/finance"
expect_page "/school/finance/fee-schedules"
expect_page "/school/finance/fee-schedules/example"
expect_page "/school/finance/fee-schedules?notice=deleted"
expect_page "/school/finance/billing-runs"
expect_page "/school/finance/billing-runs/example"
expect_page "/school/finance/discounts"
expect_page "/school/finance/accounts"
expect_page "/school/finance/invoices"
expect_page "/school/finance/receipts"
expect_page "/school/finance/payments"
expect_page "/school/finance/statements"
expect_page "/school/finance/arrears"
expect_page "/school/finance/settings"
expect_page "/school/finance/charges"
expect_page "/school/finance/charges/new"
expect_page "/school/finance/charges/bulk"
expect_page "/school/finance/outstanding"
expect_page "/school/finance/transactions"
expect_page "/school/finance/refunds"
expect_page "/school/pastoral"
expect_page "/school/pastoral/behaviour"
expect_page "/school/pastoral/achievements"
expect_page "/school/pastoral/concerns"
expect_page "/school/safeguarding"
expect_page "/student/learning"
expect_page "/student/notices"
expect_page "/student/calendar"
expect_page "/student/activities"
expect_page "/parent/notices"
expect_page "/parent/calendar"
expect_page "/parent/activities"
expect_page "/parent/payments"
expect_page "/parent/finance"
expect_page "/parent/finance/statement"
expect_page "/parent/finance/checkout/success"
expect_page "/parent/finance/checkout/cancel"
expect_page "/student/finance"
expect_page "/student/results"
expect_page "/student/reports"
expect_page "/parent"
expect_page "/student"
expect_page "/school/statutory"
expect_page "/school/statutory/data-quality"
expect_page "/school/statutory/census"
expect_page "/school/settings/statutory"
expect_page "/school/reports"
expect_page "/school/reports/pupils"
expect_page "/school/reports/attendance"
expect_page "/school/reports/admissions"
expect_page "/school/reports/send"
expect_page "/school/reports/exports"
expect_page "/school/engagement"
expect_page "/school/engagement/rewards"
expect_page "/school/engagement/achievements"
expect_page "/school/engagement/competitions"
expect_page "/school/engagement/learning"
expect_page "/school/engagement/settings"
expect_page "/student/play"
expect_page "/student/rewards"
expect_page "/student/competitions"

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
if ! grep -q "Platform sign in" /tmp/schoolapp-smoke-login.html; then
  echo "/login HTML did not include Platform sign in" >&2
  exit 1
fi
if ! grep -q "luvlearn-logo.png" /tmp/schoolapp-smoke-login.html; then
  echo "/login HTML did not include the LuvLearn logo" >&2
  exit 1
fi
if ! grep -q "login-platform-header" /tmp/schoolapp-smoke-login.html; then
  echo "/login HTML did not include the LuvLearn brand header" >&2
  exit 1
fi
if ! grep -q "login-brand-title" /tmp/schoolapp-smoke-login.html; then
  echo "/login HTML did not include the school brand title class" >&2
  exit 1
fi
logo_code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/branding/luvlearn-logo.png")"
if [ "${logo_code}" != "200" ]; then
  echo "LuvLearn logo asset returned ${logo_code}" >&2
  exit 1
fi

home_code="$(curl -sS -o /tmp/schoolapp-smoke-home.html -w "%{http_code}" "http://127.0.0.1:${PORT}/")"
if [ "${home_code}" != "200" ]; then
  echo "/ returned ${home_code}" >&2
  exit 1
fi
if ! grep -q "Find your school" /tmp/schoolapp-smoke-home.html; then
  echo "/ HTML did not include the public school finder" >&2
  exit 1
fi
if ! grep -q "luvlearn-logo.png" /tmp/schoolapp-smoke-home.html; then
  echo "/ HTML did not include the LuvLearn logo" >&2
  exit 1
fi
if grep -q "Platform Admin" /tmp/schoolapp-smoke-home.html; then
  echo "/ HTML exposed Platform Admin" >&2
  exit 1
fi
if grep -q "Health API" /tmp/schoolapp-smoke-home.html || grep -q "/api/v1/health" /tmp/schoolapp-smoke-home.html; then
  echo "/ HTML exposed health/API developer links" >&2
  exit 1
fi
if grep -q ">Schoolapp<" /tmp/schoolapp-smoke-home.html; then
  echo "/ HTML still used the developer Schoolapp heading" >&2
  exit 1
fi

favicon_code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/favicon.ico")"
icon_code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/branding/luvlearn-icon.png")"
apple_code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/branding/apple-touch-icon.png")"
if [ "${favicon_code}" != "200" ] || [ "${icon_code}" != "200" ] || [ "${apple_code}" != "200" ]; then
  echo "favicon/icon assets returned favicon=${favicon_code} icon=${icon_code} apple=${apple_code}" >&2
  exit 1
fi

unknown_home="$(curl -sS -o /tmp/schoolapp-smoke-unknown.html -w "%{http_code}" -H "Host: foo.bar.localhost:${PORT}" "http://127.0.0.1:${PORT}/")"
if [ "${unknown_home}" != "200" ]; then
  echo "unknown host / returned ${unknown_home}" >&2
  exit 1
fi
if ! grep -q "School not found" /tmp/schoolapp-smoke-unknown.html; then
  echo "unknown host / did not render a safe school-not-found page" >&2
  exit 1
fi
if grep -q "Platform Admin" /tmp/schoolapp-smoke-unknown.html; then
  echo "unknown host / leaked Platform Admin" >&2
  exit 1
fi

echo "web smoke ok (health 200, platform tenant, unknown host 404, public landing, favicon, login/school/parent/student/admissions/forms/campaigns/attendance/teaching/assessment/communications/pastoral/safeguarding/activities/finance/messages/statutory/reports/engagement pages 200)"
