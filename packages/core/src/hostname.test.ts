import { describe, expect, it } from "vitest";
import {
  RESERVED_SUBDOMAINS,
  isReservedSubdomain,
  validateOrganisationSlug,
} from "@schoolapp/domain";
import {
  bindOrganisationHint,
  classifyHostname,
  headerMatchesHostSlug,
  parseHostHeader,
  selectRequestHost,
} from "./index.js";

describe("organisation slugs", () => {
  it("accepts dns-safe lowercase slugs", () => {
    expect(validateOrganisationSlug("greenwood")).toEqual({ ok: true, slug: "greenwood" });
    expect(validateOrganisationSlug("OakAcademy")).toEqual({ ok: true, slug: "oakacademy" });
    expect(validateOrganisationSlug("kings-wood")).toEqual({ ok: true, slug: "kings-wood" });
  });

  it("rejects reserved, malformed, and punycode slugs", () => {
    for (const slug of ["www", "api", "admin", "localhost", "login"]) {
      expect(validateOrganisationSlug(slug).ok).toBe(false);
      expect(isReservedSubdomain(slug)).toBe(true);
    }
    expect(validateOrganisationSlug("a").ok).toBe(false);
    expect(validateOrganisationSlug("-greenwood").ok).toBe(false);
    expect(validateOrganisationSlug("greenwood-").ok).toBe(false);
    expect(validateOrganisationSlug("green wood").ok).toBe(false);
    expect(validateOrganisationSlug("Green_Wood").ok).toBe(false);
    expect(validateOrganisationSlug("greenwood--academy").ok).toBe(false);
    expect(validateOrganisationSlug("xn--greenwood").ok).toBe(false);
    expect(RESERVED_SUBDOMAINS).toContain("www");
  });
});

describe("hostname parsing", () => {
  it("strips ports and lowercases hostnames", () => {
    expect(parseHostHeader("Greenwood.Localhost:3000")).toEqual({
      hostname: "greenwood.localhost",
      port: "3000",
    });
    expect(parseHostHeader("schoolapp-domain.com.")).toEqual({
      hostname: "schoolapp-domain.com",
      port: null,
    });
    expect(parseHostHeader("[::1]:3000")).toEqual({ hostname: "::1", port: "3000" });
  });

  it("rejects malformed hosts", () => {
    expect(parseHostHeader("")).toBeNull();
    expect(parseHostHeader("greenwood.localhost/login")).toBeNull();
    expect(parseHostHeader("greenwood.localhost,evil.com")).toBeNull();
    expect(parseHostHeader("user@greenwood.localhost")).toBeNull();
    expect(parseHostHeader("greenwood.localhost:99999")).toBeNull();
  });

  it("ignores X-Forwarded-Host unless the proxy is trusted", () => {
    expect(
      selectRequestHost({
        host: "greenwood.localhost:3000",
        forwardedHost: "oakacademy.localhost",
        trustProxy: false,
        platformDomain: "localhost",
      }),
    ).toBe("greenwood.localhost:3000");
    expect(
      selectRequestHost({
        host: "127.0.0.1:3000",
        forwardedHost: "greenwood.localhost:3000, spoof.example",
        trustProxy: true,
        platformDomain: "localhost",
      }),
    ).toBe("greenwood.localhost:3000");
    expect(
      selectRequestHost({
        host: "greenwood.localhost:3000",
        forwardedHost: "oakacademy.localhost",
        trustProxy: true,
        platformDomain: "localhost",
      }),
    ).toBe("greenwood.localhost:3000");
  });
});

describe("hostname classification", () => {
  it("treats the root platform domain and local IPs as platform context", () => {
    expect(classifyHostname("localhost", "localhost")).toMatchObject({ kind: "platform" });
    expect(classifyHostname("127.0.0.1", "localhost")).toMatchObject({ kind: "platform" });
    expect(classifyHostname("schoolapp-domain.com", "schoolapp-domain.com")).toMatchObject({
      kind: "platform",
    });
    expect(classifyHostname("www.schoolapp-domain.com", "schoolapp-domain.com")).toMatchObject({
      kind: "platform",
    });
  });

  it("extracts a single-label school subdomain", () => {
    expect(classifyHostname("greenwood.localhost", "localhost")).toEqual({
      kind: "school_subdomain",
      hostname: "greenwood.localhost",
      slug: "greenwood",
    });
    expect(classifyHostname("oakacademy.schoolapp-domain.com", "schoolapp-domain.com")).toEqual({
      kind: "school_subdomain",
      hostname: "oakacademy.schoolapp-domain.com",
      slug: "oakacademy",
    });
  });

  it("protects reserved platform subdomains", () => {
    expect(classifyHostname("api.localhost", "localhost")).toMatchObject({
      kind: "reserved",
      label: "api",
    });
    expect(classifyHostname("www.localhost", "localhost")).toMatchObject({ kind: "platform" });
  });

  it("does not treat nested or unknown labels as a school slug", () => {
    expect(classifyHostname("a.b.localhost", "localhost")).toMatchObject({
      kind: "unknown_subdomain",
    });
    expect(classifyHostname("portal.greenwoodacademy.org.uk", "schoolapp-domain.com")).toEqual({
      kind: "custom",
      hostname: "portal.greenwoodacademy.org.uk",
    });
  });
});

describe("hostname and membership bind", () => {
  const greenwood = "11111111-1111-1111-1111-111111111111";
  const oak = "22222222-2222-2222-2222-222222222222";

  it("uses the hostname organisation and rejects a mismatched header", () => {
    expect(
      bindOrganisationHint({
        hostKind: "school",
        hostOrganisationId: greenwood,
        headerOrganisationId: null,
      }),
    ).toEqual({ ok: true, organisationId: greenwood, source: "hostname" });
    expect(
      bindOrganisationHint({
        hostKind: "school",
        hostOrganisationId: greenwood,
        headerOrganisationId: oak,
      }),
    ).toEqual({ ok: false, reason: "org_host_mismatch" });
  });

  it("allows X-Organisation-Id only on the platform host", () => {
    expect(
      bindOrganisationHint({
        hostKind: "platform",
        hostOrganisationId: null,
        headerOrganisationId: oak,
      }),
    ).toEqual({ ok: true, organisationId: oak, source: "platform_header" });
    expect(
      bindOrganisationHint({
        hostKind: "unknown",
        hostOrganisationId: null,
        headerOrganisationId: oak,
      }),
    ).toEqual({ ok: false, reason: "tenant_not_found" });
  });

  it("does not treat a visual slug as authentication authority", () => {
    expect(headerMatchesHostSlug({ hostSlug: "greenwood", requestedSlug: "oakacademy" })).toBe(
      false,
    );
    expect(headerMatchesHostSlug({ hostSlug: "greenwood", requestedSlug: "Greenwood" })).toBe(true);
  });
});
