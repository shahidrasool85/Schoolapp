#!/usr/bin/env bash
set -euo pipefail

# Prepare a local demo environment: Postgres, .env, migrations, and demo seed.
# Refuses to run against production-like configuration. Guards run BEFORE any env write.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib-postgres.sh
source "$ROOT/scripts/lib-postgres.sh"

write_demo_env() {
  node "$ROOT/scripts/write-demo-env.mjs" "$1"
}

start_postgres() {
  if postgres_ready; then
    echo "PostgreSQL is already running."
    return
  fi

  if has_cmd docker; then
    echo "Starting PostgreSQL with Docker Compose..."
    if docker_compose up -d "$COMPOSE_SERVICE"; then
      export PGHOST="${PGHOST:-127.0.0.1}"
      export PGPORT="${PGPORT:-5432}"
      export PGUSER="${PGUSER:-postgres}"
      export PGPASSWORD="${PGPASSWORD:-postgres}"
      local i
      for i in $(seq 1 40); do
        if postgres_ready; then
          echo "PostgreSQL is ready."
          return
        fi
        sleep 1
      done
    fi
  fi

  echo "PostgreSQL is not running on 127.0.0.1:${PGPORT:-5432}." >&2
  echo "Start Docker Desktop, then: docker compose -f infra/docker-compose.yml up -d" >&2
  echo "You do not need a local PostgreSQL install; Docker Desktop is enough." >&2
  if ! has_cmd pg_isready; then
    echo "This machine has no local pg_isready; demo setup checks the Docker container instead." >&2
  fi
  exit 1
}

check_localhost_school_hosts() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*)
      echo "On Windows, if a school URL fails to open, add this line to C:\\Windows\\System32\\drivers\\etc\\hosts:"
      echo "  127.0.0.1 greenwood.localhost oakacademy.localhost"
      return
      ;;
  esac
  if command -v getent >/dev/null 2>&1; then
    if ! getent hosts greenwood.localhost >/dev/null 2>&1; then
      echo "Note: greenwood.localhost did not resolve. Modern browsers usually still map *.localhost to your computer."
      echo "If a school URL fails to open, add this line to /etc/hosts:"
      echo "  127.0.0.1 greenwood.localhost oakacademy.localhost"
    fi
  fi
}

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Refusing to run demo setup because NODE_ENV=production." >&2
  exit 1
fi

export ALLOW_DEMO_SEED=true
export PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-localhost}"
export DATABASE_URL="${DATABASE_URL:-postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp}"
export DATABASE_OWNER_URL="${DATABASE_OWNER_URL:-postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp}"

GUARD_ARGS=()
if [ -f "$ROOT/.env" ]; then
  GUARD_ARGS+=("$ROOT/.env")
fi
pnpm --filter @schoolapp/db exec tsx src/demo-guard.ts -- "${GUARD_ARGS[@]}"

write_demo_env "$ROOT/.env"
write_demo_env "$ROOT/apps/web/.env.local"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

export ALLOW_DEMO_SEED=true
export PLATFORM_DOMAIN=localhost
export PGHOST="${PGHOST:-127.0.0.1}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

pnpm --filter @schoolapp/db exec tsx src/demo-guard.ts

start_postgres
bash "$ROOT/scripts/setup-db.sh"
pnpm db:migrate
pnpm --filter @schoolapp/db seed-demo
check_localhost_school_hosts

echo
echo "Demo setup is complete. Start the app with:"
echo "  pnpm demo:start"
echo
echo "Then open http://localhost:3000"
echo "School URLs: http://greenwood.localhost:3000  and  http://oakacademy.localhost:3000"
echo
echo "Full click-by-click instructions: docs/demo.md"
