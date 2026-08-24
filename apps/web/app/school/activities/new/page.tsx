"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";

type Context = {
  types: Array<{ id: string; key: string; name: string }>;
  academicYears: Array<{ id: string; name: string; is_current: boolean }>;
  yearGroups: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; full_name: string }>;
  canTargetYearGroups: boolean;
};

export default function NewActivityPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Context>("/api/v1/activities/context")
      .then(setCtx)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const classIds = form.getAll("classIds").map(String).filter(Boolean);
    const yearGroupId = String(form.get("yearGroupId") || "");
    const studentIds = String(form.get("studentIds") || "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const startsLocal = String(form.get("startsAt") || "");
    const endsLocal = String(form.get("endsAt") || "");
    const deadlineLocal = String(form.get("responseDeadlineAt") || "");
    const occurrenceKind = String(form.get("occurrenceKind") || "one_off");
    const wholeSchool = form.get("wholeSchool") === "on";
    const targets = wholeSchool
      ? [{ targetType: "whole_school" }]
      : [
          ...classIds.map((classId) => ({ targetType: "class", classId })),
          ...(yearGroupId ? [{ targetType: "year_group", yearGroupId }] : []),
          ...studentIds.map((studentProfileId) => ({ targetType: "student", studentProfileId })),
        ];
    const staffUserId = String(form.get("staffUserId") || "");
    const body = {
      title: form.get("title"),
      description: form.get("description") || null,
      activityTypeId: form.get("activityTypeId"),
      academicYearId: form.get("academicYearId") || null,
      startsAt: startsLocal ? new Date(startsLocal).toISOString() : undefined,
      endsAt: endsLocal ? new Date(endsLocal).toISOString() : undefined,
      location: form.get("location") || null,
      externalAddress: form.get("externalAddress") || null,
      meetingPoint: form.get("meetingPoint") || null,
      returnPoint: form.get("returnPoint") || null,
      capacity: form.get("capacity") ? Number(form.get("capacity")) : null,
      responseDeadlineAt: deadlineLocal ? new Date(deadlineLocal).toISOString() : null,
      consentRequired: form.get("consentRequired") === "on",
      parentResponseRequired: form.get("consentRequired") === "on",
      studentSignupEnabled: form.get("studentSignupEnabled") === "on",
      parentNotes: form.get("parentNotes") || null,
      staffNotes: form.get("staffNotes") || null,
      occurrenceKind,
      recurrenceWeekdays: occurrenceKind === "recurring" ? [Number(form.get("weekday") || 2)] : null,
      recurrenceUntil: occurrenceKind === "recurring" ? String(form.get("recurrenceUntil") || "") || null : null,
      targets,
      staff: staffUserId ? [{ staffUserId, staffRole: "lead" }] : [],
    };
    try {
      const created = await api<{ activity: { id: string } }>("/api/v1/activities", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push(`/school/activities/${created.activity.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the activity.");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!ctx) return <p>Loading…</p>;

  return (
    <>
      <h1>Create activity</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Title<input name="title" required /></label>
        <label>
          Type
          <select name="activityTypeId" required>
            {ctx.types.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          Academic year
          <select name="academicYearId">
            <option value="">None</option>
            {ctx.academicYears.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>Start<input name="startsAt" type="datetime-local" required /></label>
        <label>End<input name="endsAt" type="datetime-local" required /></label>
        <label>Location<input name="location" /></label>
        <label>External address<input name="externalAddress" /></label>
        <label>Meeting point<input name="meetingPoint" /></label>
        <label>Return point<input name="returnPoint" /></label>
        <label>Capacity<input name="capacity" type="number" min={0} /></label>
        <label>Response deadline<input name="responseDeadlineAt" type="datetime-local" /></label>
        <label>
          Occurrence
          <select name="occurrenceKind" defaultValue="one_off">
            <option value="one_off">One-off</option>
            <option value="recurring">Recurring club</option>
          </select>
        </label>
        <label>
          Weekday (recurring)
          <select name="weekday" defaultValue="2">
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
          </select>
        </label>
        <label>Recurs until<input name="recurrenceUntil" type="date" /></label>
        <label>
          Classes
          <select name="classIds" multiple size={6}>
            {ctx.classes.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        {ctx.canTargetYearGroups ? (
          <label>
            Year group
            <select name="yearGroupId">
              <option value="">None</option>
              {ctx.yearGroups.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>Selected pupil IDs<textarea name="studentIds" rows={2} placeholder="Optional UUIDs" /></label>
        <label>
          Activity lead
          <select name="staffUserId">
            <option value="">None</option>
            {ctx.staff.map((row) => (
              <option key={row.id} value={row.id}>{row.full_name}</option>
            ))}
          </select>
        </label>
        <label><input name="consentRequired" type="checkbox" defaultChecked /> Parent consent required</label>
        <label><input name="studentSignupEnabled" type="checkbox" /> Student self-sign-up</label>
        {ctx.canTargetYearGroups ? <label><input name="wholeSchool" type="checkbox" /> Whole school</label> : null}
        <label>Parent-visible notes<textarea name="parentNotes" rows={3} /></label>
        <label>Internal staff notes<textarea name="staffNotes" rows={3} /></label>
        <label>Description<textarea name="description" rows={4} /></label>
        <button type="submit">Save draft</button>
      </form>
    </>
  );
}
