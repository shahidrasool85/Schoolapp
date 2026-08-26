"use client";

import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Competition = { id: string; title: string; status: string; competitionType: string };
type Board = {
  enabled: boolean;
  reason?: string;
  entries: Array<{ rank: number; displayName: string | null; score: number; entryType: string }>;
};

export default function StudentCompetitionsPage() {
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ competitions: Competition[] }>("/api/v1/student/competitions")
      .then(async (body) => {
        setCompetitions(body.competitions);
        const next: Record<string, Board> = {};
        for (const row of body.competitions) {
          try {
            next[row.id] = await api<Board>(`/api/v1/student/competitions/${row.id}/leaderboard`);
          } catch {
            next[row.id] = { enabled: false, reason: "unavailable", entries: [] };
          }
        }
        setBoards(next);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load competitions.")));
  }, []);

  if (error) return <PageError title="Competitions unavailable" description={error} />;
  if (!competitions) return <LoadingState label="Loading competitions…" />;

  return (
    <>
      <PageHeader title="Competitions" description="House and class totals where your school allows them. Named individual ranking stays off unless the school enables it." />
      {competitions.length === 0 ? (
        <EmptyState title="No competitions" description="When the school publishes a challenge, it will appear here." />
      ) : (
        competitions.map((row) => {
          const board = boards[row.id];
          return (
            <SectionCard key={row.id} title={row.title} description={`${row.competitionType} · ${row.status}`}>
              <StatusBadge status={row.status} />
              {!board?.enabled ? (
                <p className="muted">{board?.reason === "disabled" || !board?.enabled ? "The school is not showing a ranking for this challenge." : "Leaderboard unavailable."}</p>
              ) : board.entries.length === 0 ? (
                <p className="muted">No scores yet.</p>
              ) : (
                <ol className="queue-list">
                  {board.entries.map((entry) => (
                    <li key={`${entry.entryType}-${entry.rank}`}>
                      <strong>
                        {entry.rank}. {entry.displayName ?? "Rank only"}
                      </strong>
                      <span className="muted">{entry.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          );
        })
      )}
    </>
  );
}
