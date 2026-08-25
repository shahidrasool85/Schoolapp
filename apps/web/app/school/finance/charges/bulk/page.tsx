"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";
import { poundsToMinor } from "../../../../../lib/money";

type Category = { id: string; key: string; name: string };
type Option = { id: string; name: string };

export default function BulkChargePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ categories: Category[] }>("/api/v1/finance/categories"),
      api<{ classes: Option[] }>("/api/v1/classes"),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
    ])
      .then(([cats, classList, yearGroups]) => {
        setCategories(cats.categories);
        setClasses(classList.classes);
        setGroups(yearGroups.yearGroups);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("targetType") || "class");
    try {
      await api("/api/v1/finance/charges/bulk", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          categoryKey: String(form.get("categoryKey") || "other"),
          amountMinor: poundsToMinor(String(form.get("amountPounds") || "")),
          currency: "GBP",
          dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : null,
          idempotencyKey: String(form.get("idempotencyKey") || `bulk-${Date.now()}`),
          issue: true,
          target: {
            type,
            classId: type === "class" ? String(form.get("classId") || "") : undefined,
            yearGroupId: type === "year_group" ? String(form.get("yearGroupId") || "") : undefined,
          },
        }),
      });
      router.push("/school/finance/charges");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create charges");
    }
  }

  return (
    <>
      <h1>Bulk charges</h1>
      <p className="muted">Creates one pupil charge each. Retrying with the same idempotency key will not duplicate.</p>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={submit}>
        <label>
          Title
          <input name="title" required maxLength={200} />
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
          Amount (£ per pupil)
          <input name="amountPounds" inputMode="decimal" placeholder="50.00" required />
        </label>
        <label>
          Target
          <select name="targetType" defaultValue="class">
            <option value="class">Class</option>
            <option value="year_group">Year group</option>
          </select>
        </label>
        <label>
          Class
          <select name="classId">
            <option value="">Select class</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year group
          <select name="yearGroupId">
            <option value="">Select year group</option>
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <input name="dueAt" type="datetime-local" />
        </label>
        <label>
          Idempotency key
          <input name="idempotencyKey" required minLength={8} defaultValue={`bulk-${Date.now()}`} />
        </label>
        <button type="submit">Create pupil charges</button>
      </form>
    </>
  );
}
