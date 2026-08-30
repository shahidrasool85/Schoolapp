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
  Select,
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

type YearGroup = {
  id: string;
  code: string;
  name: string;
  keyStage: number | null;
  studentLoginEnabled: boolean;
  status?: AcademicStatus;
  origin?: "system" | "custom";
};

export default function YearGroupsPage() {
  const [groups, setGroups] = useState<YearGroup[]>([]);
  const [maxCode, setMaxCode] = useState("8");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<YearGroup | null>(null);
  const [confirm, setConfirm] = useState<{
    group: YearGroup;
    lifecycle: AcademicLifecycle;
    mode: "delete" | "archive" | "restore";
  } | null>(null);

  async function load() {
    const [yg, org] = await Promise.all([
      api<{ yearGroups: YearGroup[] }>(`/api/v1/year-groups${includeArchivedQuery(showArchived)}`),
      api<{ settings: { maxYearGroupCode?: string } | null }>("/api/v1/organisation"),
    ]);
    setGroups(yg.yearGroups);
    if (org.settings?.maxYearGroupCode) setMaxCode(org.settings.maxYearGroupCode);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load year groups.")));
  }, [showArchived]);

  async function seed() {
    await api("/api/v1/year-groups/seed", { method: "POST", body: "{}" });
    setNotice("Standard year groups added.");
    await load();
  }

  async function saveMax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/organisation/settings", {
      method: "PATCH",
      body: JSON.stringify({ maxYearGroupCode: form.get("maxYearGroupCode") }),
    });
    setNotice("Maximum year saved.");
    await load();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api("/api/v1/year-groups", {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name") || undefined,
          studentLoginEnabled: form.get("studentLoginEnabled") === "on",
        }),
      });
      resetFormSafely(formEl);
      setNotice("Year group added.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add year group."));
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/year-groups/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: form.get("name") }),
    });
    setEditing(null);
    setNotice(`${form.get("name")} updated.`);
    await load();
  }

  async function toggleLogin(id: string, enabled: boolean) {
    await api(`/api/v1/year-groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ studentLoginEnabled: !enabled }),
    });
    await load();
  }

  async function openLifecycle(group: YearGroup, preferred: "delete" | "archive" | "restore") {
    const body = await api<{ lifecycle: AcademicLifecycle }>(`/api/v1/year-groups/${group.id}/lifecycle`);
    setConfirm({
      group,
      lifecycle: body.lifecycle,
      mode: preferred === "delete" && !body.lifecycle.canDelete ? "archive" : preferred,
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    const { group, mode } = confirm;
    try {
      if (mode === "delete") {
        await api(`/api/v1/year-groups/${group.id}`, { method: "DELETE" });
        setNotice(`${group.name} deleted.`);
      } else if (mode === "archive") {
        await api(`/api/v1/year-groups/${group.id}/archive`, { method: "POST", body: "{}" });
        setNotice(`${group.name} archived.`);
      } else {
        await api(`/api/v1/year-groups/${group.id}/restore`, { method: "POST", body: "{}" });
        setNotice(`${group.name} restored.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update year group."));
      setConfirm(null);
    }
  }

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Year groups"
        description="Reception through the school's configured maximum year. Student portal access is configured as a school default with year-group overrides."
        actions={
          <label className="checkbox-row">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>Show archived</span>
          </label>
        }
      />
      <form className="card academic-create-form" onSubmit={saveMax}>
        <h2>School year range</h2>
        <div className="academic-create-fields">
          <FormField label="Maximum year">
            <Select name="maxYearGroupCode" value={maxCode} onChange={(e) => setMaxCode(e.target.value)}>
              {["R", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((code) => (
                <option key={code} value={code}>
                  {code === "R" ? "Reception" : `Year ${code}`}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="academic-create-actions">
          <Button type="submit">Save maximum</Button>
          <Button type="button" variant="secondary" onClick={() => void seed()}>
            Add standard year groups
          </Button>
        </div>
      </form>
      <form className="card academic-create-form" onSubmit={add}>
        <h2>Add year group</h2>
        <div className="academic-create-fields is-three">
          <FormField label="Code">
            <Input name="code" placeholder="R or 6" required />
          </FormField>
          <FormField label="Name">
            <Input name="name" placeholder="Year 6" />
          </FormField>
          <label className="checkbox-row">
            <input name="studentLoginEnabled" type="checkbox" />
            <span>Student login</span>
          </label>
        </div>
        <div className="academic-create-actions">
          <Button type="submit">Add year group</Button>
        </div>
      </form>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {groups.length === 0 ? (
        <EmptyState
          title="No year groups yet"
          description="Seed Reception through your maximum year, or add year groups individually."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Key stage</th>
                <th>Student login</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((row) => (
                <tr key={row.id}>
                  <td>{row.code}</td>
                  <td>
                    {row.name}
                    {row.origin === "system" ? <span className="muted"> · Standard</span> : null}
                  </td>
                  <td>{row.keyStage ?? "—"}</td>
                  <td>{row.studentLoginEnabled ? "Enabled" : "Off"}</td>
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
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => toggleLogin(row.id, row.studentLoginEnabled)}
                          >
                            Toggle login
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => openLifecycle(row, "delete")}>
                            {row.origin === "system" ? "Archive" : "Archive/Delete"}
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
        title={editing ? `Edit ${editing.name}` : "Edit year group"}
        description="The year-group code stays the same so historical classes and enrolments remain linked."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="academic-create-form is-dialog" onSubmit={saveEdit}>
            <FormField label="Display name">
              <Input name="name" required defaultValue={editing.name} />
            </FormField>
            <p className="muted">Code {editing.code} cannot be changed once created.</p>
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
            ? `Restore “${confirm.group.name}”?`
            : confirm?.mode === "delete"
              ? `Delete “${confirm.group.name}”?`
              : `Archive “${confirm?.group.name}”?`
        }
        description={
          confirm
            ? lifecycleConfirmDescription(confirm.mode, confirm.lifecycle, {
                restore: "This year group will appear again in class and enrolment pickers.",
                unused: "This year group is unused and can be permanently deleted.",
                blocked:
                  "This year group cannot be deleted because classes or pupil records use it. Archive it instead.",
              })
            : ""
        }
        confirmLabel={confirm?.mode === "restore" ? "Restore" : confirm?.mode === "delete" ? "Delete year group" : "Archive year group"}
        danger={confirm?.mode === "delete"}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
