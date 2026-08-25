"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Reward = { id: string; title: string; studentName: string | null; points: number | null; awardedAt: string; status: string; internalNote?: string | null };
type Category = { id: string; name: string; defaultPoints: number };
type Student = { id: string; legalName: string };

export default function StaffRewardsPage() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ rewards: Reward[] }>("/api/v1/rewards"),
      api<{ categories: Category[] }>("/api/v1/reward-categories"),
      api<{ students: Student[] }>("/api/v1/students"),
    ])
      .then(([rewardBody, catBody, studentBody]) => {
        setRewards(rewardBody.rewards);
        setCategories(catBody.categories);
        setStudents(studentBody.students);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load rewards.")));
  }, []);

  async function award(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = form.getAll("studentProfileIds").map(String);
    const payload = {
      categoryId: String(form.get("categoryId")),
      pupilMessage: String(form.get("pupilMessage") || ""),
      internalNote: String(form.get("internalNote") || "") || null,
      points: form.get("points") ? Number(form.get("points")) : null,
    };
    if (selected.length > 1) {
      await api("/api/v1/rewards/bulk", {
        method: "POST",
        body: JSON.stringify({ ...payload, studentProfileIds: selected }),
      });
    } else {
      await api("/api/v1/rewards", {
        method: "POST",
        body: JSON.stringify({ ...payload, studentProfileId: selected[0] }),
      });
    }
    const body = await api<{ rewards: Reward[] }>("/api/v1/rewards");
    setRewards(body.rewards);
    event.currentTarget.reset();
  }

  if (error) return <PageError title="Rewards unavailable" description={error} />;
  if (!rewards) return <LoadingState label="Loading rewards…" />;

  return (
    <>
      <PageHeader title="Rewards" description="Positive recognition is separate from behaviour sanctions. Internal notes stay staff-only." />
      <form className="section-card" onSubmit={(event) => void award(event)}>
        <h2>Award reward</h2>
        <label>
          Pupils
          <select name="studentProfileIds" multiple required size={6}>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.legalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="categoryId" required>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.defaultPoints} pts)
              </option>
            ))}
          </select>
        </label>
        <label>
          Points (optional)
          <input name="points" type="number" min={0} />
        </label>
        <label>
          Pupil-visible message
          <input name="pupilMessage" maxLength={500} />
        </label>
        <label>
          Internal note
          <input name="internalNote" maxLength={500} />
        </label>
        <Button type="submit">Award</Button>
      </form>
      {rewards.length === 0 ? (
        <EmptyState title="No rewards recorded" description="Award a category to assigned pupils." />
      ) : (
        <ul className="queue-list">
          {rewards.map((row) => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              <span className="muted">
                {row.studentName} · {row.points ?? 0} pts · {new Date(row.awardedAt).toLocaleDateString("en-GB")}
              </span>
              <StatusBadge status={row.status} />
              {row.status === "active" ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const reason = window.prompt("Reason for correcting this reward?");
                    if (!reason || reason.trim().length < 3) return;
                    void api(`/api/v1/rewards/${row.id}/revoke`, {
                      method: "POST",
                      body: JSON.stringify({ reason: reason.trim() }),
                    }).then(() => api<{ rewards: Reward[] }>("/api/v1/rewards").then((body) => setRewards(body.rewards)));
                  }}
                >
                  Correct
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
