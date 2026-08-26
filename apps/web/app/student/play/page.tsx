"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Practice = {
  assignmentId: string;
  title: string;
  activityType: string;
  instructions: string | null;
  xpReward: number;
  latestAttempt: { completionState: string; score: number | null; maxScore: number | null } | null;
};

export default function StudentPlayPage() {
  const [practice, setPractice] = useState<Practice[] | null>(null);
  const [childFriendly, setChildFriendly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ practice: Practice[]; childFriendlyUi: boolean }>("/api/v1/student/practice")
      .then((body) => {
        setPractice(body.practice);
        setChildFriendly(Boolean(body.childFriendlyUi));
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load practice.")));
  }, []);

  if (error) return <PageError title="Practice unavailable" description={error} />;
  if (!practice) return <LoadingState label="Loading practice…" />;

  return (
    <>
      <PageHeader
        title={childFriendly ? "Play & learn" : "Practice"}
        description="Teacher-assigned practice. Scores are not formal assessments."
      />
      {practice.length === 0 ? (
        <EmptyState title="Nothing to try yet" description="When a teacher assigns practice, it will appear here." />
      ) : (
        <div className={`cards${childFriendly ? " early-learn-cards" : ""}`}>
          {practice.map((row) => (
            <Link key={row.assignmentId} className="card" href={`/student/play/${row.assignmentId}`}>
              <strong>{row.title}</strong>
              <p className="muted">{row.instructions ?? row.activityType}</p>
              {row.latestAttempt ? (
                <StatusBadge status={row.latestAttempt.completionState} />
              ) : (
                <StatusBadge status="Ready" />
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
