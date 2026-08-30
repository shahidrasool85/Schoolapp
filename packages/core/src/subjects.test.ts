import { describe, expect, it } from "vitest";
import {
  parseSchoolSearchQuery,
  parseSubjectCreateInput,
  parseSubjectUpdateInput,
  safeRelativeNext,
  summarizeAcademicUsage,
  validateSubjectKey,
} from "@schoolapp/domain";

describe("subject key rules", () => {
  it("trims and lowercases keys so Eng and ENG become eng", () => {
    expect(validateSubjectKey("Eng")).toEqual({ ok: true, key: "eng" });
    expect(validateSubjectKey("ENG")).toEqual({ ok: true, key: "eng" });
    expect(validateSubjectKey(" math ")).toEqual({ ok: true, key: "math" });
  });

  it("does not invent English→ENG or Mathematics→MATH mappings", () => {
    const english = parseSubjectCreateInput({ name: "English", key: "Eng" });
    expect(english).toEqual({ ok: true, name: "English", key: "eng" });
    const maths = parseSubjectCreateInput({ name: "Mathematics", key: "MATH" });
    expect(maths).toEqual({ ok: true, name: "Mathematics", key: "math" });
    const custom = parseSubjectCreateInput({ name: "English", key: "lit" });
    expect(custom).toEqual({ ok: true, name: "English", key: "lit" });
  });

  it("derives a key from the name only when the key is blank", () => {
    expect(parseSubjectCreateInput({ name: "English Literature", key: "" })).toEqual({
      ok: true,
      name: "English Literature",
      key: "english-literature",
    });
  });

  it("rejects invalid characters instead of silently rewriting them", () => {
    const bang = parseSubjectCreateInput({ name: "English", key: "Eng!" });
    expect(bang.ok).toBe(false);
    if (!bang.ok) {
      expect(bang.field).toBe("key");
      expect(bang.error).toMatch(/letters, numbers, and hyphens/i);
    }
    const space = parseSubjectCreateInput({ name: "English", key: "Eng lish" });
    expect(space.ok).toBe(false);
  });

  it("rejects empty and oversized names", () => {
    expect(parseSubjectCreateInput({ name: "  ", key: "eng" }).ok).toBe(false);
    expect(parseSubjectCreateInput({ name: "A".repeat(81), key: "eng" }).ok).toBe(false);
  });

  it("lets a School Admin correct a subject name and key", () => {
    expect(parseSubjectUpdateInput({ name: "Mathematics", key: "maths" })).toEqual({
      ok: true,
      name: "Mathematics",
      key: "maths",
    });
    expect(parseSubjectUpdateInput({ name: "Mathematics" })).toEqual({
      ok: true,
      name: "Mathematics",
    });
    const invalid = parseSubjectUpdateInput({ key: "Math!" });
    expect(invalid.ok).toBe(false);
  });
});

describe("public school finder query", () => {
  it("requires a short typed query and does not treat URLs as destinations", () => {
    expect(parseSchoolSearchQuery("")).toEqual({ ok: false, query: "" });
    expect(parseSchoolSearchQuery("K")).toEqual({ ok: false, query: "" });
    expect(parseSchoolSearchQuery("%%")).toEqual({ ok: false, query: "" });
    expect(parseSchoolSearchQuery("%_")).toEqual({ ok: false, query: "" });
    expect(parseSchoolSearchQuery("Kingswood")).toEqual({ ok: true, query: "Kingswood" });
    expect(parseSchoolSearchQuery("https://evil.example/login").ok).toBe(true);
    expect(safeRelativeNext("https://evil.example/login")).toBeNull();
    expect(safeRelativeNext("//evil.example")).toBeNull();
    expect(safeRelativeNext("/invite")).toBe("/invite");
  });
});

describe("academic usage copy", () => {
  it("explains why a referenced record cannot be deleted using aggregate counts only", () => {
    expect(
      summarizeAcademicUsage(
        [{ key: "classes", label: "classes", count: 4 }],
        "This year group",
      ),
    ).toBe("This year group cannot be deleted because it has 4 classes. Archive it instead.");
    expect(
      summarizeAcademicUsage(
        [{ key: "class_memberships", label: "pupil enrolments", count: 12 }],
        "This class",
      ),
    ).toBe("This class cannot be deleted because it has 12 pupil enrolments. Archive it instead.");
    expect(
      summarizeAcademicUsage(
        [
          { key: "classes", label: "classes", count: 2 },
          { key: "timetable_entries", label: "timetable entries", count: 3 },
        ],
        "This academic year",
      ),
    ).toBe(
      "This academic year cannot be deleted because it has 2 classes and 3 timetable entries. Archive it instead.",
    );
  });
});
