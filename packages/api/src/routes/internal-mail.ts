import { timingSafeEqual } from "node:crypto";
import { AppError } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { deliverQueuedMail } from "../email-delivery";

function workerSecretMatches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function registerInternalMailRoutes(app: SchoolappApi) {
  app.post("/internal/mail/deliver", async (c) => {
    const secret = c.get("config").emailWorkerSecret;
    if (!secret) {
      throw new AppError(404, "not_found", "Not found");
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !workerSecretMatches(secret, token)) {
      throw new AppError(401, "unauthenticated", "Invalid worker credential");
    }
    const limitRaw = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;
    const result = await deliverQueuedMail(c.get("config"), { limit });
    return c.json(result);
  });
}
