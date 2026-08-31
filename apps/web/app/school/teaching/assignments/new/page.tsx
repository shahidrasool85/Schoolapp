"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Context = {
  workTypes: Array<{ id: string; key: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  yearGroups: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  canTargetYearGroups: boolean;
};

export default function NewAssignmentPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Context>("/api/v1/learning/context")
      .then(setCtx)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const classIds = form.getAll("classIds").map(String).filter(Boolean);
    const yearGroupId = String(form.get("yearGroupId") || "");
    const dueLocal = String(form.get("dueAt") || "");
    const availableLocal = String(form.get("availableFrom") || "");
    const body = {
      title: form.get("title"),
      description: form.get("description") || null,
      workTypeId: form.get("workTypeId"),
      subjectId: form.get("subjectId") || null,
      academicYearId: form.get("academicYearId") || undefined,
      intendedYearGroupId: form.get("intendedYearGroupId") || null,
      dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
      availableFrom: availableLocal ? new Date(availableLocal).toISOString() : null,
      estimatedDurationMinutes: form.get("estimatedDurationMinutes")
        ? Number(form.get("estimatedDurationMinutes"))
        : null,
      maximumMarks: form.get("maximumMarks") ? Number(form.get("maximumMarks")) : null,
      submissionRequired: form.get("submissionRequired") === "on",
      teacherNotes: form.get("teacherNotes") || null,
      targets: [
        ...classIds.map((classId) => ({ targetType: "class", classId })),
        ...(yearGroupId ? [{ targetType: "year_group", yearGroupId }] : []),
      ],
    };
    const created = await api<{ assignment: { id: string } }>("/api/v1/learning/assignments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    router.push(`/school/teaching/assignments/${created.assignment.id}`);
  }

  if (error) return <p className="error">{error}</p>;
  if (!ctx) return <p>Loading…</p>;

  return (
    <>
      <h1>Create learning work</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Title<input name="title" required /></label>
        <label>
          Work type
          <select name="workTypeId" required>
            {ctx.workTypes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Subject
          <select name="subjectId">
            <option value="">None</option>
            {ctx.subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Academic year
          <select name="academicYearId">
            {ctx.academicYears.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          Intended year group
          <select name="intendedYearGroupId">
            <option value="">None</option>
            {ctx.yearGroups.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <p className="muted span-2">
          Classes and year groups listed here are limited to those you are assigned to teach.
          School administrators can assign work school-wide.
        </p>
        <label>Due date/time<input name="dueAt" type="datetime-local" /></label>
        <label>Available from<input name="availableFrom" type="datetime-local" /></label>
        <label>Estimated minutes<input name="estimatedDurationMinutes" type="number" min={1} /></label>
        <label>Maximum marks<input name="maximumMarks" type="number" min={1} step="0.5" /></label>
        <label style={{ alignItems: "center" }}>
          Submission required
          <input name="submissionRequired" type="checkbox" defaultChecked />
        </label>
        <label className="span-2">
          Instructions
          <textarea name="description" rows={5} />
        </label>
        <label className="span-2">
          Teacher notes (not pupil-visible)
          <textarea name="teacherNotes" rows={3} />
        </label>
        <label className="span-2">
          Target classes
          <select name="classIds" multiple size={Math.min(6, ctx.classes.length || 1)}>
            {ctx.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        {ctx.canTargetYearGroups ? (
          <label>
            Or year group
            <select name="yearGroupId">
              <option value="">None</option>
              {ctx.yearGroups.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        ) : null}
        <div><button type="submit">Save draft</button></div>
      </form>
    </>
  );
}
