"use client";

import { FormEvent, useEffect, useState } from "react";
import { SUBJECT_KEY_HINT, captureSubmitTarget, parseSubjectCreateInput, resetFormSafely } from "@schoolapp/domain";
import { RequirePermission } from "../../../components/require-permission";
import {
  Alert,
  Button,
  ConfirmationDialog,
  Dialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  StatusBadge,
} from "../../../components/ui";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api, ApiError } from "../../../lib/api";
import { includeArchivedQuery, type AcademicLifecycle, type AcademicStatus } from "../../../lib/academic-lifecycle";
import { userFacingError } from "../../../lib/errors";

type Subject = { id: string; key: string; name: string; status?: AcademicStatus };

export default function SubjectsPage() {
  return (
    <RequirePermission anyOf={["academic.structure.manage"]}>
      <SubjectsAdmin />
    </RequirePermission>
  );
}

function SubjectsAdmin() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ name?: string; key?: string }>({});
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [editError, setEditError] = useState<{ name?: string; key?: string }>({});
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState<{
    subject: Subject;
    lifecycle: AcademicLifecycle;
    mode: "delete" | "archive" | "restore";
  } | null>(null);

  async function load() {
    const body = await api<{ subjects: Subject[] }>(`/api/v1/subjects${includeArchivedQuery(showArchived)}`);
    setSubjects(body.subjects);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load subjects.")));
  }, [showArchived]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    const parsed = parseSubjectCreateInput({
      name: String(form.get("name") ?? ""),
      key: String(form.get("key") ?? ""),
    });
    setError("");
    setNotice("");
    if (!parsed.ok) {
      setFieldError({ [parsed.field]: parsed.error });
      return;
    }
    setFieldError({});
    setSaving(true);
    try {
      await api("/api/v1/subjects", {
        method: "POST",
        body: JSON.stringify({ key: parsed.key, name: parsed.name }),
      });
      resetFormSafely(formEl);
      await load();
      setNotice(`${parsed.name} added.`);
    } catch (err) {
      const message = userFacingError(err, "Could not add subject.");
      if (err instanceof ApiError && err.details?.fieldKey === "key") {
        setFieldError({ key: message });
      } else if (err instanceof ApiError && err.details?.fieldKey === "name") {
        setFieldError({ name: message });
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || editSaving) return;
    const form = new FormData(event.currentTarget);
    const parsed = parseSubjectCreateInput({
      name: String(form.get("name") ?? ""),
      key: String(form.get("key") ?? ""),
    });
    if (!parsed.ok) {
      setEditError({ [parsed.field]: parsed.error });
      return;
    }
    setEditError({});
    setEditSaving(true);
    try {
      await api(`/api/v1/subjects/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: parsed.name, key: parsed.key }),
      });
      setEditing(null);
      setNotice(`${parsed.name} updated.`);
      await load();
    } catch (err) {
      const message = userFacingError(err, "Could not update subject.");
      if (err instanceof ApiError && err.details?.fieldKey === "key") {
        setEditError({ key: message });
      } else if (err instanceof ApiError && err.details?.fieldKey === "name") {
        setEditError({ name: message });
      } else {
        setError(message);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function openLifecycle(subject: Subject, preferred: "delete" | "archive" | "restore") {
    setError("");
    const body = await api<{ lifecycle: AcademicLifecycle }>(`/api/v1/subjects/${subject.id}/lifecycle`);
    setConfirm({
      subject,
      lifecycle: body.lifecycle,
      mode: preferred === "delete" && !body.lifecycle.canDelete ? "archive" : preferred,
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    const { subject, mode } = confirm;
    try {
      if (mode === "delete") {
        await api(`/api/v1/subjects/${subject.id}`, { method: "DELETE" });
        setNotice(`${subject.name} deleted.`);
      } else if (mode === "archive") {
        await api(`/api/v1/subjects/${subject.id}/archive`, { method: "POST", body: "{}" });
        setNotice(`${subject.name} archived.`);
      } else {
        await api(`/api/v1/subjects/${subject.id}/restore`, { method: "POST", body: "{}" });
        setNotice(`${subject.name} restored.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update subject."));
      setConfirm(null);
    }
  }

  const visible = showArchived ? subjects : subjects.filter((row) => (row.status ?? "active") === "active");

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Subjects"
        description="Subjects used in classes, the timetable, and teaching."
        actions={
          <label className="checkbox-row">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>Show archived</span>
          </label>
        }
      />
      <form className="card academic-create-form" onSubmit={onSubmit} data-testid="subject-create-form">
        <h2>Add subject</h2>
        <div className="academic-create-fields">
          <FormField label="Subject name" error={fieldError.name}>
            <Input name="name" required placeholder="English" disabled={saving} autoComplete="off" />
          </FormField>
          <FormField label="Subject key" hint={SUBJECT_KEY_HINT} error={fieldError.key}>
            <Input name="key" placeholder="eng" disabled={saving} autoComplete="off" />
          </FormField>
        </div>
        <div className="academic-create-actions">
          <Button type="submit" disabled={saving}>
            {saving ? "Adding subject…" : "Add subject"}
          </Button>
        </div>
      </form>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {visible.length === 0 ? (
        <EmptyState title="No subjects yet" description="Add subjects such as Mathematics or English to use in classes and the timetable." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.key}</td>
                  <td>
                    <StatusBadge status={row.status ?? "active"} />
                  </td>
                  <td className="num">
                    <div className="table-actions">
                      {row.status !== "archived" ? (
                        <>
                          <Button type="button" variant="secondary" onClick={() => setEditing(row)}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => openLifecycle(row, "delete")}>
                            {row.status === "archived" ? "Restore" : "Archive/Delete"}
                          </Button>
                        </>
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
      <Dialog
        open={Boolean(editing)}
        title={editing ? `Edit ${editing.name}` : "Edit subject"}
        description="Subject IDs stay the same, so renaming or correcting a key does not break class or timetable links."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="academic-create-form is-dialog" onSubmit={saveEdit}>
            <div className="academic-create-fields">
              <FormField label="Subject name" error={editError.name}>
                <Input name="name" required defaultValue={editing.name} disabled={editSaving} />
              </FormField>
              <FormField label="Subject key" hint={SUBJECT_KEY_HINT} error={editError.key}>
                <Input name="key" defaultValue={editing.key} disabled={editSaving} />
              </FormField>
            </div>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSaving}>
                {editSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
      <ConfirmationDialog
        open={Boolean(confirm)}
        title={
          confirm?.mode === "restore"
            ? `Restore subject “${confirm.subject.name}”?`
            : confirm?.mode === "archive"
              ? `Archive subject “${confirm?.subject.name}”?`
              : `Delete subject “${confirm?.subject.name}”?`
        }
        description={
          confirm?.mode === "restore"
            ? "This subject will appear again in new class and timetable selections."
            : confirm?.mode === "delete"
              ? "This subject has not been used anywhere and can be permanently deleted."
              : confirm
                ? `This subject cannot be deleted because it is already used. Archive it instead so historical records stay intact.`
                : ""
        }
        confirmLabel={
          confirm?.mode === "restore" ? "Restore" : confirm?.mode === "delete" ? "Delete subject" : "Archive subject"
        }
        danger={confirm?.mode === "delete"}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
