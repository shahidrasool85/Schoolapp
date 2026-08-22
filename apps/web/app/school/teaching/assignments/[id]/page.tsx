"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Detail = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    dueAt: string | null;
    workTypeName: string | null;
    subjectName: string | null;
    createdByName: string | null;
    teacherNotes: string | null;
    maximumMarks: number | null;
    submissionRequired: boolean;
    targets: Array<{ id: string; targetType: string; className: string | null; yearGroupName: string | null; studentLegalName: string | null }>;
    resources: Array<{ id: string; title: string; resourceKind: string; url: string | null }>;
    progress: { assigned: number; submitted: number; notSubmitted: number; marked: number; awaitingMarking: number };
    statusHistory: Array<{ previousStatus: string | null; newStatus: string; createdAt: string }>;
  };
};

type SubmissionRow = {
  studentProfileId: string;
  studentLegalName: string;
  submissionId: string | null;
  status: string;
  submittedAt: string | null;
};

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [error, setError] = useState("");
  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const [detail, list] = await Promise.all([
        api<Detail>(`/api/v1/learning/assignments/${params.id}`),
        api<{ submissions: SubmissionRow[] }>(`/api/v1/learning/assignments/${params.id}/submissions`),
      ]);
      if (seq !== loadSeq.current) return;
      setData(detail);
      setSubmissions(list.submissions);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      throw err;
    }
  }

  useEffect(() => {
    setData(null);
    setError("");
    load().catch((err: Error) => setError(err.message));
    return () => {
      loadSeq.current += 1;
    };
  }, [params.id]);

  async function transition(path: "publish" | "close" | "archive") {
    await api(`/api/v1/learning/assignments/${params.id}/${path}`, { method: "POST", body: "{}" });
    await load();
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/learning/assignments/${params.id}/resources`, {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        resourceKind: form.get("resourceKind"),
        url: form.get("url"),
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const a = data.assignment;

  return (
    <>
      <div className="toolbar">
        <h1>{a.title}</h1>
        <button className="secondary" type="button" onClick={() => router.push("/school/teaching/assignments")}>Back</button>
      </div>
      <p className="muted">
        {a.workTypeName} · {a.subjectName ?? "No subject"} · {a.status}
        {a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleString()}` : ""}
      </p>
      <div className="cards">
        <div className="card"><span>Assigned</span><strong>{a.progress.assigned}</strong></div>
        <div className="card"><span>Submitted</span><strong>{a.progress.submitted}</strong></div>
        <div className="card"><span>Not submitted</span><strong>{a.progress.notSubmitted}</strong></div>
        <div className="card"><span>Awaiting marking</span><strong>{a.progress.awaitingMarking}</strong></div>
      </div>
      <div className="toolbar">
        {a.status === "draft" ? <button type="button" onClick={() => transition("publish")}>Publish</button> : null}
        {a.status === "published" ? <button type="button" onClick={() => transition("close")}>Close</button> : null}
        {a.status !== "archived" ? <button className="secondary" type="button" onClick={() => transition("archive")}>Archive</button> : null}
      </div>
      <h2>Instructions</h2>
      <p>{a.description || "No instructions."}</p>
      {a.teacherNotes ? <p className="muted">Teacher notes: {a.teacherNotes}</p> : null}
      <h2>Targets</h2>
      <ul>
        {a.targets.map((target) => (
          <li key={target.id}>
            {target.targetType}: {target.className ?? target.yearGroupName ?? target.studentLegalName}
          </li>
        ))}
      </ul>
      <h2>Resources</h2>
      <ul>
        {a.resources.map((resource) => (
          <li key={resource.id}>
            {resource.title} ({resource.resourceKind})
            {resource.url ? <> — <a href={resource.url}>{resource.url}</a></> : null}
          </li>
        ))}
      </ul>
      <form className="card form-grid" onSubmit={addResource}>
        <label>Resource title<input name="title" required /></label>
        <label>
          Kind
          <select name="resourceKind">
            <option value="url">URL</option>
            <option value="pdf">PDF</option>
            <option value="worksheet">Worksheet</option>
            <option value="video">Video link</option>
            <option value="image">Image</option>
            <option value="document">Document</option>
          </select>
        </label>
        <label>URL<input name="url" required placeholder="https://" /></label>
        <div><button type="submit">Attach link</button></div>
      </form>
      <h2>Pupil submissions</h2>
      <table>
        <thead>
          <tr><th>Pupil</th><th>Status</th><th>Submitted</th><th></th></tr>
        </thead>
        <tbody>
          {submissions.map((row) => (
            <tr key={row.studentProfileId}>
              <td>{row.studentLegalName}</td>
              <td>{row.status}</td>
              <td>{row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "—"}</td>
              <td>
                {row.submissionId ? (
                  <Link href={`/school/teaching/submissions/${row.submissionId}`}>Open</Link>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
