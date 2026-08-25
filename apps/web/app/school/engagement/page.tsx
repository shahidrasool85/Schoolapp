"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Overview = {
  settings: { rewardsEnabled: boolean; competitionsEnabled: boolean; earlyLearningEnabled: boolean; leaderboardsEnabled: boolean };
  recentRewards: Array<{ id: string; title: string; studentName: string | null; awardedAt: string }>;
};

export default function EngagementOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/v1/engagement/overview")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load engagement.")));
  }, []);

  if (error) return <PageError title="Engagement unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading engagement…" />;

  return (
    <>
      <PageHeader
        title="Engagement"
        description="Rewards, achievements, competitions, and early-learning practice. This is not a social network."
        actions={
          <Link className="button" href="/school/engagement/rewards">
            Award reward
          </Link>
        }
      />
      <div className="stat-grid">
        <StatCard label="Rewards" value={data.settings.rewardsEnabled ? "On" : "Off"} href="/school/engagement/rewards" />
        <StatCard label="Early learning" value={data.settings.earlyLearningEnabled ? "On" : "Off"} href="/school/engagement/learning" />
        <StatCard label="Competitions" value={data.settings.competitionsEnabled ? "On" : "Off"} href="/school/engagement/competitions" />
        <StatCard label="Leaderboards" value={data.settings.leaderboardsEnabled ? "On" : "Off"} href="/school/engagement/settings" />
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Recent rewards" actions={<Link href="/school/engagement/rewards">All rewards</Link>}>
          {data.recentRewards.length === 0 ? (
            <EmptyState title="No rewards yet" description="Award recognition to assigned pupils." />
          ) : (
            <ul className="queue-list">
              {data.recentRewards.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span className="muted">{row.studentName}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Shortcuts">
          <div className="cards">
            <Link className="card" href="/school/engagement/learning">
              <strong>Early learning</strong>
              <p className="muted">Create and assign practice activities.</p>
            </Link>
            <Link className="card" href="/school/engagement/competitions">
              <strong>Competitions</strong>
              <p className="muted">House and class challenges with privacy controls.</p>
            </Link>
            <Link className="card" href="/school/engagement/settings">
              <strong>Settings</strong>
              <p className="muted">Year-group policy and leaderboard privacy.</p>
            </Link>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
