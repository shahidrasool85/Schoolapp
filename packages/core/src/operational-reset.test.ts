import { describe, expect, it } from "vitest";
import { confirmationMatchesOrganisation, OPERATIONAL_RESET_MODE } from "@schoolapp/domain";

describe("operational reset confirmation", () => {
  it("accepts the school slug case-insensitively", () => {
    expect(
      confirmationMatchesOrganisation({ typed: "Kingswood", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(true);
    expect(
      confirmationMatchesOrganisation({ typed: "  kingswood  ", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(true);
  });

  it("accepts the school name case-insensitively", () => {
    expect(
      confirmationMatchesOrganisation({
        typed: "kingswood school",
        slug: "kingswood",
        name: "Kingswood School",
      }),
    ).toBe(true);
  });

  it("rejects the wrong school", () => {
    expect(
      confirmationMatchesOrganisation({ typed: "riverside", slug: "kingswood", name: "Kingswood School" }),
    ).toBe(false);
    expect(confirmationMatchesOrganisation({ typed: " ", slug: "kingswood", name: "Kingswood School" })).toBe(
      false,
    );
  });

  it("versions the reset plan", () => {
    expect(OPERATIONAL_RESET_MODE).toBe("operational_reset_v1");
  });
});
