"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Period = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
  academicYearName: string | null;
};

type Context = {
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
};

export default function ReportingPeriodsPage() {
  const [items, setItems] = useState<Period[]>([]);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const [list, context] = await Promise.all([
      api<{ reportingPeriods: Period[] }>("/api/v1/assessments/reporting-periods"),
      api<Context>("/api/v1/assessments/context"),
    ]);
    setItems(list.reportingPeriods);
    setCtx(context);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/assessments/reporting-periods", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: String(form.get("academicYearId") || ""),
          name: String(form.get("name") || ""),
          startsOn: String(form.get("startsOn") || ""),
          endsOn: String(form.get("endsOn") || ""),
          status: String(form.get("status") || "planned"),
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create period");
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Reporting periods</h1>
      <p className="muted">Schools can define any number of periods — terms, half terms, or end of year.</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Academic year
          <select name="academicYearId">
            {(ctx?.academicYears ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>Name<input name="name" required placeholder="Autumn Term" /></label>
        <label>Start<input name="startsOn" type="date" required /></label>
        <label>End<input name="endsOn" type="date" required /></label>
        <label>
          Status
          <select name="status" defaultValue="open">
            <option value="planned">Planned</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="published">Published</option>
          </select>
        </label>
        <div><button type="submit">Add period</button></div>
      </form>
      <table>
        <thead>
          <tr><th>Name</th><th>Dates</th><th>Status</th></tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td>{row.name}<div className="muted">{row.academicYearName}</div></td>
              <td>{row.startsOn} – {row.endsOn}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
