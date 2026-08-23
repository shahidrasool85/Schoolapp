"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Catalogue = { positiveCategories: Array<{ id: string; name: string }> };
type Student = { id: string; legalName: string };

export default function NewAchievementPage() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Catalogue>("/api/v1/behaviour/categories"),
      api<{ students: Student[] }>("/api/v1/students"),
    ])
      .then(([cats, people]) => {
        setCatalogue(cats);
        setStudents(people.students);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/behaviour/positives", {
      method: "POST",
      body: JSON.stringify({
        studentProfileId: form.get("studentProfileId"),
        occurredOn: form.get("occurredOn"),
        categoryId: form.get("categoryId"),
        description: form.get("description") || undefined,
      }),
    });
    router.push("/school/pastoral/achievements");
  }

  if (error) return <p className="error">{error}</p>;
  if (!catalogue) return <p>Loading…</p>;

  return (
    <>
      <h1>Record achievement</h1>
      <form onSubmit={onSubmit}>
        <label>
          Pupil
          <select name="studentProfileId" required>
            <option value="">Select</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.legalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input name="occurredOn" type="date" required />
        </label>
        <label>
          Category
          <select name="categoryId" required>
            {catalogue.positiveCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea name="description" rows={4} />
        </label>
        <button type="submit">Save achievement</button>
      </form>
    </>
  );
}
