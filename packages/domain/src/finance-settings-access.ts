import { hasAnyPermission } from "./ui.js";

/**
 * Bank details, VAT registration, Stripe credentials and other finance settings.
 * Invoice/charge read is not enough — School Admin / bursar only.
 */
export const FINANCE_SETTINGS_ADMIN_PERMISSIONS = [
  "finance.settings.manage",
  "finance.manage",
] as const;

export function canAccessFinanceSettingsAdmin(permissions: readonly string[]): boolean {
  return hasAnyPermission(permissions, FINANCE_SETTINGS_ADMIN_PERMISSIONS);
}
