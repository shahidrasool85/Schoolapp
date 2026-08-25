"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";

type Detail = {
  competition: { id: string; title: string; status: string; competitionType: string; resultFrozen: boolean };
  leaderboard: { enabled: boolean; reason?: string; entries: Array<{ rank: number; displayName: string | null; score: number; entryType: string }> };
};

export default function CompetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<Detail>(`/api/v1/competitions/${params.id}`);
    setData(body);
  }

  useEffect(() => {
    if (!params.id) return;
    load().catch((err: Error) => setError(userFacingError(err, "Could not load competition.")));
  }, [params.id]);

  if (error) return <PageError title="Competition unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading competition…" />;

  return (
    <>
      <PageHeader
        title={data.competition.title}
        description={`${data.competition.competitionType} competition. Names follow school leaderboard policy.`}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void api(`/api/v1/competitions/${params.id}/publish`, { method: "POST" }).then(load)}
            >
              Publish
            </Button>
            <Button type="button" onClick={() => void api(`/api/v1/competitions/${params.id}/complete`, { method: "POST" }).then(load)}>
              Complete and freeze
            </Button>
          </>
        }
      />
      <StatusBadge status={data.competition.status} />
      {!data.leaderboard.enabled ? (
        <p className="muted">Leaderboard is not shown ({data.leaderboard.reason ?? "disabled"}).</p>
      ) : (
        <ol className="queue-list">
          {data.leaderboard.entries.map((entry) => (
            <li key={`${entry.entryType}-${entry.rank}`}>
              <strong>
                {entry.rank}. {entry.displayName ?? "Rank only"}
              </strong>
              <span className="muted">{entry.score}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
