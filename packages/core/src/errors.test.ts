import { describe, expect, it } from "vitest";
import { AppError, describeUnknownError, pgErrorToAppError } from "./errors.js";

describe("describeUnknownError", () => {
  it("summarises AppError without dumping internals", () => {
    const error = new AppError(500, "internal_error", "Internal error");
    expect(describeUnknownError(error)).toEqual({
      name: "AppError",
      status: 500,
      code: "internal_error",
      message: "Internal error",
    });
  });

  it("copies postgres fields and the stack from a node error", () => {
    const error = Object.assign(new Error("relation missing"), {
      code: "42P01",
      table: "nope",
      column: "id",
      constraint: "nope_pkey",
    });
    const described = describeUnknownError(error);
    expect(described).toMatchObject({
      name: "Error",
      message: "relation missing",
      code: "42P01",
      table: "nope",
      column: "id",
      constraint: "nope_pkey",
    });
    expect(String(described.stack ?? "")).toContain("relation missing");
  });
});

describe("pgErrorToAppError timeout mapping", () => {
  it("maps missing relation to 500 and statement timeout to 503", () => {
    expect(pgErrorToAppError({ code: "42P01", message: "missing" })?.status).toBe(500);
    expect(pgErrorToAppError({ code: "57014", message: "timeout" })?.status).toBe(503);
    expect(pgErrorToAppError({ code: "53300", message: "too many clients" })?.status).toBe(503);
  });
});
