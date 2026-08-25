"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";

type Detail = {
  activity: { id: string; title: string; status: string; instructions: string | null; activityType: string };
  items: Array<{ promptText: string; itemType: string }>;
};

export default function LearningActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<Detail>(`/api/v1/learning-activities/${params.id}`);
    setData(body);
  }

  useEffect(() => {
    if (!params.id) return;
    load().catch((err: Error) => setError(userFacingError(err, "Could not load activity.")));
    api<{ classes: Array<{ id: string; name: string }> }>("/api/v1/classes")
      .then((body) => setClasses(body.classes))
      .catch(() => setClasses([]));
  }, [params.id]);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await api<{ assignment: { id: string } }>("/api/v1/learning-practice/assignments", {
      method: "POST",
      body: JSON.stringify({
        activityId: params.id,
        targets: [{ type: "class", classId: String(form.get("classId")) }],
      }),
    });
    await api(`/api/v1/learning-practice/assignments/${created.assignment.id}/publish`, { method: "POST" });
    await load();
  }

  if (error) return <PageError title="Activity unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading activity…" />;

  return (
    <>
      <PageHeader
        title={data.activity.title}
        description={data.activity.instructions ?? "Published activities can be assigned to classes you teach."}
        actions={
          <Button
            type="button"
            onClick={() => void api(`/api/v1/learning-activities/${params.id}/publish`, { method: "POST" }).then(load)}
          >
            Publish
          </Button>
        }
      />
      <StatusBadge status={data.activity.status} />
      <p className="muted">{data.items.length} question{data.items.length === 1 ? "" : "s"} · correct answers are not shown to pupils before submission.</p>
      <form className="section-card" onSubmit={(event) => void assign(event)}>
        <h2>Assign to a class</h2>
        <label>
          Class
          <select name="classId" required>
            {classes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Assign and publish</Button>
      </form>
    </>
  );
}
