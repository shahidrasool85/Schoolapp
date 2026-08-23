"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Concern = {
  id: string;
  studentLegalName: string | null;
  aroseAt: string;
  categoryName: string | null;
  status: string;
};

export default function SafeguardingListPage() {
  const [items, setItems] = useState<Concern[]>([]);
  const [error, setError] = useState("");

  function load(status = "") {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    api<{ concerns: Concern[] }>(`/api/v1/safeguarding/concerns${query}`)
      .then((body) => setItems(body.concerns))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  function onFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    load(String(form.get("status") ?? ""));
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Safeguarding</h1>
        <Link href="/school/safeguarding/new">Record concern</Link>
      </div>
      <p className="muted">Restricted staff area. This is not part of ordinary behaviour records.</p>
      <form className="toolbar" onSubmit={onFilter}>
        <select name="status">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="monitoring">Monitoring</option>
          <option value="referred_internal">Referred internally</option>
          <option value="closed">Closed</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      {items.length === 0 ? <p>No safeguarding concerns yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <Link className="card" href={`/school/safeguarding/${item.id}`} key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · {item.status}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
