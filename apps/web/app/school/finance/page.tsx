"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { formatMinor } from "../../../lib/money";

type Overview = {
  currencies: Array<{
    currency: string;
    outstandingMinor: number;
    paidThisPeriodMinor: number;
    overdueCount: number;
    refundCount: number;
    refundMinor: number;
  }>;
};

export default function FinanceOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/v1/finance/overview")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Finance / Payments</h1>
        <div className="page-header-actions">
          <Link className="button" href="/school/finance/charges/new">Create charge</Link>
          <Link className="button secondary" href="/school/finance/charges/bulk">Bulk charges</Link>
        </div>
      </div>
      <p className="muted">Lightweight school payments overview. Totals are grouped by currency and never mixed.</p>
      {data.currencies.length === 0 ? <p className="empty-state">No charges yet.</p> : null}
      <div className="stat-grid">
        {data.currencies.map((row) => (
          <div className="stat-card" key={row.currency}>
            <span>{row.currency} outstanding</span>
            <strong>{formatMinor(row.outstandingMinor, row.currency)}</strong>
            <p className="muted">Paid this month {formatMinor(row.paidThisPeriodMinor, row.currency)}</p>
            <p className="muted">Overdue {row.overdueCount} · Refunds {row.refundCount}</p>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <Link href="/school/finance/charges">Charges</Link>
        <Link href="/school/finance/outstanding">Outstanding</Link>
        <Link href="/school/finance/transactions">Transactions</Link>
        <Link href="/school/finance/refunds">Refunds</Link>
      </div>
    </>
  );
}
