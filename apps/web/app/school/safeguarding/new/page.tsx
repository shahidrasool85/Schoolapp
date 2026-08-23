"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";

type Catalogue = { categories: Array<{ id: string; name: string }> };
type Student = { id: string; legalName: string };

export default function NewSafeguardingConcernPage() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Catalogue>("/api/v1/safeguarding/categories"),
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
    const created = await api<{ concern: { id: string } }>("/api/v1/safeguarding/concerns", {
      method: "POST",
      body: JSON.stringify({
        studentProfileId: form.get("studentProfileId"),
        aroseAt: new Date(String(form.get("aroseAt"))).toISOString(),
        categoryId: form.get("categoryId"),
        factualDescription: form.get("factualDescription"),
        immediateActionTaken: form.get("immediateActionTaken") || undefined,
        followUpDueOn: form.get("followUpDueOn") || undefined,
      }),
    });
    router.push(`/school/safeguarding/${created.concern.id}`);
  }

  if (error) return <p className="error">{error}</p>;
  if (!catalogue) return <p>Loading…</p>;

  return (
    <>
      <h1>Record safeguarding concern</h1>
      <p className="muted">Record facts only. Do not record legal conclusions.</p>
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
          Date / time concern arose
          <input name="aroseAt" type="datetime-local" required />
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
          Factual description
          <textarea name="factualDescription" required rows={6} />
        </label>
        <label>
          Immediate action taken
          <textarea name="immediateActionTaken" rows={3} />
        </label>
        <label>
          Follow-up date
          <input name="followUpDueOn" type="date" />
        </label>
        <button type="submit">Save concern</button>
      </form>
    </>
  );
}
