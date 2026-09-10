"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FINANCE_ADVANCED_NAV_LINKS,
  FINANCE_SETTINGS_ADMIN_PERMISSIONS,
  FINANCE_ADVANCED_PATH,
  FINANCE_REPORTS_PATH,
  STUDENT_FEES_PATH,
  hasAnyPermission,
  isFinanceAdvancedPath,
} from "@schoolapp/domain";
import { Tabs } from "../../../components/ui";
import { usePermissions } from "../../../lib/use-permissions";

const PRIMARY: Array<{ href: string; label: string; exact?: boolean; settingsOnly?: boolean }> = [
  { href: "/school/finance", label: "Overview", exact: true },
  { href: STUDENT_FEES_PATH, label: "Student fees" },
  { href: "/school/finance/invoices", label: "Invoices" },
  { href: "/school/finance/payments", label: "Payments" },
  { href: "/school/finance/receipts", label: "Receipts" },
  { href: FINANCE_REPORTS_PATH, label: "Reports" },
  { href: "/school/finance/settings", label: "Settings", settingsOnly: true },
  { href: FINANCE_ADVANCED_PATH, label: "Advanced" },
];

export function FinanceNav() {
  const pathname = usePathname();
  const permissions = usePermissions();
  const canOpenSettings = hasAnyPermission(permissions.permissions ?? [], FINANCE_SETTINGS_ADMIN_PERMISSIONS);
  const advancedActive = pathname === FINANCE_ADVANCED_PATH || isFinanceAdvancedPath(pathname);
  return (
    <>
      <Tabs>
        {PRIMARY.filter((link) => !link.settingsOnly || canOpenSettings).map((link) => {
          const active =
            link.href === FINANCE_ADVANCED_PATH
              ? advancedActive
              : link.href === FINANCE_REPORTS_PATH
                ? pathname === FINANCE_REPORTS_PATH ||
                  pathname.startsWith("/school/finance/statements") ||
                  pathname.startsWith("/school/finance/arrears")
                : link.exact
                  ? pathname === link.href
                  : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
              {link.label}
            </Link>
          );
        })}
      </Tabs>
      {advancedActive ? (
        <Tabs label="Advanced finance">
          <Link href={FINANCE_ADVANCED_PATH} className={pathname === FINANCE_ADVANCED_PATH ? "active" : undefined}>
            Advanced home
          </Link>
          {FINANCE_ADVANCED_NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </Tabs>
      ) : null}
    </>
  );
}
