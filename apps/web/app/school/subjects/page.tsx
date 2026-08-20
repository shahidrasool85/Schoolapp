"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Subject = { id: string; key: string; name: string };

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ subjects: Subject[] }>("/api/v1/subjects");
    setSubjects(body.subjects);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const key = String(form.get("key") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await api("/api/v1/subjects", {
      method: "POST",
      body: JSON.stringify({ key, name }),
    });
    event.currentTarget.reset();
    await load();
  }

  return (
    <>
      <h1>Subjects</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Name<input name="name" required placeholder="Mathematics" /></label>
        <label>Key<input name="key" placeholder="mathematics" /></label>
        <div><button type="submit">Add subject</button></div>
      </form>
      {error ? <p className="error">{error}</p> : null}
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
    </>
  );
}
