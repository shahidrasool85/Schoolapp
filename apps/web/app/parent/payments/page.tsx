"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
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
  const [items, setItems] = useState<Charge[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ charges: Charge[] }>("/api/v1/parent/payments")
      .then((body) => setItems(body.charges))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  const outstanding = items.filter((item) => (item.outstandingMinor ?? 0) > 0);
  const paid = items.filter((item) => item.status === "paid" || item.status === "refunded" || item.status === "waived");

  return (
    <>
      <h1>Payments</h1>
      <p className="muted">Charges for your authorised children only. Payment confirmation comes from the school payment provider, not just the return page.</p>
      <h2>Outstanding</h2>
      {outstanding.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing due</h2>
          <p>When the school issues a charge for your child, it will appear here.</p>
        </div>
      ) : null}
      <div className="cards">
        {outstanding.map((item) => (
          <Link className="card" href={`/parent/payments/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.studentLegalName} · {item.categoryName}
              {item.activityTitle ? ` · ${item.activityTitle}` : ""} · {item.status}
            </span>
            <span>
              Outstanding {formatMinor(item.outstandingMinor ?? 0, item.currency)}
            </span>
          </Link>
        ))}
      </div>
      <h2>Paid / receipts</h2>
      {paid.length === 0 ? <p>No completed payments yet.</p> : null}
      <div className="cards">
        {paid.map((item) => (
          <Link className="card" href={`/parent/payments/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.studentLegalName} · {item.status}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
