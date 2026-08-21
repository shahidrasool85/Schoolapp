# Shared local/demo Postgres helpers. ROOT must be set to the repository root.
# Prefers local pg_isready/psql when present (Linux/macOS/CI).
# Falls back to Docker Compose exec so Windows users do not need a local Postgres client.

COMPOSE_FILE="${COMPOSE_FILE:-${ROOT}/infra/docker-compose.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
COMPOSE_SERVICE="${SCHOOLAPP_COMPOSE_POSTGRES_SERVICE:-postgres}"
COMPOSE_CONTAINER="${SCHOOLAPP_COMPOSE_POSTGRES_CONTAINER:-infra-postgres-1}"
COMPOSE_PROJECT="${SCHOOLAPP_COMPOSE_PROJECT:-$(basename "$COMPOSE_DIR")}"

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
  pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" >/dev/null 2>&1
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
  if docker_compose exec -T "$COMPOSE_SERVICE" pg_isready -U "${PGUSER:-postgres}" >/dev/null 2>&1; then
    return 0
  fi
  local container
  container="$(postgres_docker_container || true)"
  if [ -n "$container" ] && docker exec "$container" pg_isready -U "${PGUSER:-postgres}" >/dev/null 2>&1; then
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
psql_super() {
  if has_cmd psql; then
    if [ -n "${PGHOST:-}" ]; then
      PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 "$@"
      return $?
    fi
    if has_cmd sudo && id postgres >/dev/null 2>&1; then
      sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
      return $?
    fi
    psql -U postgres -v ON_ERROR_STOP=1 "$@"
    return $?
  fi

  if docker_compose exec -T "$COMPOSE_SERVICE" pg_isready -U "${PGUSER:-postgres}" >/dev/null 2>&1; then
    docker_compose exec -T "$COMPOSE_SERVICE" psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 "$@"
    return $?
  fi

  local container
  container="$(postgres_docker_container || true)"
  if [ -n "$container" ]; then
    docker exec -i "$container" psql -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 "$@"
    return $?
  fi

  echo "Could not find psql or a Docker PostgreSQL container." >&2
  echo "Start Docker Desktop (infra/docker-compose.yml), then retry." >&2
  echo "You do not need a local PostgreSQL server — Docker Desktop is enough." >&2
  return 1
}
