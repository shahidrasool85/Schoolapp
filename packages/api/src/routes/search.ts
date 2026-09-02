import { z } from "zod";
import { AppError, globalSearch, loadFinanceSettings } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";

export function registerSearchRoutes(app: SchoolappApi) {
  app.get("/search", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      const parsed = z.object({ q: z.string().trim().min(1).max(80) }).safeParse({ q: c.req.query("q") ?? "" });
      if (!parsed.success) throw new AppError(400, "validation_failed", "Enter a search term");
      const settings = await loadFinanceSettings(client, orgId).catch(() => ({ studentsCanViewFinance: false }));
      return c.json(
        await globalSearch(client, {
          organisationId: orgId,
          actor,
          query: parsed.data.q,
          studentsCanViewFinance: Boolean(settings.studentsCanViewFinance),
        }),
      );
    }),
  );
}
