"use client";

import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Definition = { id: string; title: string; description: string | null; criteriaType: string; threshold: number | null };

export default function StaffAchievementsPage() {
  const [definitions, setDefinitions] = useState<Definition[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ definitions: Definition[] }>("/api/v1/achievements/definitions")
      .then((body) => setDefinitions(body.definitions))
      .catch((err: Error) => setError(userFacingError(err, "Could not load achievements.")));
  }, []);

  if (error) return <PageError title="Achievements unavailable" description={error} />;
  if (!definitions) return <LoadingState label="Loading achievements…" />;

  return (
    <>
      <PageHeader title="Achievements" description="Controlled criteria only. Automatic awards are idempotent; pupils do not receive the same unique badge twice." />
      {definitions.length === 0 ? (
        <EmptyState title="No achievement definitions" description="School defaults are created when engagement is first opened." />
      ) : (
        <div className="cards">
          {definitions.map((row) => (
            <article key={row.id} className="card">
              <strong>{row.title}</strong>
              <p className="muted">{row.description}</p>
              <p className="muted">
                {row.criteriaType}
                {row.threshold != null ? ` · ${row.threshold}` : ""}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
