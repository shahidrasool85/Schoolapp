"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Activity = { id: string; title: string; activityType: string; status: string; difficulty: string };

export default function EarlyLearningCataloguePage() {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ activities: Activity[] }>("/api/v1/learning-activities");
    setItems(body.activities);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load early learning.")));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/learning-activities", {
      method: "POST",
      body: JSON.stringify({
        title: String(form.get("title")),
        activityType: String(form.get("activityType")),
        instructions: String(form.get("instructions") || ""),
        xpReward: Number(form.get("xpReward") || 10),
        items: [
          {
            promptText: String(form.get("prompt") || "How many?"),
            itemType: "numeric",
            correctAnswer: { value: Number(form.get("answer") || 4) },
          },
        ],
      }),
    });
    await load();
    event.currentTarget.reset();
  }

  if (error) return <PageError title="Early learning unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading activities…" />;

  return (
    <>
      <PageHeader title="Early learning" description="Teacher-created practice. Scores stay in engagement and are not written to formal assessment results. AI generation is not enabled." />
      <form className="section-card" onSubmit={(event) => void create(event)}>
        <h2>New draft activity</h2>
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          Type
          <select name="activityType" defaultValue="counting">
            <option value="counting">Counting</option>
            <option value="simple_addition">Addition</option>
            <option value="spelling">Spelling</option>
            <option value="challenge">Challenge</option>
          </select>
        </label>
        <label>
          Prompt
          <input name="prompt" defaultValue="How many apples?" />
        </label>
        <label>
          Correct number
          <input name="answer" type="number" defaultValue={4} />
        </label>
        <Button type="submit">Save draft</Button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="No activities" description="Create a counting or phonics activity, then publish and assign it." />
      ) : (
        <div className="cards">
          {items.map((row) => (
            <Link key={row.id} className="card" href={`/school/engagement/learning/${row.id}`}>
              <strong>{row.title}</strong>
              <p className="muted">{row.activityType}</p>
              <StatusBadge status={row.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
