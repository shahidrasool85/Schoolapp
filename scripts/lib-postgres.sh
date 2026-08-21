# Shared local/demo Postgres helpers. ROOT must be set to the repository root.
# Prefers local pg_isready/psql when present (Linux/macOS/CI).
# Falls back to docker exec so Windows users do not need a local Postgres client.
#
# Root cause of the fresh-volume Windows failure after PR #10:
# Compose's `exec` flag `-d` means `--detach`, not psql's database name.
# `docker compose exec SERVICE psql` plus a short database flag was detached,
# so bootstrap SQL never ran on stdin. The next invocation connected over the
# container Unix socket to `schoolapp` and failed because that database had
# not been created. Use `docker exec` (command flags are not Compose flags)
# and psql `--dbname=` / `--username=`.

COMPOSE_FILE="${COMPOSE_FILE:-${ROOT}/infra/docker-compose.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
COMPOSE_SERVICE="${SCHOOLAPP_COMPOSE_POSTGRES_SERVICE:-postgres}"
COMPOSE_CONTAINER="${SCHOOLAPP_COMPOSE_POSTGRES_CONTAINER:-infra-postgres-1}"
COMPOSE_PROJECT="${SCHOOLAPP_COMPOSE_PROJECT:-$(basename "$COMPOSE_DIR")}"
# Always-present database for CREATE ROLE / CREATE DATABASE. Never inherit
# PGDATABASE (often schoolapp_test from a test session) for bootstrap.
MAINTENANCE_DB="${SCHOOLAPP_MAINTENANCE_DB:-postgres}"
# Superuser inside the Compose image (POSTGRES_USER). Not host PGUSER.
DOCKER_PGUSER="${POSTGRES_SUPERUSER:-postgres}"

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
    docker compose --project-directory "$COMPOSE_DIR" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
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
    pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" \
      --username="${PGUSER:-postgres}" --dbname="$MAINTENANCE_DB" >/dev/null 2>&1
  )
}

# Name or ID of this project's running Compose postgres container, if any.
# Only this compose project/service — never "whatever is publishing 5432".
postgres_docker_container() {
  if ! has_cmd docker; then
    return 1
  fi
  local id
  id="$(docker_compose ps -q "$COMPOSE_SERVICE" 2>/dev/null || true)"
  if [ -n "$id" ]; then
    printf '%s\n' "$id"
    return 0
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
  local container
  container="$(postgres_docker_container || true)"
  if [ -n "$container" ] && docker exec -e PGDATABASE="$MAINTENANCE_DB" "$container" \
    pg_isready --username="$DOCKER_PGUSER" --dbname="$MAINTENANCE_DB" >/dev/null 2>&1; then
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
# Optional `-d NAME` / `--dbname NAME` selects the database after it exists.
# Default is MAINTENANCE_DB (postgres). Inherited PGDATABASE / PGSERVICE are
# ignored. Short `-d` is never passed through `docker compose exec`.
psql_super() {
  local dbname="$MAINTENANCE_DB"
  case "${1:-}" in
    -d|--dbname)
      dbname="${2:?psql_super: missing database name after $1}"
      shift 2
      ;;
    --dbname=*)
      dbname="${1#--dbname=}"
      shift
      ;;
  esac

  local pguser="${PGUSER:-postgres}"
  local pghost="${PGHOST:-}"
  local pgport="${PGPORT:-5432}"
  local pgpassword="${PGPASSWORD:-postgres}"
  (
    unset PGDATABASE PGSERVICE
    if has_cmd psql; then
      if [ -n "$pghost" ]; then
        PGPASSWORD="$pgpassword" psql -h "$pghost" -p "$pgport" --username="$pguser" \
          --dbname="$dbname" --set=ON_ERROR_STOP=1 "$@"
        exit $?
      fi
      if has_cmd sudo && id postgres >/dev/null 2>&1; then
        sudo -u postgres psql --dbname="$dbname" --set=ON_ERROR_STOP=1 "$@"
        exit $?
      fi
      psql --username=postgres --dbname="$dbname" --set=ON_ERROR_STOP=1 "$@"
      exit $?
    fi

    container="$(postgres_docker_container || true)"
    if [ -n "$container" ]; then
      # docker exec: flags after the container name are the command. `-d` here
      # would be psql's dbname, but we still use --dbname= to be explicit.
      docker exec -i \
        -e PGDATABASE="$dbname" \
        -e PGUSER="$DOCKER_PGUSER" \
        "$container" \
        psql --username="$DOCKER_PGUSER" --dbname="$dbname" --set=ON_ERROR_STOP=1 "$@"
      exit $?
    fi

    echo "Could not find psql or a Docker PostgreSQL container." >&2
    echo "Start Docker Desktop (infra/docker-compose.yml), then retry." >&2
    echo "You do not need a local PostgreSQL server — Docker Desktop is enough." >&2
    echo "To wipe the Compose volume this script uses:" >&2
    echo "  docker compose --project-directory infra -p infra -f infra/docker-compose.yml down -v" >&2
    exit 1
  )
}
