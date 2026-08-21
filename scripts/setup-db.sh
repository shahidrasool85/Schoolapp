#!/usr/bin/env bash
set -euo pipefail

# Idempotent local Postgres roles and databases for Schoolapp Phase 1.
# Requires a PostgreSQL superuser. Prefer TCP when PGHOST is set (Docker/CI);
# otherwise peer auth as the postgres OS user.
# Uses local psql when installed; otherwise docker exec against Compose Postgres
# so Windows/Git Bash users do not need a local PostgreSQL client.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib-postgres.sh
source "$ROOT/scripts/lib-postgres.sh"

OWNER_USER="${SCHOOLAPP_OWNER_USER:-schoolapp_owner}"
OWNER_PASSWORD="${SCHOOLAPP_OWNER_PASSWORD:-schoolapp_owner}"
APP_USER="${SCHOOLAPP_APP_USER:-schoolapp_app}"
APP_PASSWORD="${SCHOOLAPP_APP_PASSWORD:-schoolapp_app}"
DB_NAME="${SCHOOLAPP_DB:-schoolapp}"
TEST_DB_NAME="${SCHOOLAPP_TEST_DB:-schoolapp_test}"
API_TEST_DB_NAME="${SCHOOLAPP_API_TEST_DB:-schoolapp_api_test}"

psql_super <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_USER}') THEN
    CREATE ROLE ${OWNER_USER} LOGIN PASSWORD '${OWNER_PASSWORD}' BYPASSRLS;
  ELSE
    ALTER ROLE ${OWNER_USER} WITH LOGIN PASSWORD '${OWNER_PASSWORD}' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
  ELSE
    ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${OWNER_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec

SELECT 'CREATE DATABASE ${TEST_DB_NAME} OWNER ${OWNER_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${TEST_DB_NAME}')\gexec

SELECT 'CREATE DATABASE ${API_TEST_DB_NAME} OWNER ${OWNER_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${API_TEST_DB_NAME}')\gexec

GRANT CONNECT ON DATABASE ${DB_NAME} TO ${APP_USER};
GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO ${APP_USER};
GRANT CONNECT ON DATABASE ${API_TEST_DB_NAME} TO ${APP_USER};
SQL

for db in "${DB_NAME}" "${TEST_DB_NAME}" "${API_TEST_DB_NAME}"; do
  psql_super -d "$db" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
ALTER SCHEMA public OWNER TO ${OWNER_USER};
GRANT USAGE ON SCHEMA public TO ${APP_USER};
SQL
done

echo "Postgres roles and databases are ready."
