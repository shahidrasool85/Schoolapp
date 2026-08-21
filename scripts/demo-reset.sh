#!/usr/bin/env bash
set -euo pipefail

# Recreate the local schoolapp database and re-seed demo data.
# Never drops test databases. Blocked unless the demo seed guard passes.
# The database name is fixed to schoolapp so a crafted SCHOOLAPP_DB cannot drop anything else.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib-postgres.sh
source "$ROOT/scripts/lib-postgres.sh"

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Refusing to reset demo data because NODE_ENV=production." >&2
  exit 1
fi

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Refusing to reset demo data because NODE_ENV=production." >&2
  exit 1
fi

if [ -n "${SCHOOLAPP_DB:-}" ] && [ "${SCHOOLAPP_DB}" != "schoolapp" ]; then
  echo "demo:reset only drops the local database named schoolapp." >&2
  exit 1
fi

export ALLOW_DEMO_SEED="${ALLOW_DEMO_SEED:-true}"
export PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-localhost}"
export DATABASE_URL="${DATABASE_URL:-postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp}"
export DATABASE_OWNER_URL="${DATABASE_OWNER_URL:-postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
unset PGDATABASE PGSERVICE || true

GUARD_ARGS=()
if [ -f "$ROOT/.env" ]; then
  GUARD_ARGS+=("$ROOT/.env")
fi
pnpm --filter @schoolapp/db exec tsx src/demo-guard.ts -- "${GUARD_ARGS[@]}"

echo "Dropping local database schoolapp (test databases are left alone)..."
psql_super <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'schoolapp'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS schoolapp;
SQL

bash "$ROOT/scripts/demo-setup.sh"
