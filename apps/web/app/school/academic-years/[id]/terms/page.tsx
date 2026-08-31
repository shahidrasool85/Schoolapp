"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import {
  Alert,
  Button,
  ConfirmationDialog,
  Dialog,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  PageError,
  PageHeader,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { usePermissions } from "../../../../../lib/use-permissions";

type Year = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  status?: string;
};

type Term = {
  id: string;
  name: string;
  key: string;
  startsOn: string;
  endsOn: string;
  sortOrder: number;
};

export default function AcademicYearTermsPage() {
  const params = useParams<{ id: string }>();
  const permissions = usePermissions();
  const canManage = permissions.has("academic.structure.manage");
  const yearId = String(params.id ?? "");
  const [year, setYear] = useState<Year | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Term | null>(null);
  const [confirm, setConfirm] = useState<{ term: Term; canDelete: boolean; message: string } | null>(null);

  async function load() {
    if (!yearId) return;
    const body = await api<{ academicYear: Year; terms: Term[] }>(`/api/v1/academic-years/${yearId}/terms`);
    setYear(body.academicYear);
    setTerms(body.terms);
  }

  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    load()
      .catch((err: Error) => setError(userFacingError(err, "Could not load terms.")))
      .finally(() => setLoading(false));
  }, [yearId]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api(`/api/v1/academic-years/${yearId}/terms`, {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
          sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : undefined,
        }),
      });
      resetFormSafely(formEl);
      setNotice("Term added.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add that term."));
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/v1/terms/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
          sortOrder: form.get("sortOrder") ? Number(form.get("sortOrder")) : editing.sortOrder,
        }),
      });
      setEditing(null);
      setNotice("Term updated.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update that term."));
    }
  }

  async function openDelete(term: Term) {
    const body = await api<{ lifecycle: { canDelete: boolean; message: string } }>(
      `/api/v1/terms/${term.id}/lifecycle`,
    );
    setConfirm({ term, canDelete: body.lifecycle.canDelete, message: body.lifecycle.message });
  }

  async function runDelete() {
    if (!confirm?.canDelete) {
      setConfirm(null);
      return;
    }
    try {
      await api(`/api/v1/terms/${confirm.term.id}`, { method: "DELETE" });
      setNotice(`${confirm.term.name} deleted.`);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not delete that term."));
      setConfirm(null);
    }
  }

  if (loading) return <LoadingState label="Loading terms…" />;
  if (error && !year) return <PageError title="Terms unavailable" description={error} />;
  if (!year) return <EmptyState title="Academic year not found" description="Return to academic years and try again." />;

  return (
    <>
      <PageHeader
        title={`Terms — ${year.name}`}
        description={`${year.startsOn} to ${year.endsOn}. Schools may have any number of terms; typical UK examples are Autumn, Spring and Summer.`}
        actions={
          <Link className="button secondary" href="/school/academic-years">
            Academic years
          </Link>
        }
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {canManage && year.status !== "archived" ? (
        <form className="card academic-create-form" onSubmit={onCreate}>
          <h2>Add term</h2>
          <div className="academic-create-fields is-four">
            <FormField label="Name">
              <Input name="name" placeholder="Autumn" required />
            </FormField>
            <FormField label="Starts">
              <Input name="startsOn" type="date" min={year.startsOn} max={year.endsOn} required />
            </FormField>
            <FormField label="Ends">
              <Input name="endsOn" type="date" min={year.startsOn} max={year.endsOn} required />
            </FormField>
            <FormField label="Order">
              <Input name="sortOrder" type="number" min={0} max={20} placeholder="1" />
            </FormField>
          </div>
          <div className="academic-create-actions">
            <Button type="submit">Add term</Button>
          </div>
        </form>
      ) : year.status === "archived" ? (
        <p className="muted">This academic year is archived, so new terms cannot be added.</p>
      ) : (
        <p className="muted">Term dates are managed by school administration.</p>
      )}
      {terms.length === 0 ? (
        <EmptyState
          title="No terms yet"
          description="Add Autumn, Spring and Summer — or whatever terms this school uses. Until terms exist, the timetable uses the academic year dates."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Order</th>
                {canManage ? <th className="num">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {terms.map((term) => (
                <tr key={term.id}>
                  <td>{term.name}</td>
                  <td>{term.startsOn}</td>
                  <td>{term.endsOn}</td>
                  <td>{term.sortOrder}</td>
                  {canManage ? (
                    <td className="num">
                      <div className="table-actions">
                        <Button type="button" variant="secondary" onClick={() => setEditing(term)}>
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => void openDelete(term)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={Boolean(editing)}
        title={editing ? `Edit ${editing.name}` : "Edit term"}
        description="Term dates must stay inside the academic year and must not overlap another term."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="academic-create-form is-dialog" onSubmit={saveEdit}>
            <div className="academic-create-fields is-three">
              <FormField label="Name">
                <Input name="name" required defaultValue={editing.name} />
              </FormField>
              <FormField label="Starts">
                <Input name="startsOn" type="date" required defaultValue={editing.startsOn} min={year.startsOn} max={year.endsOn} />
              </FormField>
              <FormField label="Ends">
                <Input name="endsOn" type="date" required defaultValue={editing.endsOn} min={year.startsOn} max={year.endsOn} />
              </FormField>
            </div>
            <FormField label="Order">
              <Input name="sortOrder" type="number" min={0} max={20} defaultValue={editing.sortOrder} />
            </FormField>
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
        title={confirm ? `${confirm.canDelete ? "Delete" : "Cannot delete"} “${confirm.term.name}”?` : "Delete term"}
        description={
          confirm?.canDelete
            ? "This term has no dependent records and can be permanently deleted. Timetable history is not cascade-deleted."
            : confirm?.message || "This term cannot be deleted."
        }
        confirmLabel={confirm?.canDelete ? "Delete term" : "Close"}
        danger={Boolean(confirm?.canDelete)}
        onConfirm={() => void runDelete()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
