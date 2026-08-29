"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DataTable, EmptyState, FilterBar, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Item = {
  id: string;
  reference: string;
  billingAccountName: string | null;
  outstandingMinor: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  status: string;
};

export default function ArrearsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  async function load(bucket = "") {
    const body = await api<{ items: Item[] }>(`/api/v1/finance/arrears${bucket ? `?bucket=${bucket}` : ""}`);
    setItems(body.items);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load arrears.")));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(String(new FormData(event.currentTarget).get("bucket") || ""));
  }

  if (error) return <PageError title="Arrears unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading arrears…" />;

  return (
    <>
      <PageHeader title="Arrears" description="Overdue school-fee invoices for this organisation only. Teachers do not see this list." />
      <FinanceNav />
      <FilterBar onSubmit={filter} actions={<button type="submit">Filter</button>}>
        <label>
          Age
          <select name="bucket" defaultValue="">
            <option value="">All outstanding</option>
            <option value="current">Current</option>
            <option value="due_soon">Due soon</option>
            <option value="overdue">Overdue</option>
            <option value="30">30+ days</option>
            <option value="60">60+ days</option>
            <option value="90">90+ days</option>
          </select>
        </label>
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState title="No matching arrears" description="Outstanding invoices in this filter will appear here." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Family</th>
              <th>Invoice</th>
              <th>Due</th>
              <th>Days</th>
              <th>Outstanding</th>
              <th>Status</th>
            </>
          }
        >
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.billingAccountName}</td>
              <td>
                <Link href={`/school/finance/invoices/${item.id}`}>{item.reference}</Link>
              </td>
              <td>{item.dueDate}</td>
              <td>{item.daysOverdue}</td>
              <td>{formatMinor(item.outstandingMinor, item.currency)}</td>
              <td>
                <StatusBadge status={item.status} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
