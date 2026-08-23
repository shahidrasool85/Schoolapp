"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Catalogue = { categories: Array<{ id: string; name: string }> };
type Student = { id: string; legalName: string };

export default function NewPastoralConcernPage() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Catalogue>("/api/v1/pastoral/categories"),
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
    const created = await api<{ concern: { id: string } }>("/api/v1/pastoral/concerns", {
      method: "POST",
      body: JSON.stringify({
        studentProfileId: form.get("studentProfileId"),
        categoryId: form.get("categoryId"),
        concernOn: form.get("concernOn"),
        summary: form.get("summary"),
        detailedNotes: form.get("detailedNotes") || undefined,
        priority: form.get("priority") || "medium",
        attendanceRelated: form.get("attendanceRelated") === "on",
        followUpDueOn: form.get("followUpDueOn") || undefined,
      }),
    });
    router.push(`/school/pastoral/concerns/${created.concern.id}`);
  }

  if (error) return <p className="error">{error}</p>;
  if (!catalogue) return <p>Loading…</p>;

  return (
    <>
      <h1>Raise pastoral concern</h1>
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
          <input name="concernOn" type="date" required />
        </label>
        <label>
          Category
          <select name="categoryId" required>
            {catalogue.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Summary
          <input name="summary" required maxLength={240} />
        </label>
        <label>
          Confidential notes
          <textarea name="detailedNotes" rows={5} />
        </label>
        <label>
          Follow-up date
          <input name="followUpDueOn" type="date" />
        </label>
        <label>
          <input name="attendanceRelated" type="checkbox" /> Related to attendance
        </label>
        <button type="submit">Save concern</button>
      </form>
    </>
  );
}
