"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DataTable, EmptyState, FilterBar, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Invoice = {
  id: string;
  reference: string;
  billingAccountName: string | null;
  status: string;
  dueDate: string;
  totalMinor: number;
  outstandingMinor: number;
  currency: string;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");

  async function load(query = "") {
    const body = await api<{ invoices: Invoice[] }>(`/api/v1/finance/invoices${query}`);
    setInvoices(body.invoices);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load invoices.")));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const status = String(new FormData(event.currentTarget).get("status") || "");
    await load(status ? `?status=${encodeURIComponent(status)}` : "");
  }

  if (error) return <PageError title="Invoices unavailable" description={error} />;
  if (!invoices) return <LoadingState label="Loading invoices…" />;

  return (
    <>
      <PageHeader title="Invoices" description="Issued invoices are snapshots. Corrections use credits or a void, not silent edits." />
      <FinanceNav />
      <FilterBar onSubmit={filter} actions={<button type="submit">Filter</button>}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option value="issued">Issued</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="void">Void</option>
          </select>
        </label>
      </FilterBar>
      {invoices.length === 0 ? (
        <EmptyState title="No invoices" description="Confirm a billing run to issue school-fee invoices." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Reference</th>
              <th>Family</th>
              <th>Due</th>
              <th>Total</th>
              <th>Outstanding</th>
              <th>Status</th>
            </>
          }
        >
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                <Link href={`/school/finance/invoices/${invoice.id}`}>{invoice.reference}</Link>
              </td>
              <td>{invoice.billingAccountName}</td>
              <td>{invoice.dueDate}</td>
              <td>{formatMinor(invoice.totalMinor, invoice.currency)}</td>
              <td>{formatMinor(invoice.outstandingMinor, invoice.currency)}</td>
              <td>
                <StatusBadge status={invoice.status} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
