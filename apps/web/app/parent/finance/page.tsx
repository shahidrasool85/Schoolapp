"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../../components/ui";
import { api, downloadAuthenticated } from "../../../lib/api";
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

type Receipt = {
  id: string;
  reference: string;
  invoiceId: string | null;
  familyName: string | null;
  amountMinor: number | null;
  currency: string | null;
  paymentDate: string | null;
};

export default function ParentFinancePage() {
  const [data, setData] = useState<Finance | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Finance>("/api/v1/parent/finance")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load your family account.")));
    api<{ receipts: Receipt[] }>("/api/v1/parent/finance/receipts")
      .then((body) => setReceipts(body.receipts))
      .catch(() => setReceipts([]));
  }, []);

  if (error) return <PageError title="Finance unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading your account…" />;

  return (
    <>
      <PageHeader
        title="Fees & Payments"
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
              label="Outstanding"
              value={
                data.canViewBalances && data.outstandingMinor != null
                  ? formatMinor(data.outstandingMinor, data.currency)
                  : data.canViewBalances && data.amountDueMinor != null
                    ? formatMinor(data.amountDueMinor, data.currency)
                    : "Hidden"
              }
            />
            <StatCard label="Next due" value={data.nextDueDate ?? "None"} />
          </div>
          <p className="toolbar">
            <Link href="/parent/finance/statement">Statement & documents</Link>
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
                    {data.canViewBalances && (invoice.outstandingMinor ?? 0) > 0 ? " · Pay now" : ""}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Payments">
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
          <SectionCard title="Receipts">
            {receipts.length === 0 ? (
              <p className="muted">Receipts appear after a successful payment is recorded.</p>
            ) : (
              <ul className="plain-list">
                {receipts.map((receipt) => (
                  <li key={receipt.id}>
                    {receipt.paymentDate ?? ""} · {receipt.reference}
                    {receipt.amountMinor != null && receipt.currency
                      ? ` · ${formatMinor(receipt.amountMinor, receipt.currency)}`
                      : ""}{" "}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        downloadAuthenticated(
                          `/api/v1/parent/finance/receipts/${receipt.id}/pdf`,
                          `${receipt.reference}.pdf`,
                        ).catch((err: Error) => setError(userFacingError(err, "Could not download that receipt.")))
                      }
                    >
                      Download
                    </button>
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
