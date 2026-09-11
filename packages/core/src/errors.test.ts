import { describe, expect, it } from "vitest";
import { AppError, describeUnknownError, pgErrorToAppError } from "./errors.js";

describe("describeUnknownError", () => {
  it("extracts postgres fields used for operational-reset logging", () => {
    const error = Object.assign(new Error('column "mode" does not exist'), {
      code: "42703",
      severity: "ERROR",
      table: "school_payment_provider_configs",
      column: "mode",
      constraint: null,
    });
    expect(describeUnknownError(error)).toMatchObject({
      name: "Error",
      message: 'column "mode" does not exist',
      code: "42703",
      severity: "ERROR",
      table: "school_payment_provider_configs",
      column: "mode",
    });
    expect(describeUnknownError(error)).not.toHaveProperty("constraint");
  });

  it("summarises AppError without treating it as a postgres failure", () => {
    expect(describeUnknownError(new AppError(409, "conflict", "Not allowed"))).toEqual({
      name: "AppError",
      status: 409,
      code: "conflict",
      message: "Not allowed",
    });
  });
});

describe("pgErrorToAppError schema failures", () => {
  it("maps missing relation/column/function to an internal 500", () => {
    const missingColumn = Object.assign(new Error('column "mode" does not exist'), { code: "42703" });
    const mapped = pgErrorToAppError(missingColumn);
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.status).toBe(500);
    expect(mapped?.code).toBe("internal_error");
  });

  it("maps statement timeout and connection exhaustion to 503", () => {
    const timeout = pgErrorToAppError(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }));
    expect(timeout?.status).toBe(503);
    const crowded = pgErrorToAppError(Object.assign(new Error("sorry, too many clients already"), { code: "53300" }));
    expect(crowded?.status).toBe(503);
  });
});
