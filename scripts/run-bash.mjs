import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function bashCandidates(
  platform = process.platform,
  env = process.env,
): string[] {
  const candidates: string[] = [];
  if (env.SCHOOLAPP_BASH) {
    candidates.push(env.SCHOOLAPP_BASH);
  }
  if (platform === "win32") {
    const programFiles = env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    candidates.push(
      path.join(programFiles, "Git", "bin", "bash.exe"),
      path.join(programFiles, "Git", "usr", "bin", "bash.exe"),
      path.join(programFilesX86, "Git", "bin", "bash.exe"),
    );
    if (localAppData) {
      candidates.push(path.join(localAppData, "Programs", "Git", "bin", "bash.exe"));
    }
  }
  candidates.push("bash");
  return candidates;
}

export function resolveBash(
  platform = process.platform,
  env = process.env,
  exists = (file: string) => fs.existsSync(file),
): string {
  for (const candidate of bashCandidates(platform, env)) {
    if (candidate === "bash") return "bash";
    if (exists(candidate)) return candidate;
  }
  return "bash";
}

export const GIT_BASH_HELP = `This command needs Bash.

On Windows:
  1. Install Git for Windows (https://git-scm.com/) so Git Bash is available
  2. Run \`pnpm demo:setup\` from Git Bash, or keep Git on PATH so this wrapper can find bash.exe
  3. Start Docker Desktop before demo setup if you are using the Compose Postgres service

PowerShell cannot run the demo shell scripts directly.`;

function toBashPath(file: string): string {
  if (process.platform !== "win32") return file;
  return file.replace(/\\/g, "/");
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (isMain) {
  const scriptArg = process.argv[2];
  if (!scriptArg) {
    console.error("Usage: node scripts/run-bash.mjs <script.sh> [args...]");
    process.exit(1);
  }
  const scriptPath = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(root, scriptArg);
  if (!fs.existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }
  const bash = resolveBash();
  const child = spawn(bash, [toBashPath(scriptPath), ...process.argv.slice(3)], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
    windowsHide: true,
  });
  child.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(GIT_BASH_HELP);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}
