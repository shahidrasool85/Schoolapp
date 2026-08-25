"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { formatMinor } from "../../../../lib/money";

type Charge = {
  id: string;
  reference: string;
  title: string;
  studentLegalName: string | null;
  categoryName: string | null;
  status: string;
  amountDueMinor: number;
  outstandingMinor?: number;
  currency: string;
  dueAt: string | null;
};

export default function FinanceChargesPage() {
  const [items, setItems] = useState<Charge[]>([]);
  const [error, setError] = useState("");

  async function load(query = "") {
    const body = await api<{ charges: Charge[] }>(`/api/v1/finance/charges${query}`);
    setItems(body.charges);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = String(form.get("status") || "");
    await load(status ? `?status=${encodeURIComponent(status)}` : "");
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Charges</h1>
        <Link href="/school/finance/charges/new">Create charge</Link>
        <Link href="/school/finance/charges/bulk">Bulk charges</Link>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            downloadAuthenticated("/api/v1/finance/charges/export", "school-charges.csv").catch((err: Error) =>
              setError(err.message),
            )
          }
        >
          Export CSV
        </button>
      </div>
      <form className="toolbar" onSubmit={filter}>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="waived">Waived</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      {items.length === 0 ? <p>No charges.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/finance/charges/${item.id}`} key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {item.reference} · {item.studentLegalName} · {item.categoryName} · {item.status}
            </span>
            <span>
              {formatMinor(item.amountDueMinor, item.currency)}
              {item.outstandingMinor != null ? ` · outstanding ${formatMinor(item.outstandingMinor, item.currency)}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
