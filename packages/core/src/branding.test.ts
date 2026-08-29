import { describe, expect, it } from "vitest";
import { PUBLIC_BRANDING_PATHS, publicBrandingAssetUrl } from "@schoolapp/domain";

describe("public branding asset URLs", () => {
  it("returns the unversioned path when no version is present", () => {
    expect(publicBrandingAssetUrl("logo")).toBe(PUBLIC_BRANDING_PATHS.logo);
    expect(publicBrandingAssetUrl("hero", null)).toBe(PUBLIC_BRANDING_PATHS.hero);
    expect(publicBrandingAssetUrl("logo", "   ")).toBe(PUBLIC_BRANDING_PATHS.logo);
  });

  it("appends a safe cache-busting version and rejects unsafe query values", () => {
    expect(publicBrandingAssetUrl("logo", "abc123def456")).toBe(
      `${PUBLIC_BRANDING_PATHS.logo}?v=abc123def456`,
    );
    expect(publicBrandingAssetUrl("hero", "deadbeef")).toBe(`${PUBLIC_BRANDING_PATHS.hero}?v=deadbeef`);
    expect(publicBrandingAssetUrl("logo", "../etc/passwd")).toBe(PUBLIC_BRANDING_PATHS.logo);
    expect(publicBrandingAssetUrl("logo", "ok&x=1")).toBe(PUBLIC_BRANDING_PATHS.logo);
  });
});
