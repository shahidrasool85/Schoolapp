"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { EmptyState, FilterBar, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Concern = {
  id: string;
  studentLegalName: string | null;
  aroseAt: string;
  categoryName: string | null;
  status: string;
};

export default function SafeguardingListPage() {
  const [items, setItems] = useState<Concern[] | null>(null);
  const [error, setError] = useState("");

  function load(status = "") {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    api<{ concerns: Concern[] }>(`/api/v1/safeguarding/concerns${query}`)
      .then((body) => setItems(body.concerns))
      .catch((err: Error) => setError(userFacingError(err, "Could not load safeguarding records.")));
  }

  useEffect(() => {
    load();
  }, []);

  function onFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    load(String(form.get("status") ?? ""));
  }

  if (error) return <PageError title="Safeguarding unavailable" description={error} />;

  return (
    <>
      <PageHeader
        title="Safeguarding"
        description="Restricted staff area. This is not part of ordinary behaviour records and is not shown on the school dashboard."
        actions={
          <Link className="button" href="/school/safeguarding/new">
            Record concern
          </Link>
        }
      />
      <p>
        <span className="confidential-flag">Confidential</span>
      </p>
      <FilterBar onSubmit={onFilter} actions={<button type="submit">Filter</button>}>
        <label htmlFor="safeguarding-status">
          Status
          <select id="safeguarding-status" name="status">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="monitoring">Monitoring</option>
            <option value="referred_internal">Referred internally</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </FilterBar>
      {items && items.length === 0 ? (
        <EmptyState title="No safeguarding concerns yet" description="Recorded concerns will appear here for authorised staff only." />
      ) : null}
      <div className="cards">
        {(items ?? []).map((item) => (
          <Link className="card" href={`/school/safeguarding/${item.id}`} key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · <StatusBadge status={item.status} />
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
