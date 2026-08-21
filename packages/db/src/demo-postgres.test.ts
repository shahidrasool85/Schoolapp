import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPOSE_CONTAINER,
  COMPOSE_SERVICE,
  MAINTENANCE_DB,
  dockerComposePgIsreadyArgv,
  dockerComposePsqlArgv,
  dockerExecPgIsreadyArgv,
  selectPostgresReadyStrategy,
} from "./demo-postgres.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("demo postgres readiness strategy", () => {
  it("uses local pg_isready when it is on PATH", () => {
    expect(selectPostgresReadyStrategy({ hasLocalPgIsready: true, hasDocker: true })).toBe(
      "pg_isready",
    );
    expect(selectPostgresReadyStrategy({ hasLocalPgIsready: true, hasDocker: false })).toBe(
      "pg_isready",
    );
  });

  it("falls back to Docker exec when pg_isready is missing", () => {
    expect(selectPostgresReadyStrategy({ hasLocalPgIsready: false, hasDocker: true })).toBe(
      "docker-exec",
    );
    expect(selectPostgresReadyStrategy({ hasLocalPgIsready: false, hasDocker: false })).toBe("none");
  });

  it("builds docker compose exec pg_isready/psql argv for the infra service", () => {
    const file = "infra/docker-compose.yml";
    expect(dockerComposePgIsreadyArgv(file)).toEqual([
      "compose",
      "--project-directory",
      "infra",
      "-f",
      file,
      "exec",
      "-T",
      "-e",
      `PGDATABASE=${MAINTENANCE_DB}`,
      COMPOSE_SERVICE,
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      MAINTENANCE_DB,
    ]);
    expect(dockerComposePsqlArgv(file)).toEqual([
      "compose",
      "--project-directory",
      "infra",
      "-f",
      file,
      "exec",
      "-T",
      "-e",
      `PGDATABASE=${MAINTENANCE_DB}`,
      COMPOSE_SERVICE,
      "psql",
      "-U",
      "postgres",
      "-d",
      MAINTENANCE_DB,
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    expect(dockerExecPgIsreadyArgv()).toEqual([
      "exec",
      "-e",
      `PGDATABASE=${MAINTENANCE_DB}`,
      COMPOSE_CONTAINER,
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      MAINTENANCE_DB,
    ]);
  });
});

describe("demo postgres shell helper", () => {
  it("checks local pg_isready first and Docker exec without requiring a local client", () => {
    const helper = fs.readFileSync(path.join(repoRoot, "scripts/lib-postgres.sh"), "utf8");
    expect(helper).toContain("has_cmd pg_isready");
    expect(helper).toContain("command -v");
    expect(helper).toContain("postgres_ready_local");
    expect(helper).toContain("postgres_ready_docker");
    expect(helper).toMatch(/compose exec -T[\s\S]*pg_isready/);
    expect(helper).toContain("--project-directory");
    expect(helper).toContain(COMPOSE_CONTAINER);
    expect(helper).toContain("has_cmd psql");
    expect(helper).toMatch(/compose exec -T[\s\S]*psql/);
    expect(helper).toContain("docker exec -i");
    expect(helper).toContain('docker exec -e PGDATABASE="$MAINTENANCE_DB" "$container"');
    expect(helper).toContain("com.docker.compose.project");
    expect(helper).not.toContain("publish=");
    expect(helper).toContain('unset PGDATABASE PGSERVICE');
    expect(helper).toContain('-d "$maintenance"');
    expect(helper).toContain('MAINTENANCE_DB="${SCHOOLAPP_MAINTENANCE_DB:-postgres}"');
  });

  it("demo setup sources the helper instead of calling host pg_isready directly", () => {
    const setup = fs.readFileSync(path.join(repoRoot, "scripts/demo-setup.sh"), "utf8");
    expect(setup).toContain('source "$ROOT/scripts/lib-postgres.sh"');
    expect(setup).toContain("postgres_ready");
    expect(setup).not.toMatch(/^\s*pg_isready\b/m);
    expect(setup).toContain("unset PGDATABASE PGSERVICE");
    const reset = fs.readFileSync(path.join(repoRoot, "scripts/demo-reset.sh"), "utf8");
    expect(reset).toContain('source "$ROOT/scripts/lib-postgres.sh"');
    expect(reset).toContain("unset PGDATABASE PGSERVICE");
    const dbSetup = fs.readFileSync(path.join(repoRoot, "scripts/setup-db.sh"), "utf8");
    expect(dbSetup).toContain('source "$ROOT/scripts/lib-postgres.sh"');
    expect(dbSetup).toContain("unset PGDATABASE PGSERVICE");
    expect(dbSetup).toContain("ALTER DATABASE ${DB_NAME} OWNER TO ${OWNER_USER}");
    expect(dbSetup).toContain("ALTER DATABASE ${TEST_DB_NAME} OWNER TO ${OWNER_USER}");
    expect(dbSetup).toContain("CREATE DATABASE ${TEST_DB_NAME} OWNER ${OWNER_USER}");
    const compose = fs.readFileSync(path.join(repoRoot, "infra/docker-compose.yml"), "utf8");
    expect(compose).toMatch(/POSTGRES_DB:\s*postgres/);
    expect(compose).not.toMatch(/POSTGRES_DB:\s*schoolapp/);
  });

  it("parses demo postgres shell scripts", () => {
    for (const file of [
      "scripts/lib-postgres.sh",
      "scripts/demo-setup.sh",
      "scripts/demo-reset.sh",
      "scripts/setup-db.sh",
    ]) {
      execFileSync("bash", ["-n", path.join(repoRoot, file)], { stdio: "pipe" });
    }
  });
});

describe("Git Bash launcher", () => {
  it("prefers Git for Windows bash.exe locations", () => {
    const launcher = fs.readFileSync(path.join(repoRoot, "scripts/run-bash.mjs"), "utf8");
    expect(launcher).toContain(String.raw`Git", "bin", "bash.exe"`);
    expect(launcher).toContain("SCHOOLAPP_BASH");
    expect(launcher).toMatch(/Git Bash/);
    expect(launcher).toMatch(/PowerShell/);
    expect(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).toContain(
      "node scripts/run-bash.mjs scripts/demo-setup.sh",
    );
  });
});

describe("fresh-volume bootstrap", () => {
  const pgEnv = {
    ...process.env,
    PGHOST: process.env.PGHOST ?? "127.0.0.1",
    PGPORT: process.env.PGPORT ?? "5432",
    PGUSER: process.env.PGUSER ?? "postgres",
    PGPASSWORD: process.env.PGPASSWORD ?? "postgres",
    PGDATABASE: "schoolapp_test",
  };

  it("psql_super uses postgres even when PGDATABASE is schoolapp_test", () => {
    const script = `
set -euo pipefail
ROOT=${JSON.stringify(repoRoot)}
# shellcheck source=/dev/null
source "$ROOT/scripts/lib-postgres.sh"
psql_super -tAc "SELECT current_database()"
`;
    const db = execFileSync("bash", ["-c", script], { encoding: "utf8", env: pgEnv }).trim();
    expect(db).toBe("postgres");
  });

  it("setup-db.sh bootstraps when PGDATABASE points at a missing database", () => {
    execFileSync("bash", [path.join(repoRoot, "scripts/setup-db.sh")], {
      env: {
        ...pgEnv,
        PGDATABASE: "schoolapp_test_does_not_exist",
      },
      stdio: "pipe",
    });
    const ownerScript = `
set -euo pipefail
ROOT=${JSON.stringify(repoRoot)}
# shellcheck source=/dev/null
source "$ROOT/scripts/lib-postgres.sh"
psql_super -tAc "SELECT datname || '=' || pg_catalog.pg_get_userbyid(datdba)
FROM pg_database
WHERE datname IN ('schoolapp','schoolapp_test','schoolapp_api_test')
ORDER BY datname"
`;
    const owners = execFileSync("bash", ["-c", ownerScript], {
      encoding: "utf8",
      env: { ...pgEnv, PGDATABASE: "schoolapp_test_does_not_exist" },
    })
      .trim()
      .split("\n");
    expect(owners).toEqual([
      "schoolapp=schoolapp_owner",
      "schoolapp_api_test=schoolapp_owner",
      "schoolapp_test=schoolapp_owner",
    ]);
  });
});
