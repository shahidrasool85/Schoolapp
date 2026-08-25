"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import { formatMinor } from "../../../lib/money";

type Charge = {
  id: string;
  title: string;
  studentLegalName: string | null;
  categoryName: string | null;
  status: string;
  amountDueMinor: number;
  outstandingMinor?: number;
  netPaidMinor?: number;
  currency: string;
  dueAt: string | null;
  payable?: boolean;
  activityTitle: string | null;
};

export default function ParentPaymentsPage() {
  const [items, setItems] = useState<Charge[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ charges: Charge[] }>("/api/v1/parent/payments")
      .then((body) => setItems(body.charges))
      .catch((err: Error) => setError(userFacingError(err, "Could not load payments.")));
  }, []);

  if (error) return <PageError title="Payments unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading payments…" />;

  const outstanding = items.filter((item) => (item.outstandingMinor ?? 0) > 0);
  const paid = items.filter((item) => item.status === "paid" || item.status === "refunded" || item.status === "waived");

  return (
    <>
      <PageHeader
        title="Payments"
        description="Charges for your authorised children only. Payment confirmation comes from the school payment provider, not just the return page."
      />
      <h2>Outstanding</h2>
      {outstanding.length === 0 ? (
        <EmptyState title="Nothing due" description="When the school issues a charge for your child, it will appear here." />
      ) : (
        <div className="cards">
          {outstanding.map((item) => (
            <Link className="card" href={`/parent/payments/${item.id}`} key={item.id}>
              <strong>{item.title}</strong>
              <span className="muted">
                {item.studentLegalName} · {item.categoryName}
                {item.activityTitle ? ` · ${item.activityTitle}` : ""}
                {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString("en-GB")}` : ""}
              </span>
              <span>
                Outstanding {formatMinor(item.outstandingMinor ?? 0, item.currency)} · <StatusBadge status={item.status} />
              </span>
              {item.payable ? <span className="muted">Pay</span> : null}
            </Link>
          ))}
        </div>
      )}
      <h2>Paid / receipts</h2>
      {paid.length === 0 ? (
        <EmptyState title="No completed payments yet" description="Receipts appear here after a charge is paid, refunded, or waived." />
      ) : (
        <div className="cards">
          {paid.map((item) => (
            <Link className="card" href={`/parent/payments/${item.id}`} key={item.id}>
              <strong>{item.title}</strong>
              <span className="muted">
                {item.studentLegalName} · <StatusBadge status={item.status} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
