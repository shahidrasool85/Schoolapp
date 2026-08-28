import { describe, expect, it } from "vitest";
import { importTemplateCsv, parseCsvText, validateStaffImportRow } from "./imports.js";

describe("csv import", () => {
  it("protects template example cells against formula injection", () => {
    const csv = importTemplateCsv("staff");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("full_name");
  });

  it("parses quoted commas", () => {
    const parsed = parseCsvText('full_name,email\n"Smith, Alex",alex@example.com\n');
    expect(parsed.rows[0]?.[0]).toBe("Smith, Alex");
  });

  it("rejects imported admin roles", () => {
    const result = validateStaffImportRow({
      full_name: "Pat",
      email: "pat@example.com",
      job_title: "IT",
      role: "school.admin",
    });
    expect(result.roleKey).toBeNull();
    expect(result.issues.some((issue) => issue.code === "role_not_importable")).toBe(true);
  });
});
