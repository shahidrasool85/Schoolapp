"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type Catalogue = {
  incidentCategories: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
};
type Student = { id: string; legalName: string };

export default function NewIncidentPage() {
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
    const created = await api<{ incident: { id: string } }>("/api/v1/behaviour/incidents", {
      method: "POST",
      body: JSON.stringify({
        studentProfileId: form.get("studentProfileId"),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        categoryId: form.get("categoryId"),
        locationId: form.get("locationId") || undefined,
        description: form.get("description"),
        severity: form.get("severity") || "low",
        actionTaken: form.get("actionTaken") || undefined,
        followUpRequired: form.get("followUpRequired") === "on",
      }),
    });
    router.push(`/school/pastoral/behaviour/${created.incident.id}`);
  }

  if (error) return <p className="error">{error}</p>;
  if (!catalogue) return <p>Loading…</p>;

  return (
    <>
      <h1>Record behaviour incident</h1>
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
          Date / time
          <input name="occurredAt" type="datetime-local" required />
        </label>
        <label>
          Category
          <select name="categoryId" required>
            {catalogue.incidentCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select name="locationId">
            <option value="">Not specified</option>
            {catalogue.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select name="severity" defaultValue="low">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Description
          <textarea name="description" required rows={5} />
        </label>
        <label>
          Action taken
          <textarea name="actionTaken" rows={3} />
        </label>
        <label>
          <input name="followUpRequired" type="checkbox" /> Follow-up required
        </label>
        <button type="submit">Save incident</button>
      </form>
    </>
  );
}
