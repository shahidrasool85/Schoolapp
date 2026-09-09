import { describe, expect, it } from "vitest";
import { PERMISSIONS, canAccessFinanceSettingsAdmin } from "@schoolapp/domain";

const schoolAdmin = [PERMISSIONS.FINANCE_SETTINGS_MANAGE, PERMISSIONS.FINANCE_INVOICES_READ];
const headteacher = [PERMISSIONS.FINANCE_INVOICES_READ, PERMISSIONS.FINANCE_REPORTS_READ, PERMISSIONS.FINANCE_ACCOUNTS_READ];
const teacher = [PERMISSIONS.STUDENTS_PROFILES_READ_ASSIGNED];

describe("finance settings access", () => {
  it("keeps bank details and Stripe settings off invoice readers", () => {
    expect(canAccessFinanceSettingsAdmin(schoolAdmin)).toBe(true);
    expect(canAccessFinanceSettingsAdmin(headteacher)).toBe(false);
    expect(canAccessFinanceSettingsAdmin(teacher)).toBe(false);
    expect(canAccessFinanceSettingsAdmin([PERMISSIONS.FINANCE_INVOICES_READ])).toBe(false);
    expect(canAccessFinanceSettingsAdmin([PERMISSIONS.FINANCE_MANAGE])).toBe(true);
  });
});
