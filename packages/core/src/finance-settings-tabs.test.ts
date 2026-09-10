import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINANCE_SETTINGS_TAB,
  FINANCE_SETTINGS_PATH,
  FINANCE_SETTINGS_TAB_ITEMS,
  FINANCE_SETTINGS_TABS,
  financeSettingsTabHref,
  parseFinanceSettingsTab,
} from "@schoolapp/domain";

describe("finance settings tabs", () => {
  it("defaults to General when the tab is missing or invalid", () => {
    expect(DEFAULT_FINANCE_SETTINGS_TAB).toBe("general");
    expect(parseFinanceSettingsTab(null)).toBe("general");
    expect(parseFinanceSettingsTab(undefined)).toBe("general");
    expect(parseFinanceSettingsTab("")).toBe("general");
    expect(parseFinanceSettingsTab("nope")).toBe("general");
    expect(parseFinanceSettingsTab("ONLINE-PAYMENTS")).toBe("online-payments");
  });

  it("deep-links each settings tab", () => {
    expect(parseFinanceSettingsTab("general")).toBe("general");
    expect(parseFinanceSettingsTab("documents")).toBe("documents");
    expect(parseFinanceSettingsTab("payment")).toBe("payment");
    expect(parseFinanceSettingsTab("vat")).toBe("vat");
    expect(parseFinanceSettingsTab("online-payments")).toBe("online-payments");
    expect(parseFinanceSettingsTab("notifications")).toBe("notifications");
    expect(FINANCE_SETTINGS_TABS).toEqual([
      "general",
      "documents",
      "payment",
      "vat",
      "online-payments",
      "notifications",
    ]);
  });

  it("keeps settings under the existing Finance Settings URL", () => {
    expect(FINANCE_SETTINGS_PATH).toBe("/school/finance/settings");
    expect(financeSettingsTabHref("general")).toBe("/school/finance/settings?tab=general");
    expect(financeSettingsTabHref("documents")).toBe("/school/finance/settings?tab=documents");
    expect(financeSettingsTabHref("payment")).toBe("/school/finance/settings?tab=payment");
    expect(financeSettingsTabHref("vat")).toBe("/school/finance/settings?tab=vat");
    expect(financeSettingsTabHref("online-payments")).toBe(
      "/school/finance/settings?tab=online-payments",
    );
    expect(financeSettingsTabHref("notifications")).toBe(
      "/school/finance/settings?tab=notifications",
    );
    expect(FINANCE_SETTINGS_TAB_ITEMS.map((item) => item.label)).toEqual([
      "General",
      "Documents",
      "Payment details",
      "VAT / Tax",
      "Online payments",
      "Notifications",
    ]);
  });
});
