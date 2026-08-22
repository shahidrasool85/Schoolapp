"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

type Context = {
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  reportingPeriods: Array<{ id: string; name: string; academic_year_id: string }>;
};

type Student = { id: string; legalName: string };

export default function NewReportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Context>("/api/v1/assessments/context"),
      api<{ students: Student[] }>("/api/v1/students"),
    ])
      .then(([context, list]) => {
        setCtx(context);
        setStudents(list.students);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api<{ report: { id: string } }>("/api/v1/reports", {
        method: "POST",
        body: JSON.stringify({
          studentProfileId: String(form.get("studentProfileId") || ""),
          academicYearId: String(form.get("academicYearId") || ""),
          reportingPeriodId: String(form.get("reportingPeriodId") || ""),
          generalComment: String(form.get("generalComment") || "") || null,
        }),
      });
      router.push(`/school/assessment/reports/${created.report.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create report");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!ctx) return <p>Loading…</p>;
  const currentYear = ctx.academicYears.find((row) => row.is_current) ?? ctx.academicYears[0];

  return (
    <>
      <h1>Create report</h1>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Pupil
          <select name="studentProfileId" required>
            <option value="">Select</option>
            {students.map((row) => <option key={row.id} value={row.id}>{row.legalName}</option>)}
          </select>
        </label>
        <label>
          Academic year
          <select name="academicYearId" defaultValue={currentYear?.id ?? ""}>
            {ctx.academicYears.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          Reporting period
          <select name="reportingPeriodId" required>
            <option value="">Select</option>
            {ctx.reportingPeriods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>General comment<textarea name="generalComment" rows={4} /></label>
        <div><button type="submit">Create draft</button></div>
      </form>
    </>
  );
}
