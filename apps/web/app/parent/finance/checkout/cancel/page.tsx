"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "../../../../../components/ui";

function CancelInner() {
  const search = useSearchParams();
  const invoiceId = search.get("invoiceId");

  return (
    <>
      <PageHeader
        title="Payment cancelled"
        description="No payment was recorded. The invoice is unchanged."
        breadcrumbs={[{ href: "/parent/finance", label: "Finance" }, { label: "Payment cancelled" }]}
      />
      <p className="toolbar">
        {invoiceId ? <Link href={`/parent/finance/invoices/${invoiceId}`}>Return to invoice</Link> : null}
        <Link href="/parent/finance">Fees & Payments</Link>
      </p>
    </>
  );
}

export default function ParentCheckoutCancelPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <CancelInner />
    </Suspense>
  );
}
