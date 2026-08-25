"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Alert, DataTable, EmptyState, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Student = {
  id: string;
  legalName: string;
  admissionNumber: string | null;
  enrolmentStatus: string;
  currentYearGroupName: string | null;
  currentFormClassName: string | null;
};

type Option = { id: string; name: string; code?: string };

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [stu, yr, yg, cl] = await Promise.all([
      api<{ students: Student[] }>("/api/v1/students"),
      api<{ academicYears: Option[] }>("/api/v1/academic-years"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
      api<{ classes: Option[] }>("/api/v1/classes"),
    ]);
    setStudents(stu.students);
    setYears(yr.academicYears);
    setGroups(yg.yearGroups);
    setClasses(cl.classes);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load pupils.")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/students", {
        method: "POST",
        body: JSON.stringify({
          legalName: form.get("legalName"),
          admissionNumber: form.get("admissionNumber") || undefined,
          academicYearId: form.get("academicYearId") || undefined,
          yearGroupId: form.get("yearGroupId") || undefined,
          classId: form.get("classId") || undefined,
        }),
      });
      event.currentTarget.reset();
      setMessage("Pupil created.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not create student"));
    }
  }

  return (
    <>
      <PageHeader
        title="Pupils"
        description="Current year group and form class are derived from enrolments and dated class memberships. Moving a pupil keeps the previous records."
      />
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Legal name<input name="legalName" required /></label>
        <label>Admission number<input name="admissionNumber" /></label>
        <label>
          Academic year
          <select name="academicYearId">
            <option value="">Not enrolled yet</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Year group
          <select name="yearGroupId">
            <option value="">Select</option>
            {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <label>
          Form class
          <select name="classId">
            <option value="">None</option>
            {classes.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </label>
        <div><button type="submit">Add student</button></div>
      </form>
      {message ? (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {students.length === 0 ? (
        <EmptyState title="No pupils yet" description="Add a pupil above, or wait for an admitted application to enrol." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Name</th>
              <th>Admission no.</th>
              <th>Year group</th>
              <th>Form class</th>
              <th>Status</th>
            </>
          }
        >
          {students.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/school/students/${s.id}`}>{s.legalName}</Link>
              </td>
              <td>{s.admissionNumber ?? "—"}</td>
              <td>{s.currentYearGroupName ?? "—"}</td>
              <td>{s.currentFormClassName ?? "—"}</td>
              <td>
                <StatusBadge status={s.enrolmentStatus} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
