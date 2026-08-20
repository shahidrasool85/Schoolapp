import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError } from "@schoolapp/core";
import type { ApiConfig, ApiEnv } from "./types";
import { registerAuthRoutes } from "./routes/auth";
import { registerMeRoutes } from "./routes/me";
import { registerPlatformRoutes } from "./routes/platform";
import { registerOrganisationRoutes } from "./routes/organisation";

export type { ApiConfig, ApiEnv, SchoolappApi } from "./types";

export function createApiApp(config: ApiConfig) {
  const app = new Hono<ApiEnv>().basePath("/api/v1");

  app.use("*", async (c, next) => {
    c.set("config", config);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-Organisation-Id", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerPlatformRoutes(app);
  registerOrganisationRoutes(app);

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Not found" } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: { code: "internal_error", message: "Internal error" } }, 500);
  });

  return app;
}
