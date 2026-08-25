"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge, Tabs } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";

type Competition = { id: string; title: string; status: string; competitionType: string };
type Board = {
  enabled: boolean;
  reason?: string;
  entries: Array<{ rank: number; displayName: string | null; score: number; entryType: string }>;
};

export default function ParentChildCompetitionsPage() {
  const params = useParams<{ id: string }>();
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    api<{ competitions: Competition[] }>(`/api/v1/parent/children/${params.id}/competitions`)
      .then(async (body) => {
        setCompetitions(body.competitions);
        const next: Record<string, Board> = {};
        for (const row of body.competitions) {
          try {
            next[row.id] = await api<Board>(`/api/v1/parent/children/${params.id}/competitions/${row.id}/leaderboard`);
          } catch {
            next[row.id] = { enabled: false, reason: "unavailable", entries: [] };
          }
        }
        setBoards(next);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load competitions.")));
  }, [params.id]);

  if (error) return <PageError title="Competitions unavailable" description={error} />;
  if (!competitions) return <LoadingState label="Loading competitions…" />;

  return (
    <>
      <PageHeader title="Competitions" description="House or class totals if the school shares them. Individual names follow school privacy policy." />
      <Tabs>
        <Link href={`/parent/children/${params.id}`}>Overview</Link>
        <Link href={`/parent/children/${params.id}/engagement`}>Rewards</Link>
        <Link href={`/parent/children/${params.id}/competitions`} aria-current="page">
          Competitions
        </Link>
      </Tabs>
      {competitions.length === 0 ? (
        <EmptyState title="No competitions" description="School challenges that are visible to parents will appear here." />
      ) : (
        competitions.map((row) => {
          const board = boards[row.id];
          return (
            <SectionCard key={row.id} title={row.title}>
              <StatusBadge status={row.status} />
              {!board?.enabled ? (
                <p className="muted">The school is not showing a ranking for this challenge.</p>
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
