"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Alert, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/dates";
import { userFacingError } from "../../../../lib/errors";

type Assessment = {
  id: string;
  applicationId: string;
  applicationReference: string | null;
  pupilLegalName: string | null;
  assessmentType: string;
  status: string;
  scheduledAt: string | null;
  recommendation: string | null;
};

export default function AssessmentsPage() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [status, setStatus] = useState("scheduled");
  const [error, setError] = useState("");

  async function load(nextStatus = status) {
    const qs = nextStatus ? `?status=${encodeURIComponent(nextStatus)}` : "";
    const body = await api<{ assessments: Assessment[] }>(`/api/v1/admissions/assessments${qs}`);
    setItems(body.assessments);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("status") ?? "scheduled";
    setStatus(initial);
    load(initial).catch((err: unknown) => setError(userFacingError(err, "Could not load assessments.")));
  }, []);

  async function complete(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const payload = new FormData(form);
    try {
      await api(`/api/v1/admissions/assessments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          outcome: payload.get("outcome") || undefined,
          recommendation: payload.get("recommendation") || undefined,
        }),
      });
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not complete that assessment."));
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Assessments / interviews</h1>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            load(e.target.value).catch((err: unknown) => setError(userFacingError(err, "Could not load assessments.")));
          }}
        >
          <option value="">All</option>
          {["scheduled", "completed", "cancelled", "no_show"].map((s) => (
            <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
          ))}
        </select>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <table>
        <thead>
          <tr>
            <th>Application</th>
            <th>Pupil</th>
            <th>Type</th>
            <th>When</th>
            <th>Status</th>
            <th>Complete</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/school/admissions/applications/${item.applicationId}`}>
                  {item.applicationReference}
                </Link>
              </td>
              <td>{item.pupilLegalName}</td>
              <td>{item.assessmentType.replaceAll("_", " ")}</td>
              <td>{formatDateTime(item.scheduledAt) || "Not scheduled"}</td>
              <td><StatusBadge status={item.status} /></td>
              <td>
                {item.status === "scheduled" ? (
                  <form className="form-grid" onSubmit={(e) => complete(e, item.id)}>
                    <input name="outcome" placeholder="Outcome" />
                    <select name="recommendation">
                      <option value="">Recommendation</option>
                      {["offer", "waitlist", "reject", "further_assessment", "defer", "undecided"].map((s) => (
                        <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                      ))}
                    </select>
                    <button type="submit">Complete</button>
                  </form>
                ) : (item.recommendation ?? "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
