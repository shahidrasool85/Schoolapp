"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { captureSubmitTarget, formatUkDateRange, resetFormSafely } from "@schoolapp/domain";
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

type HalfTerm = {
  id: string;
  termId: string;
  termName: string | null;
  name: string;
  startsOn: string;
  endsOn: string;
};

type Closure = {
  id: string;
  kind: string;
  title: string;
  startsOn: string;
  endsOn: string;
  description: string | null;
};

export default function AcademicYearTermsPage() {
  const params = useParams<{ id: string }>();
  const permissions = usePermissions();
  const canManage = permissions.has("academic.structure.manage");
  const yearId = String(params.id ?? "");
  const [year, setYear] = useState<Year | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [halfTerms, setHalfTerms] = useState<HalfTerm[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Term | null>(null);
  const [confirm, setConfirm] = useState<{ term: Term; canDelete: boolean; message: string } | null>(null);

  async function load() {
    if (!yearId) return;
    const body = await api<{
      academicYear: Year;
      terms: Term[];
      halfTerms?: HalfTerm[];
      closures?: Closure[];
    }>(`/api/v1/academic-years/${yearId}/terms`);
    setYear(body.academicYear);
    setTerms(body.terms);
    setHalfTerms(body.halfTerms ?? []);
    setClosures(body.closures ?? []);
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

  async function onCreateHalf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api(`/api/v1/academic-years/${yearId}/half-terms`, {
        method: "POST",
        body: JSON.stringify({
          termId: form.get("termId"),
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
        }),
      });
      resetFormSafely(formEl);
      setNotice("Half term added. Recurring lessons will skip these dates.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add that half term."));
    }
  }

  async function onCreateClosure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      await api(`/api/v1/academic-years/${yearId}/closures`, {
        method: "POST",
        body: JSON.stringify({
          kind: form.get("kind"),
          title: form.get("title"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn") || form.get("startsOn"),
          description: form.get("description") || null,
        }),
      });
      resetFormSafely(formEl);
      setNotice("Non-teaching day added.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add that non-teaching date."));
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
        title={`Academic calendar — ${year.name}`}
        description={`${formatUkDateRange(year.startsOn, year.endsOn)}. Term dates, half terms and other non-teaching days used by the timetable.`}
        actions={
          <Link className="button secondary" href="/school/academic-years">
            Academic years
          </Link>
        }
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {terms.length > 0 ? (
        <section className="card">
          <h2>{year.name}</h2>
          <ul className="plain-list">
            {terms.map((term) => {
              const half = halfTerms.filter((item) => item.termId === term.id);
              return (
                <li key={term.id}>
                  <strong>{term.name}</strong>: {formatUkDateRange(term.startsOn, term.endsOn)}
                  {half.map((item) => (
                    <div key={item.id} className="muted">
                      Half term: {formatUkDateRange(item.startsOn, item.endsOn)}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
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
      {canManage && year.status !== "archived" && terms.length > 0 ? (
        <form className="card academic-create-form" onSubmit={onCreateHalf}>
          <h2>Half term / closures inside a term</h2>
          <div className="academic-create-fields is-four">
            <FormField label="Term">
              <select name="termId" required>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Name">
              <Input name="name" placeholder="Autumn half term" required />
            </FormField>
            <FormField label="Starts">
              <Input name="startsOn" type="date" min={year.startsOn} max={year.endsOn} required />
            </FormField>
            <FormField label="Ends">
              <Input name="endsOn" type="date" min={year.startsOn} max={year.endsOn} required />
            </FormField>
          </div>
          <div className="academic-create-actions">
            <Button type="submit">Add half term</Button>
          </div>
        </form>
      ) : null}
      {canManage && year.status !== "archived" ? (
        <form className="card academic-create-form" onSubmit={onCreateClosure}>
          <h2>Other non-teaching days</h2>
          <p className="muted">Bank holidays, INSET and school closures. Do not duplicate term dates here.</p>
          <div className="academic-create-fields is-four">
            <FormField label="Type">
              <select name="kind" required defaultValue="bank_holiday">
                <option value="bank_holiday">Bank holiday</option>
                <option value="inset_day">INSET day</option>
                <option value="school_closure">School closure</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField label="Description">
              <Input name="title" placeholder="Good Friday" required />
            </FormField>
            <FormField label="Starts">
              <Input name="startsOn" type="date" min={year.startsOn} max={year.endsOn} required />
            </FormField>
            <FormField label="Ends">
              <Input name="endsOn" type="date" min={year.startsOn} max={year.endsOn} />
            </FormField>
          </div>
          <div className="academic-create-actions">
            <Button type="submit">Add non-teaching day</Button>
          </div>
        </form>
      ) : null}
      {closures.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Non-teaching day</th>
                <th>Type</th>
                <th>Dates</th>
              </tr>
            </thead>
            <tbody>
              {closures.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.kind.replace(/_/g, " ")}</td>
                  <td>{formatUkDateRange(item.startsOn, item.endsOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
