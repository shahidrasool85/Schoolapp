"use client";

import Link from "next/link";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { FinanceNav } from "../finance-nav";

export default function FinanceReportsPage() {
  return (
    <>
      <PageHeader
        title="Finance reports"
        description="Statements and arrears for family accounts. Student-level balances stay on Student fees."
      />
      <FinanceNav />
      <div className="card-grid">
        <SectionCard title="Family statements">
          <p>Download or view statements for a family account and period.</p>
          <p>
            <Link href="/school/finance/statements">Open statements</Link>
          </p>
        </SectionCard>
        <SectionCard title="Arrears">
          <p>See which family accounts have overdue invoices.</p>
          <p>
            <Link href="/school/finance/arrears">Open arrears</Link>
          </p>
        </SectionCard>
      </div>
    </>
  );
}
