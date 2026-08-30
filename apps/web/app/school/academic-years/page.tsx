"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
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
import { api } from "../../../lib/api";
import {
  includeArchivedQuery,
  lifecycleConfirmDescription,
  type AcademicLifecycle,
  type AcademicStatus,
} from "../../../lib/academic-lifecycle";
import { userFacingError } from "../../../lib/errors";

type Year = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  status?: AcademicStatus;
};

export default function AcademicYearsPage() {
  const [years, setYears] = useState<Year[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Year | null>(null);
  const [confirm, setConfirm] = useState<{
    year: Year;
    lifecycle: AcademicLifecycle;
    mode: "delete" | "archive" | "restore";
  } | null>(null);

  async function load() {
    const body = await api<{ academicYears: Year[] }>(
      `/api/v1/academic-years${includeArchivedQuery(showArchived)}`,
    );
    setYears(body.academicYears);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load academic years.")));
  }, [showArchived]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api("/api/v1/academic-years", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
          isCurrent: form.get("isCurrent") === "on",
        }),
      });
      resetFormSafely(formEl);
      setNotice("Academic year added.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add academic year."));
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/academic-years/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.get("name"),
        startsOn: form.get("startsOn"),
        endsOn: form.get("endsOn"),
        isCurrent: form.get("isCurrent") === "on",
      }),
    });
    setEditing(null);
    setNotice("Academic year updated.");
    await load();
  }

  async function makeCurrent(id: string, year: Year) {
    await api(`/api/v1/academic-years/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        isCurrent: true,
      }),
    });
    setNotice(`${year.name} is now the current year.`);
    await load();
  }

  async function openLifecycle(year: Year, preferred: "delete" | "archive" | "restore") {
    const body = await api<{ lifecycle: AcademicLifecycle }>(`/api/v1/academic-years/${year.id}/lifecycle`);
    setConfirm({
      year,
      lifecycle: body.lifecycle,
      mode: preferred === "delete" && !body.lifecycle.canDelete ? "archive" : preferred,
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    const { year, mode } = confirm;
    try {
      if (mode === "delete") {
        await api(`/api/v1/academic-years/${year.id}`, { method: "DELETE" });
        setNotice(`${year.name} deleted.`);
      } else if (mode === "archive") {
        await api(`/api/v1/academic-years/${year.id}/archive`, { method: "POST", body: "{}" });
        setNotice(`${year.name} archived.`);
      } else {
        await api(`/api/v1/academic-years/${year.id}/restore`, { method: "POST", body: "{}" });
        setNotice(`${year.name} restored.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update academic year."));
      setConfirm(null);
    }
  }

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Academic years"
        description="Academic years hold classes, enrolments and historical school records."
        actions={
          <label className="checkbox-row">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>Show archived</span>
          </label>
        }
      />
      <form className="card academic-create-form" onSubmit={onSubmit}>
        <h2>Add academic year</h2>
        <div className="academic-create-fields is-four">
          <FormField label="Name">
            <Input name="name" placeholder="2026/27" required />
          </FormField>
          <FormField label="Starts">
            <Input name="startsOn" type="date" required />
          </FormField>
          <FormField label="Ends">
            <Input name="endsOn" type="date" required />
          </FormField>
          <label className="checkbox-row">
            <input name="isCurrent" type="checkbox" />
            <span>Current year</span>
          </label>
        </div>
        <div className="academic-create-actions">
          <Button type="submit">Add academic year</Button>
        </div>
      </form>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {years.length === 0 ? (
        <EmptyState
          title="No academic years yet"
          description="Create the current academic year to unlock classes, enrolments and the timetable."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Current</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year.id}>
                  <td>{year.name}</td>
                  <td>{year.startsOn}</td>
                  <td>{year.endsOn}</td>
                  <td>{year.isCurrent ? "Yes" : ""}</td>
                  <td>
                    <StatusBadge status={year.status ?? "active"} />
                  </td>
                  <td className="num">
                    <div className="table-actions">
                      {year.status !== "archived" ? (
                        <>
                          <Button type="button" variant="secondary" onClick={() => setEditing(year)}>
                            Edit
                          </Button>
                          {!year.isCurrent ? (
                            <Button type="button" variant="ghost" onClick={() => makeCurrent(year.id, year)}>
                              Set current
                            </Button>
                          ) : null}
                          <Button type="button" variant="ghost" onClick={() => openLifecycle(year, "delete")}>
                            Archive/Delete
                          </Button>
                        </>
                      ) : (
                        <Button type="button" variant="secondary" onClick={() => openLifecycle(year, "restore")}>
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
        title={editing ? `Edit ${editing.name}` : "Edit academic year"}
        description="Correct the label or dates. Historical records stay attached to this year."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="academic-create-form is-dialog" onSubmit={saveEdit}>
            <div className="academic-create-fields is-three">
              <FormField label="Name">
                <Input name="name" required defaultValue={editing.name} />
              </FormField>
              <FormField label="Starts">
                <Input name="startsOn" type="date" required defaultValue={editing.startsOn} />
              </FormField>
              <FormField label="Ends">
                <Input name="endsOn" type="date" required defaultValue={editing.endsOn} />
              </FormField>
            </div>
            <label className="checkbox-row">
              <input name="isCurrent" type="checkbox" defaultChecked={editing.isCurrent} />
              <span>Current year</span>
            </label>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
      <ConfirmationDialog
        open={Boolean(confirm)}
        title={
          confirm?.mode === "restore"
            ? `Restore “${confirm.year.name}”?`
            : confirm?.mode === "delete"
              ? `Delete “${confirm.year.name}”?`
              : `Archive “${confirm?.year.name}”?`
        }
        description={
          confirm
            ? lifecycleConfirmDescription(confirm.mode, confirm.lifecycle, {
                restore: "This academic year will appear again in current school lists.",
                unused: "This academic year has no dependent records and can be permanently deleted.",
                blocked: confirm.year.isCurrent
                  ? "The current academic year cannot be removed until another year is set as current."
                  : "This academic year cannot be deleted because it contains school records. Archive it instead.",
              })
            : ""
        }
        confirmLabel={
          confirm?.mode === "restore"
            ? "Restore"
            : confirm?.mode === "delete"
              ? "Delete academic year"
              : confirm?.year.isCurrent
                ? "Close"
                : "Archive academic year"
        }
        danger={confirm?.mode === "delete"}
        onConfirm={() => {
          if (confirm?.year.isCurrent && confirm.mode !== "restore") {
            setConfirm(null);
            return;
          }
          void runConfirm();
        }}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
