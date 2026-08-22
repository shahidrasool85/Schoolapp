"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Assessment = {
  id: string;
  title: string;
  status: string;
  assessmentDate: string;
  dueOn: string | null;
  subjectName: string | null;
  yearGroupName: string | null;
  assessmentTypeName: string | null;
  maximumMarks: number | null;
  internalNotes: string | null;
  classes: Array<{ classId: string; className: string }>;
};

type Summary = {
  numberAssessed: number;
  missingResults: number;
  averagePercentage: number | null;
  gradeDistribution: Array<{ label: string; count: number }>;
  reviewedCount: number;
  unreviewedCount: number;
};

export default function AssessmentDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Assessment | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const [detail, sum] = await Promise.all([
      api<{ assessment: Assessment }>(`/api/v1/assessments/${params.id}`),
      api<{ summary: Summary }>(`/api/v1/assessments/${params.id}/summary`).catch(() => null),
    ]);
    setData(detail.assessment);
    setSummary(sum?.summary ?? null);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function action(path: string) {
    try {
      await api(`/api/v1/assessments/${params.id}/${path}`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <div className="toolbar">
        <h1>{data.title}</h1>
        <Link href={`/school/assessment/assessments/${data.id}/results`}>Enter results</Link>
      </div>
      <p className="muted">
        {data.assessmentTypeName} · {data.subjectName} · {data.yearGroupName} · {data.assessmentDate} · {data.status}
      </p>
      <p>Classes: {data.classes.map((row) => row.className).join(", ") || "Year group"}</p>
      {data.internalNotes ? <p className="muted">Internal notes: {data.internalNotes}</p> : null}
      {summary ? (
        <div className="cards">
          <div className="card"><span>Assessed</span><strong>{summary.numberAssessed}</strong></div>
          <div className="card"><span>Missing</span><strong>{summary.missingResults}</strong></div>
          <div className="card"><span>Average %</span><strong>{summary.averagePercentage ?? "—"}</strong></div>
          <div className="card"><span>Unreviewed</span><strong>{summary.unreviewedCount}</strong></div>
        </div>
      ) : null}
      {summary && summary.gradeDistribution.length > 0 ? (
        <p className="muted">
          Grades: {summary.gradeDistribution.map((row) => `${row.label} ${row.count}`).join(" · ")}
        </p>
      ) : null}
      <div className="toolbar">
        {data.status === "draft" ? <button type="button" onClick={() => action("open")}>Open for entry</button> : null}
        {data.status === "open" ? <button type="button" onClick={() => action("complete")}>Mark completed</button> : null}
        {data.status === "completed" ? <button type="button" onClick={() => action("review")}>Mark reviewed</button> : null}
        {data.status === "completed" || data.status === "reviewed" ? (
          <button type="button" onClick={() => action("publish")}>Publish</button>
        ) : null}
        {data.status !== "archived" ? <button type="button" className="secondary" onClick={() => action("archive")}>Archive</button> : null}
      </div>
    </>
  );
}
