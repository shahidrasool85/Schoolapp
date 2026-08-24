import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError, normalizePlatformDomain } from "@schoolapp/core";
import type { ApiConfig, ApiEnv } from "./types";
import { tenantResolver } from "./tenant-resolver";
import { registerAuthRoutes } from "./routes/auth";
import { registerMeRoutes } from "./routes/me";
import { registerPlatformRoutes } from "./routes/platform";
import { registerOrganisationRoutes } from "./routes/organisation";
import { registerAcademicRoutes } from "./routes/academic";
import { registerPeopleRoutes } from "./routes/people";
import { registerParentRoutes } from "./routes/parent";
import { registerStudentRoutes } from "./routes/student";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerAdmissionsRoutes } from "./routes/admissions";
import { registerAttendanceRoutes } from "./routes/attendance";
import { registerStudentPortalRoutes } from "./routes/student-portal";
import { registerDocumentRoutes } from "./routes/documents";
import { registerLearningRoutes } from "./routes/learning";
import { registerAssessmentRoutes } from "./routes/assessments";
import { registerPublicRoutes } from "./routes/public";
import { registerAdmissionsFormRoutes } from "./routes/admissions-forms";
import { registerPublicFormRoutes } from "./routes/public-forms";
import { registerCommunicationRoutes } from "./routes/communications";
import { registerBehaviourRoutes } from "./routes/behaviour";
import { registerPastoralRoutes } from "./routes/pastoral";
import { registerSafeguardingRoutes } from "./routes/safeguarding";
import { registerTimetableRoutes } from "./routes/timetable";

export type { ApiConfig, ApiEnv, SchoolappApi } from "./types";

export function createApiApp(config: ApiConfig) {
  const resolvedConfig: ApiConfig = {
    ...config,
    platformDomain: normalizePlatformDomain(config.platformDomain),
    trustProxy: Boolean(config.trustProxy),
  };
  if (resolvedConfig.trustProxy && process.env.VITEST !== "true") {
    console.warn(
      "TRUST_PROXY is enabled. Honour X-Forwarded-Host only when the reverse proxy overwrites client-supplied forwarded headers; do not pass them through.",
    );
  }
  const app = new Hono<ApiEnv>().basePath("/api/v1");

  app.use("*", async (c, next) => {
    c.set("config", resolvedConfig);
    await next();
  });

  app.use("*", tenantResolver);

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "X-Organisation-Id", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  registerPublicRoutes(app);
  registerPublicFormRoutes(app);
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerPlatformRoutes(app);
  registerOrganisationRoutes(app);
  registerAcademicRoutes(app);
  registerPeopleRoutes(app);
  registerParentRoutes(app);
  registerStudentRoutes(app);
  registerNotificationRoutes(app);
  registerAdmissionsRoutes(app);
  registerAdmissionsFormRoutes(app);
  registerAttendanceRoutes(app);
  registerStudentPortalRoutes(app);
  registerDocumentRoutes(app);
  registerLearningRoutes(app);
  registerAssessmentRoutes(app);
  registerCommunicationRoutes(app);
  registerBehaviourRoutes(app);
  registerPastoralRoutes(app);
  registerSafeguardingRoutes(app);
  registerTimetableRoutes(app);

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Not found" } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        error.status as 400,
      );
    }
    console.error(error);
    return c.json({ error: { code: "internal_error", message: "Internal error" } }, 500);
  });

  return app;
}
