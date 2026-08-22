"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Context = {
  types: Array<{ id: string; name: string }>;
  gradeSchemes: Array<{ id: string; name: string }>;
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  subjects: Array<{ id: string; name: string }>;
  yearGroups: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string; year_group_id: string }>;
  reportingPeriods: Array<{ id: string; name: string }>;
};

export default function NewAssessmentPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Context>("/api/v1/assessments/context")
      .then(setCtx)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const classIds = form.getAll("classIds").map(String).filter(Boolean);
    try {
      const created = await api<{ assessment: { id: string } }>("/api/v1/assessments", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          academicYearId: String(form.get("academicYearId") || "") || undefined,
          reportingPeriodId: String(form.get("reportingPeriodId") || "") || null,
          subjectId: String(form.get("subjectId") || ""),
          yearGroupId: String(form.get("yearGroupId") || ""),
          assessmentTypeId: String(form.get("assessmentTypeId") || ""),
          assessmentDate: String(form.get("assessmentDate") || ""),
          dueOn: String(form.get("dueOn") || "") || null,
          maximumMarks: form.get("maximumMarks") ? Number(form.get("maximumMarks")) : null,
          weighting: form.get("weighting") ? Number(form.get("weighting")) : null,
          gradeSchemeId: String(form.get("gradeSchemeId") || "") || null,
          internalNotes: String(form.get("internalNotes") || "") || null,
          classIds,
        }),
      });
      router.push(`/school/assessment/assessments/${created.assessment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create assessment");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!ctx) return <p>Loading…</p>;

  const currentYear = ctx.academicYears.find((row) => row.is_current) ?? ctx.academicYears[0];

  return (
    <>
      <h1>Create assessment</h1>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>Title<input name="title" required /></label>
        <label>
          Academic year
          <select name="academicYearId" defaultValue={currentYear?.id ?? ""}>
            {ctx.academicYears.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Reporting period
          <select name="reportingPeriodId" defaultValue="">
            <option value="">None</option>
            {ctx.reportingPeriods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Subject
          <select name="subjectId" required>
            <option value="">Select</option>
            {ctx.subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select name="yearGroupId" required>
            <option value="">Select</option>
            {ctx.yearGroups.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Type
          <select name="assessmentTypeId" required>
            {ctx.types.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>Date<input name="assessmentDate" type="date" required /></label>
        <label>Due / completion<input name="dueOn" type="date" /></label>
        <label>Maximum marks<input name="maximumMarks" type="number" min="1" step="0.5" /></label>
        <label>Weighting<input name="weighting" type="number" min="0" max="100" step="0.1" /></label>
        <label>
          Grade scheme
          <select name="gradeSchemeId" defaultValue="">
            <option value="">None / scores only</option>
            {ctx.gradeSchemes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Classes
          <select name="classIds" multiple size={6}>
            {ctx.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>Internal notes<textarea name="internalNotes" rows={3} /></label>
        <div><button type="submit">Create draft</button></div>
      </form>
    </>
  );
}
