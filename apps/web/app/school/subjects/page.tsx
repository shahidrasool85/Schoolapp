"use client";

import { FormEvent, useEffect, useState } from "react";
import { SUBJECT_KEY_HINT, captureSubmitTarget, parseSubjectCreateInput, resetFormSafely } from "@schoolapp/domain";
import { RequirePermission } from "../../../components/require-permission";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  Input,
  PageHeader,
} from "../../../components/ui";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api, ApiError } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Subject = { id: string; key: string; name: string };

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

  async function load() {
    const body = await api<{ subjects: Subject[] }>("/api/v1/subjects");
    setSubjects(body.subjects);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load subjects.")));
  }, []);

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

  return (
    <>
      <SetupReturnBanner />
      <PageHeader
        title="Subjects"
        description="Subjects used in classes, the timetable, and teaching."
      />
      <form className="card form-grid" onSubmit={onSubmit}>
        <FormField label="Name" error={fieldError.name}>
          <Input name="name" required placeholder="Mathematics" disabled={saving} />
        </FormField>
        <FormField label="Key" hint={SUBJECT_KEY_HINT} error={fieldError.key}>
          <Input name="key" placeholder="mathematics" disabled={saving} />
        </FormField>
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding subject…" : "Add subject"}
          </Button>
        </div>
      </form>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {subjects.length === 0 ? (
        <EmptyState title="No subjects yet" description="Add subjects such as Mathematics or English to use in classes and the timetable." />
      ) : (
      <table>
        <thead>
          <tr><th>Name</th><th>Key</th></tr>
        </thead>
        <tbody>
          {subjects.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.key}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </>
  );
}
