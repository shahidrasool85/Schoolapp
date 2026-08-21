/** Decision helpers for local demo Postgres. Keep in sync with scripts/lib-postgres.sh. */

export const COMPOSE_SERVICE = "postgres";
export const COMPOSE_CONTAINER = "infra-postgres-1";

export type PostgresReadyStrategy = "pg_isready" | "docker-exec" | "none";

export function selectPostgresReadyStrategy(input: {
  hasLocalPgIsready: boolean;
  hasDocker: boolean;
}): PostgresReadyStrategy {
  if (input.hasLocalPgIsready) return "pg_isready";
  if (input.hasDocker) return "docker-exec";
  return "none";
}

function composeDir(composeFile: string): string {
  const trimmed = composeFile.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash === -1 ? "." : trimmed.slice(0, slash);
}

export const MAINTENANCE_DB = "postgres";

export function dockerComposePgIsreadyArgv(composeFile: string, user = "postgres"): string[] {
  return [
    "compose",
    "--project-directory",
    composeDir(composeFile),
    "-p",
    composeDir(composeFile),
    "-f",
    composeFile,
    "exec",
    "-T",
    "--",
    COMPOSE_SERVICE,
    "pg_isready",
    `--username=${user}`,
    `--dbname=${MAINTENANCE_DB}`,
  ];
}

export function dockerComposePsqlArgv(composeFile: string, user = "postgres"): string[] {
  return [
    "exec",
    "-i",
    "-e",
    `PGDATABASE=${MAINTENANCE_DB}`,
    "-e",
    `PGUSER=${user}`,
    COMPOSE_CONTAINER,
    "psql",
    `--username=${user}`,
    `--dbname=${MAINTENANCE_DB}`,
    "--set=ON_ERROR_STOP=1",
  ];
}

export function dockerExecPgIsreadyArgv(container = COMPOSE_CONTAINER, user = "postgres"): string[] {
  return [
    "exec",
    "-e",
    `PGDATABASE=${MAINTENANCE_DB}`,
    container,
    "pg_isready",
    `--username=${user}`,
    `--dbname=${MAINTENANCE_DB}`,
  ];
}

/** True when argv would let `docker compose exec` treat `-d` as `--detach`. */
export function composeExecArgvStealsDetach(argv: string[]): boolean {
  const execAt = argv.indexOf("exec");
  if (execAt === -1) return false;
  const ddash = argv.indexOf("--", execAt);
  const region = ddash === -1 ? argv.slice(execAt + 1) : argv.slice(execAt + 1, ddash);
  return region.some((part) => part === "-d" || part === "--detach");
}
