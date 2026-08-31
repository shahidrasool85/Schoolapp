import { describe, expect, it } from "vitest";
import { allowedSubjectIdsForClasses } from "./teacher-scope.js";

describe("teacher subject scope", () => {
  it("returns no subjects when class_subjects have not been configured", () => {
    const attached = new Map<string, Set<string>>([
      ["class-3a", new Set()],
    ]);
    expect([...allowedSubjectIdsForClasses(attached)]).toEqual([]);
    expect([...allowedSubjectIdsForClasses(attached, ["class-3a"])]).toEqual([]);
  });

  it("allows subjects attached to the assigned class, never a school-wide fallback", () => {
    const maths = "sub-maths";
    const french = "sub-french";
    const attached = new Map<string, Set<string>>([
      ["class-3a", new Set([maths])],
      ["class-7a", new Set([french])],
    ]);
    expect(allowedSubjectIdsForClasses(attached, ["class-3a"]).has(maths)).toBe(true);
    expect(allowedSubjectIdsForClasses(attached, ["class-3a"]).has(french)).toBe(false);
    expect(allowedSubjectIdsForClasses(attached).has(french)).toBe(true);
  });

  it("intersects subjects when several target classes are selected", () => {
    const maths = "sub-maths";
    const pe = "sub-pe";
    const attached = new Map<string, Set<string>>([
      ["class-3a", new Set([maths, pe])],
      ["class-3b", new Set([maths])],
    ]);
    expect([...allowedSubjectIdsForClasses(attached, ["class-3a", "class-3b"])]).toEqual([maths]);
  });
});
