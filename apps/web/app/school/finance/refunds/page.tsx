"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatMinor } from "../../../../lib/money";

type Refund = {
  id: string;
  reference: string;
  chargeReference: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string;
};

export default function RefundsPage() {
  const [items, setItems] = useState<Refund[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ refunds: Refund[] }>("/api/v1/finance/refunds")
      .then((body) => setItems(body.refunds))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Refunds</h1>
      {items.length === 0 ? <p>No refunds.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.reference}</strong>
            <span className="muted">
              {item.chargeReference} · {item.status}
            </span>
            <span>
              {formatMinor(item.amountMinor, item.currency)}
            </span>
            <p>{item.reason}</p>
          </div>
        ))}
      </div>
    </>
  );
}
