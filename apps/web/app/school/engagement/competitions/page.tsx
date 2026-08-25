"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Competition = { id: string; title: string; status: string; competitionType: string; scoringModel: string };

export default function StaffCompetitionsPage() {
  const [items, setItems] = useState<Competition[] | null>(null);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ competitions: Competition[] }>("/api/v1/competitions");
    setItems(body.competitions);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load competitions.")));
    api<{ classes: Array<{ id: string; name: string }> }>("/api/v1/classes")
      .then((body) => setClasses(body.classes))
      .catch(() => setClasses([]));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("competitionType"));
    const classId = String(form.get("classId") || "");
    await api("/api/v1/competitions", {
      method: "POST",
      body: JSON.stringify({
        title: String(form.get("title")),
        competitionType: type,
        scoringModel: String(form.get("scoringModel")),
        targets: classId ? [{ type: "class", classId }] : [{ type: "whole_school" }],
      }),
    });
    await load();
    event.currentTarget.reset();
  }

  if (error) return <PageError title="Competitions unavailable" description={error} />;
  if (!items) return <LoadingState label="Loading competitions…" />;

  return (
    <>
      <PageHeader title="Competitions" description="House and class competitions are preferred. Individual named ranking stays off unless the school enables it." />
      <form className="section-card" onSubmit={(event) => void create(event)}>
        <h2>Create competition</h2>
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          Type
          <select name="competitionType" defaultValue="class">
            <option value="house">House</option>
            <option value="class">Class</option>
            <option value="year_group">Year group</option>
            <option value="individual">Individual</option>
            <option value="school">School</option>
          </select>
        </label>
        <label>
          Assigned class (required for class competitions; teachers should use this)
          <select name="classId">
            <option value="">Whole school (admin)</option>
            {classes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scoring
          <select name="scoringModel" defaultValue="reward_points">
            <option value="reward_points">Reward points</option>
            <option value="xp">XP</option>
            <option value="completed_learning_activities">Completed activities</option>
            <option value="teacher_score">Teacher-entered score</option>
          </select>
        </label>
        <Button type="submit">Create draft</Button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="No competitions" description="Create a house reading challenge or class totals competition." />
      ) : (
        <div className="cards">
          {items.map((row) => (
            <Link key={row.id} className="card" href={`/school/engagement/competitions/${row.id}`}>
              <strong>{row.title}</strong>
              <p className="muted">
                {row.competitionType} · {row.scoringModel}
              </p>
              <StatusBadge status={row.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
