import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PRODUCTION_FILESYSTEM_ROOT_MESSAGE =
  "OBJECT_STORAGE_FS_ROOT must be configured to a persistent path when using filesystem object storage in production.";

export class StorageConfigError extends Error {
  readonly code = "storage_unconfigured" as const;

  constructor(message = PRODUCTION_FILESYSTEM_ROOT_MESSAGE) {
    super(message);
    this.name = "StorageConfigError";
  }
}

export type FilesystemRootResolveOptions = {
  cwd?: string;
  tmpdir?: string;
};

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function isSameOrInside(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function posixTempRoots(tmpdir: string): string[] {
  const roots = [path.resolve(tmpdir)];
  if (process.platform !== "win32") {
    roots.push(path.resolve("/tmp"), path.resolve("/var/tmp"));
  }
  return [...new Set(roots)];
}

function deployTreeRoots(cwd: string): string[] {
  const resolvedCwd = path.resolve(cwd);
  const roots = new Set<string>([resolvedCwd]);
  let dir = resolvedCwd;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      roots.add(dir);
      break;
    }
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "apps", "web"))) {
      roots.add(dir);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...roots];
}

function isUnsafeProductionRoot(resolved: string, options: FilesystemRootResolveOptions): boolean {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const tmpdir = options.tmpdir ?? os.tmpdir();
  const banned = [...posixTempRoots(tmpdir), ...deployTreeRoots(cwd)];
  if (banned.some((root) => isSameOrInside(resolved, root))) {
    return true;
  }
  const base = path.basename(resolved);
  return base === ".next" || base === "public" || base === "node_modules";
}

export function resolveFilesystemRoot(
  env: NodeJS.ProcessEnv = process.env,
  options: FilesystemRootResolveOptions = {},
): string {
  const raw = env.OBJECT_STORAGE_FS_ROOT?.trim() ?? "";
  const cwd = options.cwd ?? process.cwd();

  if (!isProductionRuntime(env)) {
    if (!raw) return path.join(options.tmpdir ?? os.tmpdir(), "schoolapp-object-storage");
    return path.resolve(cwd, raw);
  }

  if (!raw || !path.isAbsolute(raw)) {
    throw new StorageConfigError();
  }

  const resolved = path.resolve(raw);
  if (isUnsafeProductionRoot(resolved, { ...options, cwd })) {
    throw new StorageConfigError();
  }
  return resolved;
}

export function defaultFilesystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFilesystemRoot(env);
}
