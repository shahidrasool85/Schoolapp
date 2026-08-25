"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatMinor } from "../../../../lib/money";

type Charge = {
  id: string;
  reference: string;
  title: string;
  studentLegalName: string | null;
  outstandingMinor?: number;
  currency: string;
  dueUrgency?: string;
};

export default function OutstandingPage() {
  const [items, setItems] = useState<Charge[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ charges: Charge[] }>("/api/v1/finance/outstanding")
      .then((body) => setItems(body.charges))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Outstanding</h1>
      {items.length === 0 ? <p>No outstanding charges.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/finance/charges/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.reference} · {item.studentLegalName} · {item.dueUrgency ?? "none"}
            </span>
            <span>
              {formatMinor(item.outstandingMinor ?? 0, item.currency)}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
