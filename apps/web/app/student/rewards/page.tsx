"use client";

import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { optionalApi, userFacingError } from "../../../lib/errors";

type Reward = { id: string; title: string; pupilMessage: string | null; points: number | null; awardedAt: string; categoryName: string | null };
type Achievement = { id: string; title: string; description: string | null; awardedAt: string };

export default function StudentRewardsPage() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [xp, setXp] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ rewards: Reward[] }>("/api/v1/student/rewards"),
      optionalApi<{ achievements: Achievement[]; xp: number | null }>("/api/v1/student/achievements"),
    ])
      .then(([rewardBody, achievementBody]) => {
        setRewards(rewardBody.rewards);
        setAchievements(achievementBody?.achievements ?? []);
        setXp(achievementBody?.xp ?? null);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load your rewards.")));
  }, []);

  if (error) return <PageError title="Rewards unavailable" description={error} />;
  if (!rewards) return <LoadingState label="Loading your rewards…" />;

  return (
    <>
      <PageHeader title="Rewards & achievements" description="Positive recognition from your teachers. This is not a public ranking." />
      <div className="stat-grid">
        <StatCard label="Rewards" value={rewards.length} />
        <StatCard label="Achievements" value={achievements.length} />
        {xp != null ? <StatCard label="Learning XP" value={xp} /> : null}
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Recent rewards">
          {rewards.length === 0 ? (
            <EmptyState title="No rewards yet" description="When a teacher awards you, it will appear here." />
          ) : (
            <ul className="queue-list">
              {rewards.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {row.categoryName ?? "Reward"}
                    {row.points != null ? ` · ${row.points} points` : ""}
                    {` · ${new Date(row.awardedAt).toLocaleDateString("en-GB")}`}
                  </span>
                  {row.pupilMessage ? <span className="muted">{row.pupilMessage}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Achievements">
          {achievements.length === 0 ? (
            <EmptyState title="No achievements yet" description="Complete practice and challenges to earn badges." />
          ) : (
            <ul className="queue-list">
              {achievements.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span className="muted">{row.description}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
