"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Positive = {
  id: string;
  studentLegalName: string | null;
  occurredOn: string;
  categoryName: string | null;
  description: string | null;
};

export default function AchievementsPage() {
  const [items, setItems] = useState<Positive[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ positives: Positive[] }>("/api/v1/behaviour/positives")
      .then((body) => setItems(body.positives))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="toolbar">
        <h1>Achievements</h1>
        <Link href="/school/pastoral/achievements/new">Record achievement</Link>
      </div>
      {items.length === 0 ? <p>No positive records yet.</p> : null}
      <div className="cards">
        {items.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.studentLegalName ?? "Pupil"}</strong>
            <span className="muted">
              {item.categoryName} · {item.occurredOn}
            </span>
            {item.description ? <p>{item.description}</p> : null}
          </div>
        ))}
      </div>
    </>
  );
}
