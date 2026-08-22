"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Report = {
  id: string;
  studentLegalName: string | null;
  reportingPeriodName: string | null;
  status: string;
  generalComment: string | null;
};

type Section = {
  id: string;
  subjectId: string;
  subjectName: string | null;
  attainmentSummary: string | null;
  progressJudgement: string | null;
  teacherComment: string | null;
  targetNextSteps: string | null;
};

type Context = { subjects: Array<{ id: string; name: string }> };

export default function ReportEditorPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const [detail, context] = await Promise.all([
      api<{ report: Report; sections: Section[] }>(`/api/v1/reports/${params.id}`),
      api<Context>("/api/v1/assessments/context"),
    ]);
    setReport(detail.report);
    setSections(detail.sections);
    setCtx(context);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function saveComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/reports/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify({ generalComment: String(form.get("generalComment") || "") }),
    });
    await load();
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/reports/${params.id}/sections`, {
      method: "POST",
      body: JSON.stringify({
        subjectId: String(form.get("subjectId") || ""),
        attainmentSummary: String(form.get("attainmentSummary") || "") || null,
        progressJudgement: String(form.get("progressJudgement") || "") || null,
        teacherComment: String(form.get("teacherComment") || "") || null,
        targetNextSteps: String(form.get("targetNextSteps") || "") || null,
      }),
    });
    await load();
  }

  async function action(path: string) {
    try {
      await api(`/api/v1/reports/${params.id}/${path}`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p>Loading…</p>;

  return (
    <>
      <h1>Report — {report.studentLegalName}</h1>
      <p className="muted">{report.reportingPeriodName} · {report.status}</p>
      <form onSubmit={saveComment}>
        <label>
          General comment
          <textarea name="generalComment" rows={4} defaultValue={report.generalComment ?? ""} />
        </label>
        <p><button type="submit">Save comment</button></p>
      </form>
      <h2>Subject sections</h2>
      {sections.map((section) => (
        <div key={section.id} className="card" style={{ marginBottom: 12 }}>
          <strong>{section.subjectName}</strong>
          <p>{section.attainmentSummary}</p>
          <p className="muted">{section.progressJudgement}</p>
          <p>{section.teacherComment}</p>
          {section.targetNextSteps ? <p>Next steps: {section.targetNextSteps}</p> : null}
        </div>
      ))}
      {report.status === "draft" || report.status === "submitted_for_review" ? (
        <form className="form-grid" onSubmit={addSection}>
          <label>
            Subject
            <select name="subjectId" required>
              {(ctx?.subjects ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>Attainment<textarea name="attainmentSummary" rows={2} /></label>
          <label>Progress / judgement<textarea name="progressJudgement" rows={2} /></label>
          <label>Teacher comment<textarea name="teacherComment" rows={3} /></label>
          <label>Target / next steps<textarea name="targetNextSteps" rows={2} /></label>
          <div><button type="submit">Add section</button></div>
        </form>
      ) : null}
      <div className="toolbar">
        {report.status === "draft" ? <button type="button" onClick={() => action("submit")}>Submit for review</button> : null}
        {report.status === "submitted_for_review" ? <button type="button" onClick={() => action("approve")}>Approve</button> : null}
        {report.status === "draft" || report.status === "approved" ? (
          <button type="button" onClick={() => action("publish")}>Publish</button>
        ) : null}
        {report.status === "published" ? <button type="button" className="secondary" onClick={() => action("archive")}>Archive</button> : null}
      </div>
    </>
  );
}
