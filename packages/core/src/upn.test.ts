import { describe, expect, it } from "vitest";
import { generatePermanentUpn, validateUpn } from "./upn.js";

describe("UPN validation", () => {
  it("accepts a DfE check-letter permanent UPN", () => {
    const upn = generatePermanentUpn("201990100001");
    expect(upn).toBe("P201990100001");
    expect(validateUpn(upn)).toEqual({
      ok: true,
      kind: "permanent",
      reason: null,
      normalised: "P201990100001",
    });
  });

  it("normalises whitespace and case", () => {
    expect(validateUpn(" p201990100001 ").normalised).toBe("P201990100001");
  });

  it("rejects a missing or short value", () => {
    expect(validateUpn(null).reason).toBe("missing");
    expect(validateUpn("").reason).toBe("missing");
    expect(validateUpn("P20199010000").reason).toBe("length");
  });

  it("rejects an incorrect check letter", () => {
    expect(validateUpn("A201990100001")).toMatchObject({
      ok: false,
      kind: "permanent",
      reason: "checksum",
    });
  });

  it("accepts a temporary UPN with a letter in position 2", () => {
    expect(validateUpn("P20199010000A")).toMatchObject({ ok: false, reason: "format" });
    expect(validateUpn("PA01990100001")).toEqual({
      ok: true,
      kind: "temporary",
      reason: null,
      normalised: "PA01990100001",
    });
  });
});
