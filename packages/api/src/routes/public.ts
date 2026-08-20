import { AppError } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { publicTenantPayload } from "../tenant-resolver";

export function registerPublicRoutes(app: SchoolappApi) {
  app.get("/public/tenant", (c) => {
    const payload = publicTenantPayload(c);
    if (payload.kind === "unknown") {
      return c.json({ error: { code: "tenant_not_found", message: "Not found" } }, 404);
    }
    return c.json(payload);
  });

  app.post("/public/signup", () => {
    throw new AppError(
      403,
      "onboarding_public_disabled",
      "Public school signup is not enabled. Schools are onboarded by a platform administrator.",
    );
  });
}
