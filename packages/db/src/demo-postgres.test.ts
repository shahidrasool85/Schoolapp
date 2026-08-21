import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPOSE_CONTAINER,
  COMPOSE_SERVICE,
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
      COMPOSE_SERVICE,
      "pg_isready",
      "-U",
      "postgres",
    ]);
    expect(dockerComposePsqlArgv(file)).toEqual([
      "compose",
      "--project-directory",
      "infra",
      "-f",
      file,
      "exec",
      "-T",
      COMPOSE_SERVICE,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    expect(dockerExecPgIsreadyArgv()).toEqual([
      "exec",
      COMPOSE_CONTAINER,
      "pg_isready",
      "-U",
      "postgres",
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
    expect(helper).toMatch(/compose exec -T .*pg_isready/);
    expect(helper).toContain("--project-directory");
    expect(helper).toContain(COMPOSE_CONTAINER);
    expect(helper).toContain("has_cmd psql");
    expect(helper).toMatch(/compose exec -T .*psql/);
    expect(helper).toContain("docker exec -i");
    expect(helper).toContain("docker exec \"$container\" pg_isready");
  });

  it("demo setup sources the helper instead of calling host pg_isready directly", () => {
    const setup = fs.readFileSync(path.join(repoRoot, "scripts/demo-setup.sh"), "utf8");
    expect(setup).toContain('source "$ROOT/scripts/lib-postgres.sh"');
    expect(setup).toContain("postgres_ready");
    expect(setup).not.toMatch(/^\s*pg_isready\b/m);
    const reset = fs.readFileSync(path.join(repoRoot, "scripts/demo-reset.sh"), "utf8");
    expect(reset).toContain('source "$ROOT/scripts/lib-postgres.sh"');
    const dbSetup = fs.readFileSync(path.join(repoRoot, "scripts/setup-db.sh"), "utf8");
    expect(dbSetup).toContain('source "$ROOT/scripts/lib-postgres.sh"');
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
