import { AppError } from "@schoolapp/core";
import { DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_PRIMARY, publicBrandingAssetUrl } from "@schoolapp/domain";
import type { SchoolappApi } from "../types";
import { publicTenantPayload } from "../tenant-resolver";
import { storageErrorToAppError, storageOf } from "../file-service";

export function registerPublicRoutes(app: SchoolappApi) {
  app.get("/public/tenant", async (c) => {
    const payload = publicTenantPayload(c);
    if (payload.kind === "unknown") {
      return c.json({ error: { code: "tenant_not_found", message: "Not found" } }, 404);
    }
    if (payload.kind !== "school") return c.json(payload);
    const branding = await c.get("config").pools.app.query<{
      organisation_name: string;
      tagline: string | null;
      primary_colour: string | null;
      accent_colour: string | null;
      has_logo: boolean;
      has_hero: boolean;
      logo_version: string | null;
      hero_version: string | null;
    }>("select * from get_public_school_branding($1)", [payload.organisation.id]);
    const row = branding.rows[0];
    return c.json({
      ...payload,
      organisation: {
        ...payload.organisation,
        name: row?.organisation_name ?? payload.organisation.name,
        branding: {
          tagline: row?.tagline ?? null,
          primaryColor: row?.primary_colour ?? DEFAULT_BRAND_PRIMARY,
          accentColor: row?.accent_colour ?? DEFAULT_BRAND_ACCENT,
          logoUrl: row?.has_logo ? publicBrandingAssetUrl("logo", row.logo_version) : null,
          heroImageUrl: row?.has_hero ? publicBrandingAssetUrl("hero", row.hero_version) : null,
        },
      },
    });
  });

  app.get("/public/branding/:kind", async (c) => {
    const host = c.get("tenantHost");
    if (host.kind !== "school") {
      throw new AppError(404, "not_found", "Not found");
    }
    const kind = c.req.param("kind");
    if (kind !== "logo" && kind !== "hero") {
      throw new AppError(404, "not_found", "Not found");
    }
    const object = await c.get("config").pools.app.query<{
      storage_key: string;
      content_type: string;
      byte_size: string;
    }>("select * from get_public_branding_object($1, $2)", [host.organisationId, kind]);
    const row = object.rows[0];
    if (!row) throw new AppError(404, "not_found", "Not found");
    try {
      const got = await storageOf(c).getObject(row.storage_key);
      if (!got) throw new AppError(404, "not_found", "Not found");
      const version = (c.req.query("v") ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      const cacheControl = version ? "public, max-age=86400" : "public, max-age=300";
      c.header("Cache-Control", cacheControl);
      return new Response(Buffer.from(got.body), {
        status: 200,
        headers: {
          "Content-Type": row.content_type,
          "Cache-Control": cacheControl,
          "Content-Length": String(got.byteSize),
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw storageErrorToAppError(error);
    }
  });

  app.post("/public/signup", () => {
    throw new AppError(
      403,
      "onboarding_public_disabled",
      "Public school signup is not enabled. Schools are onboarded by a platform administrator.",
    );
  });
}
