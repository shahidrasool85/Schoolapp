import { describe, expect, it } from "vitest";
import {
  CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS,
  DEFAULT_EMAIL_SETTINGS_TAB,
  EMAIL_DELIVERY_PATH,
  EMAIL_SETTINGS_TABS,
  emailSettingsTabHref,
  emailTemplateEditorHref,
  isCustomizableEmailTemplateKey,
  parseEmailSettingsTab,
} from "@schoolapp/domain";

describe("email settings tabs", () => {
  it("defaults to Delivery when the tab is missing or invalid", () => {
    expect(DEFAULT_EMAIL_SETTINGS_TAB).toBe("delivery");
    expect(parseEmailSettingsTab(null)).toBe("delivery");
    expect(parseEmailSettingsTab("nope")).toBe("delivery");
    expect(parseEmailSettingsTab("AUTOMATIC")).toBe("automatic");
    expect(EMAIL_SETTINGS_TABS).toEqual(["delivery", "automatic"]);
  });

  it("keeps automatic emails under the existing Email delivery URL", () => {
    expect(EMAIL_DELIVERY_PATH).toBe("/school/settings/email");
    expect(emailSettingsTabHref("delivery")).toBe("/school/settings/email?tab=delivery");
    expect(emailSettingsTabHref("automatic")).toBe("/school/settings/email?tab=automatic");
    expect(emailTemplateEditorHref("admissions_enquiry_received")).toBe(
      "/school/settings/email?tab=automatic&template=admissions_enquiry_received",
    );
    expect(isCustomizableEmailTemplateKey("admissions_application_received")).toBe(true);
    expect(isCustomizableEmailTemplateKey("account_invitation")).toBe(false);
    expect([...CUSTOMIZABLE_EMAIL_TEMPLATE_KEYS]).toEqual([
      "admissions_enquiry_received",
      "admissions_application_received",
    ]);
  });
});
