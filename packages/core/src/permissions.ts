import type { Actor } from "@schoolapp/domain";
import { actorHas } from "@schoolapp/domain";
import { AppError } from "./errors.js";

export function assertPermission(actor: Actor, permission: string): void {
  if (!actorHas(actor, permission)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function assertAnyPermission(actor: Actor, permissions: readonly string[]): void {
  if (!permissions.some((permission) => actorHas(actor, permission))) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

export function notFound(): never {
  throw new AppError(404, "not_found", "Not found");
}
