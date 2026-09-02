"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Payment = {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceReference: string;
  billingAccountName: string;
  amountMinor: number;
  currency: string;
  method: string;
  receivedOn: string;
  status: string;
};

export default function FinancePaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    api<{ payments: Payment[] }>("/api/v1/finance/payments")
      .then((body) => setPayments(body.payments))
      .catch((err: Error) => setError(userFacingError(err, "Could not load payments.")));
  }, []);

  if (error) return <PageError title="Payments unavailable" description={error} />;
  if (!payments) return <LoadingState label="Loading payments…" />;
  const filtered = payments.filter((item) => {
    const matchesQ = `${item.reference} ${item.invoiceReference} ${item.billingAccountName}`
      .toLowerCase()
      .includes(q.trim().toLowerCase());
    return matchesQ && (!status || item.status === status);
  });

  return (
    <>
      <PageHeader title="Payments" description="Invoice payments recorded for this school, including Stripe and school-recorded amounts." />
      <FinanceNav />
      <p className="toolbar">
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search payments" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="reversed">Reversed</option>
        </select>
      </p>
      {filtered.length === 0 ? (
        <EmptyState title="No payments" description="Payments appear after a parent pays or a school records a receipt." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Payment</th>
              <th>Invoice</th>
              <th>Family</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Status</th>
            </>
          }
        >
          {filtered.map((payment) => (
            <tr key={payment.id}>
              <td>{payment.reference}</td>
              <td>
                <Link href={`/school/finance/invoices/${payment.invoiceId}`}>{payment.invoiceReference}</Link>
              </td>
              <td>{payment.billingAccountName}</td>
              <td>{formatMinor(payment.amountMinor, payment.currency)}</td>
              <td>{payment.method}</td>
              <td>
                <StatusBadge status={payment.status} /> {payment.receivedOn}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
