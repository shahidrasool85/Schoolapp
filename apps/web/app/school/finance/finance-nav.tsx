"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs } from "../../../components/ui";

const LINKS = [
  { href: "/school/finance", label: "Dashboard", exact: true },
  { href: "/school/finance/fee-schedules", label: "Fee schedules" },
  { href: "/school/finance/billing-runs", label: "Billing runs" },
  { href: "/school/finance/discounts", label: "Discounts" },
  { href: "/school/finance/accounts", label: "Families" },
  { href: "/school/finance/invoices", label: "Invoices" },
  { href: "/school/finance/arrears", label: "Arrears" },
  { href: "/school/finance/charges", label: "Other payments" },
  { href: "/school/finance/settings", label: "Settings" },
];

export function FinanceNav() {
  const pathname = usePathname();
  return (
    <Tabs>
      {LINKS.map((link) => {
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
