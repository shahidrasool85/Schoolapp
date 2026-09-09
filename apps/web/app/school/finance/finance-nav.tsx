"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FINANCE_SETTINGS_ADMIN_PERMISSIONS, hasAnyPermission } from "@schoolapp/domain";
import { Tabs } from "../../../components/ui";
import { usePermissions } from "../../../lib/use-permissions";

const LINKS: Array<{ href: string; label: string; exact?: boolean; settingsOnly?: boolean }> = [
  { href: "/school/finance", label: "Overview", exact: true },
  { href: "/school/finance/fee-schedules", label: "Fee schedules" },
  { href: "/school/finance/invoices", label: "Invoices / Charges" },
  { href: "/school/finance/payments", label: "Payments" },
  { href: "/school/finance/accounts", label: "Families / Accounts" },
  { href: "/school/finance/receipts", label: "Receipts" },
  { href: "/school/finance/statements", label: "Statements" },
  { href: "/school/finance/billing-runs", label: "Billing runs" },
  { href: "/school/finance/discounts", label: "Discounts" },
  { href: "/school/finance/arrears", label: "Arrears" },
  { href: "/school/finance/charges", label: "Other payments" },
  { href: "/school/finance/settings", label: "Settings", settingsOnly: true },
];

export function FinanceNav() {
  const pathname = usePathname();
  const permissions = usePermissions();
  const canOpenSettings = hasAnyPermission(permissions.permissions ?? [], FINANCE_SETTINGS_ADMIN_PERMISSIONS);
  return (
    <Tabs>
      {LINKS.filter((link) => !link.settingsOnly || canOpenSettings).map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </Tabs>
  );
}
