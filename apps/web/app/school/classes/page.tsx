"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import {
  Alert,
  Button,
  ConfirmationDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  StatusBadge,
} from "../../../components/ui";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api } from "../../../lib/api";
import { includeArchivedQuery, type AcademicLifecycle, type AcademicStatus } from "../../../lib/academic-lifecycle";
import { userFacingError } from "../../../lib/errors";

type ClassRow = {
  id: string;
  name: string;
  classType: string;
  yearGroupId: string | null;
  yearGroupName: string | null;
  academicYearName: string | null;
  academicYearId: string;
  status?: AcademicStatus;
};

type Option = { id: string; name: string; status?: AcademicStatus };
type Staff = { id: string; fullName: string };
type Subject = { id: string; name: string; status?: AcademicStatus };

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{
    row: ClassRow;
    lifecycle: AcademicLifecycle;
    mode: "delete" | "archive" | "restore";
  } | null>(null);

  async function load() {
    const [cl, yr, yg, st, sub] = await Promise.all([
      api<{ classes: ClassRow[] }>(`/api/v1/classes${includeArchivedQuery(showArchived)}`),
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
    load().catch((err: Error) => setError(userFacingError(err, "Could not load classes.")));
  }, [showArchived]);

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setNotice("");
    try {
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
      setNotice("Class added.");
    } catch (err) {
      setError(userFacingError(err, "Could not add class."));
    }
  }

  async function openClass(id: string) {
    setSelected(id);
    setEditing(false);
    const body = await api<Record<string, unknown>>(`/api/v1/classes/${id}`);
    setDetail(body);
  }

  async function saveClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const updated = await api<{ class: ClassRow }>(`/api/v1/classes/${selected}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          yearGroupId: form.get("yearGroupId") || null,
          classType: form.get("classType"),
        }),
      });
      setNotice(`${updated.class.name} updated.`);
      setEditing(false);
      await load();
      await openClass(selected);
    } catch (err) {
      setError(userFacingError(err, "Could not update class."));
    } finally {
      setSaving(false);
    }
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

  async function openLifecycle(row: ClassRow, preferred: "delete" | "archive" | "restore") {
    const body = await api<{ lifecycle: AcademicLifecycle }>(`/api/v1/classes/${row.id}/lifecycle`);
    setConfirm({
      row,
      lifecycle: body.lifecycle,
      mode: preferred === "delete" && !body.lifecycle.canDelete ? "archive" : preferred,
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    const { row, mode } = confirm;
    try {
      if (mode === "delete") {
        await api(`/api/v1/classes/${row.id}`, { method: "DELETE" });
        setNotice(`${row.name} deleted.`);
        if (selected === row.id) {
          setSelected("");
          setDetail(null);
        }
      } else if (mode === "archive") {
        await api(`/api/v1/classes/${row.id}/archive`, { method: "POST", body: "{}" });
        setNotice(`${row.name} archived.`);
      } else {
        await api(`/api/v1/classes/${row.id}/restore`, { method: "POST", body: "{}" });
        setNotice(`${row.name} restored.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update class."));
      setConfirm(null);
    }
  }

  const selectedRow = classes.find((row) => row.id === selected) ?? null;
  const detailClass = (detail?.class as ClassRow | undefined) ?? selectedRow;
  const detailStaff = (detail?.staff as Array<Record<string, string>> | undefined) ?? [];
  const detailSubjects = (detail?.subjects as Array<{ id: string; name: string }> | undefined) ?? [];
  const detailMembers = (detail?.members as Array<Record<string, string>> | undefined) ?? [];

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Classes"
        description="Classes belong to one academic year. Teacher assignments and pupil memberships are dated so history is kept when people move."
        actions={
          <label className="checkbox-row">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>Show archived</span>
          </label>
        }
      />
      <form className="card academic-create-form" onSubmit={createClass}>
        <h2>Add class</h2>
        <div className="academic-create-fields is-four">
          <FormField label="Name">
            <Input name="name" placeholder="3A" required />
          </FormField>
          <FormField label="Academic year">
            <Select name="academicYearId" required>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Year group">
            <Select name="yearGroupId">
              <option value="">None</option>
              {groups.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Type">
            <Select name="classType" defaultValue="form">
              <option value="form">Form</option>
              <option value="teaching">Teaching group</option>
            </Select>
          </FormField>
        </div>
        <div className="academic-create-actions">
          <Button type="submit">Add class</Button>
        </div>
      </form>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {years.length === 0 ? (
        <EmptyState
          title="Create an academic year first"
          description="Classes belong to one academic year. Add a year, then return here to create forms and teaching groups."
        />
      ) : classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Add a form or teaching group for the current academic year." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Year</th>
                <th>Year group</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((row) => (
                <tr key={row.id} className={selected === row.id ? "is-selected" : undefined}>
                  <td>{row.name}</td>
                  <td>{row.classType === "teaching" ? "Teaching" : "Form"}</td>
                  <td>{row.academicYearName}</td>
                  <td>{row.yearGroupName ?? "None"}</td>
                  <td>
                    <StatusBadge status={row.status ?? "active"} />
                  </td>
                  <td className="num">
                    <div className="table-actions">
                      <Button type="button" variant="secondary" onClick={() => openClass(row.id)}>
                        View
                      </Button>
                      {row.status !== "archived" ? (
                        <Button type="button" variant="ghost" onClick={() => openLifecycle(row, "delete")}>
                          Archive/Delete
                        </Button>
                      ) : (
                        <Button type="button" variant="secondary" onClick={() => openLifecycle(row, "restore")}>
                          Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && detailClass ? (
        <div className="card academic-detail">
          <section className="academic-detail-section">
            <div className="academic-detail-heading">
              <h2>Class details</h2>
              {!editing ? (
                <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                  Edit class
                </Button>
              ) : null}
            </div>
            {editing ? (
              <form className="academic-create-form is-embedded" onSubmit={saveClass}>
                <div className="academic-create-fields is-three">
                  <FormField label="Name">
                    <Input name="name" required defaultValue={detailClass.name} />
                  </FormField>
                  <FormField label="Year group">
                    <Select name="yearGroupId" defaultValue={detailClass.yearGroupId ?? ""}>
                      <option value="">None</option>
                      {groups.map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Type">
                    <Select name="classType" defaultValue={detailClass.classType}>
                      <option value="form">Form</option>
                      <option value="teaching">Teaching group</option>
                    </Select>
                  </FormField>
                </div>
                <p className="muted">Academic year: {detailClass.academicYearName ?? "—"}</p>
                <div className="academic-create-actions">
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="academic-meta">
                <div>
                  <dt>Name</dt>
                  <dd>{detailClass.name}</dd>
                </div>
                <div>
                  <dt>Academic year</dt>
                  <dd>{detailClass.academicYearName ?? "—"}</dd>
                </div>
                <div>
                  <dt>Year group</dt>
                  <dd>{detailClass.yearGroupName ?? "None"}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{detailClass.classType === "teaching" ? "Teaching group" : "Form"}</dd>
                </div>
              </dl>
            )}
          </section>
          <section className="academic-detail-section">
            <h3>Teaching</h3>
            <h4>Teachers</h4>
            <ul>
              {detailStaff.map((row) => (
                <li key={row.id}>
                  {row.fullName} — {row.assignmentRole} {row.endedOn ? `(ended ${row.endedOn})` : ""}
                </li>
              ))}
            </ul>
            <form className="form-grid" onSubmit={assignTeacher}>
              <FormField label="Staff">
                <Select name="staffProfileId" required>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Role">
                <Select name="assignmentRole" defaultValue="form_tutor">
                  <option value="form_tutor">Form tutor</option>
                  <option value="co_tutor">Co-tutor</option>
                  <option value="subject_teacher">Subject teacher</option>
                  <option value="head_of_year">Head of year</option>
                  <option value="other">Other</option>
                </Select>
              </FormField>
              <div className="academic-create-actions">
                <Button type="submit">Assign teacher</Button>
              </div>
            </form>
            <h4>Subjects</h4>
            <ul>
              {detailSubjects.map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
            </ul>
            <form className="form-grid" onSubmit={addSubject}>
              <FormField label="Subject">
                <Select name="subjectId" required>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="academic-create-actions">
                <Button type="submit">Link subject</Button>
              </div>
            </form>
          </section>
          <section className="academic-detail-section">
            <h3>Pupils</h3>
            <ul>
              {detailMembers.map((row) => (
                <li key={row.id}>
                  {row.legalName} {row.endedOn ? `(left ${row.endedOn})` : ""}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
      <ConfirmationDialog
        open={Boolean(confirm)}
        title={
          confirm?.mode === "restore"
            ? `Restore class “${confirm.row.name}”?`
            : confirm?.mode === "delete"
              ? `Delete class “${confirm.row.name}”?`
              : `Archive class “${confirm?.row.name}”?`
        }
        description={
          confirm?.mode === "restore"
            ? "This class will appear again in current class lists."
            : confirm?.mode === "delete"
              ? "This class has no pupil, timetable or teaching records and can be permanently deleted."
              : "This class cannot be deleted because it has pupil or timetable records. Archive it instead."
        }
        confirmLabel={confirm?.mode === "restore" ? "Restore" : confirm?.mode === "delete" ? "Delete class" : "Archive class"}
        danger={confirm?.mode === "delete"}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
