import { describe, expect, it } from "vitest";
import { staffPersonaLabel } from "./index.js";

describe("staffPersonaLabel", () => {
  it("shows Teacher for a teacher membership, not School Admin", () => {
    // Greenwood Teacher (Hannah Cole) holds school.teacher only.
    expect(staffPersonaLabel(["school.teacher"])).toBe("Teacher");
    expect(staffPersonaLabel(["school.teacher"])).not.toBe("School Admin");
  });

  it("shows Headteacher for a headteacher membership", () => {
    expect(staffPersonaLabel(["school.headteacher"])).toBe("Headteacher");
  });

  it("shows School Admin for an operational admin membership", () => {
    // Greenwood School Admin / School Business Manager holds school.admin.
    expect(staffPersonaLabel(["school.admin"])).toBe("School Admin");
  });

  it("shows a sensible label for other staff roles", () => {
    expect(staffPersonaLabel(["school.admissions"])).toBe("Admissions Staff");
    expect(staffPersonaLabel(["school.staff"])).toBe("School Staff");
    expect(staffPersonaLabel([])).toBe("Staff");
    expect(staffPersonaLabel(["custom.org.role"])).toBe("Staff");
  });

  it("picks a single display role when the same school membership has several staff roles", () => {
    expect(staffPersonaLabel(["school.teacher", "school.headteacher"])).toBe("Headteacher");
    expect(staffPersonaLabel(["school.teacher", "school.admin"])).toBe("School Admin");
    expect(staffPersonaLabel(["school.staff", "school.admissions"])).toBe("Admissions Staff");
  });

  it("ignores parent and student roles when choosing a staff display label", () => {
    expect(staffPersonaLabel(["school.parent", "school.teacher"])).toBe("Teacher");
    expect(staffPersonaLabel(["school.student"])).toBe("Staff");
    expect(staffPersonaLabel(["school.parent"])).toBe("Staff");
  });

  it("does not infer access from the display label", () => {
    const teacherLabel = staffPersonaLabel(["school.teacher"]);
    const adminLabel = staffPersonaLabel(["school.admin"]);
    expect(teacherLabel).toBe("Teacher");
    expect(adminLabel).toBe("School Admin");
    expect(teacherLabel === adminLabel).toBe(false);
  });
});
