"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import { EmptyState } from "../../../components/ui";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api } from "../../../lib/api";

type ClassRow = {
  id: string;
  name: string;
  classType: string;
  yearGroupName: string | null;
  academicYearName: string | null;
  academicYearId: string;
};

type Option = { id: string; name: string };
type Staff = { id: string; fullName: string };
type Subject = { id: string; name: string };

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const [cl, yr, yg, st, sub] = await Promise.all([
      api<{ classes: ClassRow[] }>("/api/v1/classes"),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ staff: Staff[] }>("/api/v1/staff").catch(() => ({ staff: [] as Staff[] })),
      api<{ subjects: Subject[] }>("/api/v1/subjects"),
    ]);
    setClasses(cl.classes);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setStaff(st.staff);
    setSubjects(sub.subjects);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    await api("/api/v1/classes", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        academicYearId: form.get("academicYearId"),
        yearGroupId: form.get("yearGroupId") || null,
        classType: form.get("classType"),
      }),
    });
    resetFormSafely(formEl);
    await load();
  }

  async function openClass(id: string) {
    setSelected(id);
    const body = await api<Record<string, unknown>>(`/api/v1/classes/${id}`);
    setDetail(body);
  }

  async function assignTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/classes/${selected}/staff`, {
      method: "POST",
      body: JSON.stringify({
        staffProfileId: form.get("staffProfileId"),
        assignmentRole: form.get("assignmentRole"),
      }),
    });
    await openClass(selected);
  }

  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/classes/${selected}/subjects`, {
      method: "POST",
      body: JSON.stringify({ subjectId: form.get("subjectId") }),
    });
    await openClass(selected);
  }

  const detailStaff = (detail?.staff as Array<Record<string, string>> | undefined) ?? [];
  const detailSubjects = (detail?.subjects as Array<{ id: string; name: string }> | undefined) ?? [];
  const detailMembers = (detail?.members as Array<Record<string, string>> | undefined) ?? [];

  return (
    <>
      <SetupReturnBanner />
      <h1>Classes</h1>
      <p className="muted">
        Classes belong to one academic year. Teacher assignments and pupil memberships are dated so
        history is kept when people move.
      </p>
      <form className="card form-grid" onSubmit={createClass}>
        <label>Name<input name="name" placeholder="3A" required /></label>
        <label>
          Academic year
          <select name="academicYearId" required>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select name="yearGroupId">
            <option value="">None</option>
            {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Type
          <select name="classType" defaultValue="form">
            <option value="form">Form</option>
            <option value="teaching">Teaching group</option>
          </select>
        </label>
        <div><button type="submit">Add class</button></div>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {years.length === 0 ? (
        <EmptyState
          title="Create an academic year first"
          description="Classes belong to one academic year. Add a year, then return here to create forms and teaching groups."
        />
      ) : classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Add a form or teaching group for the current academic year." />
      ) : (
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Year</th><th>Year group</th></tr>
        </thead>
        <tbody>
          {classes.map((row) => (
            <tr key={row.id} onClick={() => openClass(row.id)} style={{ cursor: "pointer" }}>
              <td>{row.name}</td>
              <td>{row.classType}</td>
              <td>{row.academicYearName}</td>
              <td>{row.yearGroupName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {selected && detail ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Class details</h2>
          <p className="muted">Click a class above. Assign teachers and subjects here.</p>
          <h3>Teachers</h3>
          <ul>
            {detailStaff.map((row) => (
              <li key={row.id}>{row.fullName} — {row.assignmentRole} {row.endedOn ? `(ended ${row.endedOn})` : ""}</li>
            ))}
          </ul>
          <form className="form-grid" onSubmit={assignTeacher}>
            <label>
              Staff
              <select name="staffProfileId" required>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
            </label>
            <label>
              Role
              <select name="assignmentRole" defaultValue="form_tutor">
                <option value="form_tutor">Form tutor</option>
                <option value="co_tutor">Co-tutor</option>
                <option value="subject_teacher">Subject teacher</option>
                <option value="head_of_year">Head of year</option>
                <option value="other">Other</option>
              </select>
            </label>
            <div><button type="submit">Assign teacher</button></div>
          </form>
          <h3>Subjects</h3>
          <ul>{detailSubjects.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
          <form className="form-grid" onSubmit={addSubject}>
            <label>
              Subject
              <select name="subjectId" required>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div><button type="submit">Link subject</button></div>
          </form>
          <h3>Pupils</h3>
          <ul>
            {detailMembers.map((row) => (
              <li key={row.id}>{row.legalName} {row.endedOn ? `(left ${row.endedOn})` : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
