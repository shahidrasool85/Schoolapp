"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";
import { poundsToMinor } from "../../../../../lib/money";

type Category = { id: string; key: string; name: string };
type Student = { id: string; legalName: string };

export default function NewChargePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ categories: Category[] }>("/api/v1/finance/categories"),
      api<{ students: Student[] }>("/api/v1/students"),
    ])
      .then(([cats, people]) => {
        setCategories(cats.categories);
        setStudents(people.students);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = await api<{ charge: { id: string } }>("/api/v1/finance/charges", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          studentProfileId: String(form.get("studentProfileId") || ""),
          categoryKey: String(form.get("categoryKey") || "other"),
          amountMinor: poundsToMinor(String(form.get("amountPounds") || "")),
          currency: "GBP",
          dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : null,
          parentNote: String(form.get("parentNote") || "") || null,
          issue: form.get("issue") === "on",
        }),
      });
      router.push(`/school/finance/charges/${body.charge.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create charge");
    }
  }

  return (
    <>
      <h1>Create charge</h1>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={submit}>
        <label>
          Title
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Pupil
          <select name="studentProfileId" required>
            <option value="">Select pupil</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.legalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="categoryKey" defaultValue="other">
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount (£)
          <input name="amountPounds" inputMode="decimal" placeholder="8.00" required />
        </label>
        <label>
          Due
          <input name="dueAt" type="datetime-local" />
        </label>
        <label>
          Parent note
          <textarea name="parentNote" rows={3} />
        </label>
        <label>
          <input name="issue" type="checkbox" defaultChecked /> Issue immediately
        </label>
        <button type="submit">Create charge</button>
      </form>
    </>
  );
}
