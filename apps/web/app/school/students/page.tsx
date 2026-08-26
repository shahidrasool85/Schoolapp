"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, DataTable, EmptyState, FormField, Input, PageHeader, Select, StatusBadge } from "../../../components/ui";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
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
  const [busy, setBusy] = useState(false);

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
    load().catch((err: unknown) => setError(userFacingError(err, "Could not load pupils.")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = captureSubmitTarget(event);
    const payload = new FormData(form);
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await api("/api/v1/students", {
        method: "POST",
        body: JSON.stringify({
          legalName: payload.get("legalName"),
          dateOfBirth: payload.get("dateOfBirth") || undefined,
          admissionNumber: payload.get("admissionNumber") || undefined,
          academicYearId: payload.get("academicYearId") || undefined,
          yearGroupId: payload.get("yearGroupId") || undefined,
          classId: payload.get("classId") || undefined,
        }),
      });
      resetFormSafely(form);
      setMessage("Pupil created.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not create student"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Pupils"
        description="Current year group and form class are derived from enrolments and dated class memberships. Moving a pupil keeps the previous records."
      />
      <form className="card form-grid" onSubmit={onSubmit}>
        <FormField label="Legal name" htmlFor="legalName">
          <Input id="legalName" name="legalName" required />
        </FormField>
        <FormField label="Date of birth" htmlFor="dateOfBirth">
          <Input id="dateOfBirth" name="dateOfBirth" type="date" />
        </FormField>
        <FormField label="Admission number" htmlFor="admissionNumber">
          <Input id="admissionNumber" name="admissionNumber" />
        </FormField>
        <FormField label="Academic year" htmlFor="academicYearId">
          <Select id="academicYearId" name="academicYearId">
            <option value="">Not enrolled yet</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Year group" htmlFor="yearGroupId">
          <Select id="yearGroupId" name="yearGroupId">
            <option value="">Select</option>
            {groups.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Form class" htmlFor="classId">
          <Select id="classId" name="classId">
            <option value="">None</option>
            {classes.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="form-control-action">
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add student"}
          </Button>
        </div>
      </form>
      {message ? <Alert tone="success">{message}</Alert> : null}
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
              <td>{s.admissionNumber ?? "Not provided"}</td>
              <td>{s.currentYearGroupName ?? "Not provided"}</td>
              <td>{s.currentFormClassName ?? "Not provided"}</td>
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
