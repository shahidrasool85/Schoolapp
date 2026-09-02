"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LoadingState, PageHeader, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { formatMinor } from "../../../../../lib/money";

type Invoice = {
  invoice: {
    reference: string;
    status: string;
    outstandingMinor: number;
    paidMinor: number;
    currency: string;
  };
};

function SuccessInner() {
  const search = useSearchParams();
  const invoiceId = search.get("invoiceId");
  const [data, setData] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    api<Invoice>(`/api/v1/parent/finance/invoices/${invoiceId}`)
      .then(setData)
      .catch(() => setData(null));
  }, [invoiceId]);

  const paid = data ? data.invoice.outstandingMinor <= 0 : false;

  return (
    <>
      <PageHeader
        title={paid ? "Payment received" : "Payment submitted"}
        description="The school records a payment only after the payment provider confirms it. This return page is not used as proof of payment."
        breadcrumbs={[{ href: "/parent/finance", label: "Finance" }, { label: "Payment" }]}
      />
      {invoiceId && !data ? <LoadingState label="Checking invoice status…" /> : null}
      {data ? (
        <p>
          Invoice {data.invoice.reference} <StatusBadge status={data.invoice.status} /> · Paid{" "}
          {formatMinor(data.invoice.paidMinor, data.invoice.currency)} · Outstanding{" "}
          {formatMinor(data.invoice.outstandingMinor, data.invoice.currency)}
        </p>
      ) : null}
      {!paid ? (
        <p className="muted">
          If you have just paid, refresh this page in a moment. If checkout was cancelled, the invoice remains unpaid.
        </p>
      ) : (
        <p>A receipt is available from your finance page.</p>
      )}
      <p className="toolbar">
        {invoiceId ? <Link href={`/parent/finance/invoices/${invoiceId}`}>Open invoice</Link> : null}
        <Link href="/parent/finance">Fees & Payments</Link>
      </p>
    </>
  );
}

export default function ParentCheckoutSuccessPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <SuccessInner />
    </Suspense>
  );
}
