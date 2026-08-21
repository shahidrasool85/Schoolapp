# Shared local/demo Postgres helpers. ROOT must be set to the repository root.
# Prefers local pg_isready/psql when present (Linux/macOS/CI).
# Falls back to Docker Compose exec so Windows users do not need a local Postgres client.

COMPOSE_FILE="${COMPOSE_FILE:-${ROOT}/infra/docker-compose.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
COMPOSE_SERVICE="${SCHOOLAPP_COMPOSE_POSTGRES_SERVICE:-postgres}"
COMPOSE_CONTAINER="${SCHOOLAPP_COMPOSE_POSTGRES_CONTAINER:-infra-postgres-1}"
COMPOSE_PROJECT="${SCHOOLAPP_COMPOSE_PROJECT:-$(basename "$COMPOSE_DIR")}"
# Always-present database for CREATE ROLE / CREATE DATABASE. Never inherit
# PGDATABASE (often schoolapp_test from a test session) for bootstrap.
MAINTENANCE_DB="${SCHOOLAPP_MAINTENANCE_DB:-postgres}"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# Run docker compose against infra/ so the container is named infra-postgres-1,
# matching `docker compose up` from that directory (typical on Docker Desktop).
docker_compose() {
  if ! has_cmd docker; then
    return 127
  fi
  if docker compose version >/dev/null 2>&1; then
    docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" "$@"
    return $?
  fi
  if has_cmd docker-compose; then
    docker-compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
    return $?
  fi
  return 127
}

postgres_ready_local() {
  if ! has_cmd pg_isready; then
    return 1
  fi
  (
    unset PGDATABASE PGSERVICE
    pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "$MAINTENANCE_DB" >/dev/null 2>&1
  )
}

# Name of this project's running Compose postgres container, if any.
# Only the expected container name or this compose project/service — never
# "whatever is publishing 5432", which could be another user's database.
postgres_docker_container() {
  if ! has_cmd docker; then
    return 1
  fi
  if docker inspect --format '{{.State.Running}}' "$COMPOSE_CONTAINER" 2>/dev/null | grep -qx true; then
    printf '%s\n' "$COMPOSE_CONTAINER"
    return 0
  fi
  local names
  names="$(docker ps \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=${COMPOSE_SERVICE}" \
    --format '{{.Names}}' 2>/dev/null || true)"
  if [ -n "$names" ]; then
    printf '%s\n' "${names%%$'\n'*}"
    return 0
  fi
  return 1
}

postgres_ready_docker() {
  if ! has_cmd docker; then
    return 1
  fi
  if docker_compose exec -T -e PGDATABASE="$MAINTENANCE_DB" "$COMPOSE_SERVICE" \
    pg_isready -U "${PGUSER:-postgres}" -d "$MAINTENANCE_DB" >/dev/null 2>&1; then
    return 0
  fi
  local container
  container="$(postgres_docker_container || true)"
  if [ -n "$container" ] && docker exec -e PGDATABASE="$MAINTENANCE_DB" "$container" \
    pg_isready -U "${PGUSER:-postgres}" -d "$MAINTENANCE_DB" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# True when the server we will use is accepting connections.
# Does not require a local PostgreSQL install or local pg_isready.
postgres_ready() {
  if postgres_ready_local; then
    return 0
  fi
  postgres_ready_docker
}

# Superuser SQL against the running Postgres (local client, else Docker).
# Reads SQL from stdin. Detect the transport first so a failed probe cannot
# consume the SQL heredoc. Prefer local `psql` so CI stays unchanged.
#
# Bootstrap connects to MAINTENANCE_DB (postgres) unless the caller passes -d.
# Inherited PGDATABASE / PGSERVICE are ignored so a test session cannot make
# CREATE DATABASE target schoolapp_test before that database exists.
psql_super() {
  local maintenance="$MAINTENANCE_DB"
  local pguser="${PGUSER:-postgres}"
  local pghost="${PGHOST:-}"
  local pgport="${PGPORT:-5432}"
  local pgpassword="${PGPASSWORD:-postgres}"
  (
    unset PGDATABASE PGSERVICE
    if has_cmd psql; then
      if [ -n "$pghost" ]; then
        PGPASSWORD="$pgpassword" psql -h "$pghost" -p "$pgport" -U "$pguser" \
          -d "$maintenance" -v ON_ERROR_STOP=1 "$@"
        exit $?
      fi
      if has_cmd sudo && id postgres >/dev/null 2>&1; then
        sudo -u postgres psql -d "$maintenance" -v ON_ERROR_STOP=1 "$@"
        exit $?
      fi
      psql -U postgres -d "$maintenance" -v ON_ERROR_STOP=1 "$@"
      exit $?
    fi

    if docker_compose exec -T -e PGDATABASE="$maintenance" "$COMPOSE_SERVICE" \
      pg_isready -U "$pguser" -d "$maintenance" >/dev/null 2>&1; then
      docker_compose exec -T -e PGDATABASE="$maintenance" "$COMPOSE_SERVICE" \
        psql -U "$pguser" -d "$maintenance" -v ON_ERROR_STOP=1 "$@"
      exit $?
    fi

    container="$(postgres_docker_container || true)"
    if [ -n "$container" ]; then
      docker exec -i -e PGDATABASE="$maintenance" "$container" \
        psql -U "$pguser" -d "$maintenance" -v ON_ERROR_STOP=1 "$@"
      exit $?
    fi

    echo "Could not find psql or a Docker PostgreSQL container." >&2
    echo "Start Docker Desktop (infra/docker-compose.yml), then retry." >&2
    echo "You do not need a local PostgreSQL server — Docker Desktop is enough." >&2
    exit 1
  )
}
