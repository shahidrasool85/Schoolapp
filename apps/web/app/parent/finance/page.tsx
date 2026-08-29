"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import { formatMinor } from "../../../lib/money";

type Finance = {
  tuitionEnabled: boolean;
  canViewInvoices: boolean;
  canViewBalances: boolean;
  currency: string;
  amountDueMinor: number | null;
  outstandingMinor: number | null;
  nextDueDate: string | null;
  invoices: Array<{
    id: string;
    reference: string;
    status: string;
    dueDate: string;
    totalMinor: number | null;
    outstandingMinor: number | null;
    currency: string;
  }>;
  payments: Array<{ id: string; reference: string; amountMinor: number | null; receivedOn: string; invoiceReference: string }>;
};

export default function ParentFinancePage() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Finance>("/api/v1/parent/finance")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load your family account.")));
  }, []);

  if (error) return <PageError title="Finance unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading your account…" />;

  return (
    <>
      <PageHeader
        title="Family finance"
        description="Only accounts for children you are authorised to access. Other families are never shown."
      />
      {!data.tuitionEnabled ? (
        <EmptyState
          title="No school-fee account"
          description="This school is not using tuition billing. Trip and club charges still appear under Payments."
          action={<Link href="/parent/payments">Other payments</Link>}
        />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Amount due"
              value={data.canViewBalances && data.amountDueMinor != null ? formatMinor(data.amountDueMinor, data.currency) : "Hidden"}
            />
            <StatCard label="Next due" value={data.nextDueDate ?? "None"} />
          </div>
          <p className="toolbar">
            <Link href="/parent/finance/statement">Statement</Link>
            <Link href="/parent/payments">Other payments</Link>
          </p>
          <SectionCard title="Invoices">
            {!data.canViewInvoices ? (
              <p className="muted">The school has turned off invoice viewing for parents.</p>
            ) : data.invoices.length === 0 ? (
              <EmptyState title="No invoices" description="When the school issues fees, they will appear here." />
            ) : (
              <ul className="plain-list">
                {data.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/parent/finance/invoices/${invoice.id}`}>{invoice.reference}</Link>{" "}
                    <StatusBadge status={invoice.status} /> due {invoice.dueDate}
                    {data.canViewBalances && invoice.outstandingMinor != null
                      ? ` · ${formatMinor(invoice.outstandingMinor, invoice.currency)}`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Payment history">
            {data.payments.length === 0 ? (
              <p className="muted">No payments have been recorded against your invoices yet.</p>
            ) : (
              <ul className="plain-list">
                {data.payments.map((payment) => (
                  <li key={payment.id}>
                    {payment.receivedOn} · {payment.reference} · {payment.invoiceReference}
                    {data.canViewBalances && payment.amountMinor != null ? ` · ${formatMinor(payment.amountMinor, data.currency)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}
