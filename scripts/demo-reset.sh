#!/usr/bin/env bash
set -euo pipefail

# Recreate the local schoolapp database and re-seed demo data.
# Never drops test databases. Blocked unless the demo seed guard passes.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

export ALLOW_DEMO_SEED="${ALLOW_DEMO_SEED:-true}"
export PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-localhost}"
export DATABASE_URL="${DATABASE_URL:-postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp}"
export DATABASE_OWNER_URL="${DATABASE_OWNER_URL:-postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

pnpm --filter @schoolapp/db exec tsx src/demo-guard.ts

DB_NAME="${SCHOOLAPP_DB:-schoolapp}"

psql_super() {
  if [ -n "${PGHOST:-}" ]; then
    PGPASSWORD="${PGPASSWORD:-postgres}" psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 "$@"
  elif command -v sudo >/dev/null && id postgres >/dev/null 2>&1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
  else
    psql -U postgres -v ON_ERROR_STOP=1 "$@"
  fi
}

echo "Dropping local database ${DB_NAME} (test databases are left alone)..."
psql_super <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${DB_NAME}'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${DB_NAME};
SQL

bash "$ROOT/scripts/demo-setup.sh"
