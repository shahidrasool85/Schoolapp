"use client";

import Link from "next/link";
import { FINANCE_ADVANCED_NAV_LINKS } from "@schoolapp/domain";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { FinanceNav } from "../finance-nav";

export default function FinanceAdvancedPage() {
  return (
    <>
      <PageHeader
        title="Advanced finance"
        description="Fee schedules, billing runs, family accounts and other administration. Everyday pupil balances are on Student fees."
      />
      <FinanceNav />
      <SectionCard title="Billing administration">
        <ul className="plain-list">
          {FINANCE_ADVANCED_NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}
