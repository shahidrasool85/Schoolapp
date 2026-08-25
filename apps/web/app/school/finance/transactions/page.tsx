"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatMinor } from "../../../../lib/money";

type Tx = {
  id: string;
  reference: string;
  chargeTitle: string | null;
  studentLegalName: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  channel: string;
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Tx[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ transactions: Tx[] }>("/api/v1/finance/transactions")
      .then((body) => setItems(body.transactions))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Transactions</h1>
      {items.length === 0 ? <p>No transactions.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.reference}</strong>
            <span className="muted">
              {item.chargeTitle} · {item.studentLegalName} · {item.channel} · {item.status}
            </span>
            <span>
              {formatMinor(item.amountMinor, item.currency)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
