"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../../lib/api";

type ClassRow = { id: string; name: string };

export default function NewAnnouncementPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ classes: ClassRow[] }>("/api/v1/classes")
      .then((body) => setClasses(body.classes))
      .catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetType = String(form.get("targetType") || "staff");
    const classId = String(form.get("classId") || "");
    const targets =
      targetType === "class" && classId
        ? [{ targetType: "class", classId }]
        : [{ targetType }];
    try {
      const created = await api<{ announcement: { id: string } }>("/api/v1/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          body: String(form.get("body") || ""),
          priority: String(form.get("priority") || "normal"),
          acknowledgementRequired: form.get("acknowledgementRequired") === "on",
          pinned: form.get("pinned") === "on",
          targets,
        }),
      });
      router.push(`/school/communications/announcements/${created.announcement.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <>
      <h1>New announcement</h1>
      {error ? <p className="error">{error}</p> : null}
      <form onSubmit={onSubmit} className="stack">
        <label>
          Title
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Body
          <textarea name="body" required rows={8} />
        </label>
        <label>
          Priority
          <select name="priority" defaultValue="normal">
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label>
          Audience
          <select name="targetType" defaultValue="staff">
            <option value="staff">Staff only</option>
            <option value="parents">Parents</option>
            <option value="students">Students</option>
            <option value="whole_school">Whole school</option>
            <option value="class">One class</option>
          </select>
        </label>
        <label>
          Class (if class audience)
          <select name="classId" defaultValue="">
            <option value="">Select class</option>
            {classes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" name="acknowledgementRequired" /> Acknowledgement required
        </label>
        <label>
          <input type="checkbox" name="pinned" /> Pin
        </label>
        <button type="submit">Save draft</button>
      </form>
    </>
  );
}
