"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
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
      .catch((err: Error) => setError(userFacingError(err, "Could not load finance overview.")));
  }, []);

  if (error) return <PageError title="Finance unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading finance…" />;

  return (
    <>
      <PageHeader
        title="Finance / Payments"
        description="Lightweight school payments overview. Totals are grouped by currency and never mixed."
        actions={
          <>
            <Link className="button secondary" href="/school/finance/charges/bulk">
              Bulk charges
            </Link>
            <Link className="button" href="/school/finance/charges/new">
              Create charge
            </Link>
          </>
        }
      />
      {data.currencies.length === 0 ? (
        <EmptyState
          title="No charges yet"
          description="Create a charge when a trip, club, or school fee needs collecting."
          action={<Link href="/school/finance/charges/new">Create charge</Link>}
        />
      ) : (
        <div className="stat-grid">
          {data.currencies.map((row) => (
            <StatCard
              key={row.currency}
              label={`${row.currency} outstanding`}
              value={formatMinor(row.outstandingMinor, row.currency)}
              href="/school/finance/outstanding"
              hint={`Paid this month ${formatMinor(row.paidThisPeriodMinor, row.currency)} · Overdue ${row.overdueCount} · Refunds ${row.refundCount}`}
            />
          ))}
        </div>
      )}
      <p className="toolbar">
        <Link href="/school/finance/charges">Charges</Link>
        <Link href="/school/finance/outstanding">Outstanding</Link>
        <Link href="/school/finance/transactions">Transactions</Link>
        <Link href="/school/finance/refunds">Refunds</Link>
      </p>
    </>
  );
}
