"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, Tabs } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";

type Reward = { id: string; title: string; pupilMessage: string | null; points: number | null; awardedAt: string; categoryName: string | null };
type Achievement = { id: string; title: string; description: string | null };
type Practice = { assignmentId: string; title: string; latestAttempt: { completionState: string } | null };
type Progress = {
  xp: number | null;
  rewardPoints: number | null;
  activitiesCompleted: number;
  achievements: Achievement[];
  parentAssistedMode: boolean;
};

export default function ParentChildEngagementPage() {
  const params = useParams<{ id: string }>();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [practice, setPractice] = useState<Practice[]>([]);
  const [parentAssisted, setParentAssisted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    api<{ progress: Progress; practice: Practice[]; rewards: Reward[]; parentAssistedMode: boolean }>(
      `/api/v1/parent/children/${params.id}/engagement`,
    )
      .then((body) => {
        setProgress(body.progress);
        setRewards(body.rewards);
        setPractice(body.practice);
        setParentAssisted(Boolean(body.parentAssistedMode));
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load this child's rewards.")));
  }, [params.id]);

  if (error) return <PageError title="Engagement unavailable" description={error} />;
  if (!progress) return <LoadingState label="Loading progress…" />;

  return (
    <>
      <PageHeader title="Rewards & learning" description="Positive recognition and practice for this child. Internal teacher notes are not shown." />
      <Tabs>
        <Link href={`/parent/children/${params.id}`}>Overview</Link>
        <Link href={`/parent/children/${params.id}/timetable`}>Timetable</Link>
        <Link href={`/parent/children/${params.id}/learning`}>Learning</Link>
        <Link href={`/parent/children/${params.id}/engagement`} aria-current="page">
          Rewards
        </Link>
        <Link href={`/parent/children/${params.id}/results`}>Results</Link>
        <Link href={`/parent/children/${params.id}/reports`}>Reports</Link>
      </Tabs>
      <div className="stat-grid">
        <StatCard label="Rewards" value={rewards.length} />
        <StatCard label="Achievements" value={progress.achievements.length} />
        <StatCard label="Activities completed" value={progress.activitiesCompleted} />
        {progress.xp != null ? <StatCard label="Learning XP" value={progress.xp} /> : null}
        {progress.rewardPoints != null ? <StatCard label="Reward points" value={progress.rewardPoints} /> : null}
      </div>
      <div className="dash-grid" style={{ marginTop: "1rem" }}>
        <SectionCard title="Recent recognition">
          {rewards.length === 0 ? (
            <EmptyState title="No rewards yet" description="Teacher recognition for this child will appear here." />
          ) : (
            <ul className="queue-list">
              {rewards.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {row.categoryName ?? "Reward"}
                    {row.points != null ? ` · ${row.points} points` : ""}
                  </span>
                  {row.pupilMessage ? <span className="muted">{row.pupilMessage}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Achievements">
          {progress.achievements.length === 0 ? (
            <EmptyState title="No achievements yet" description="Badges earned by this child will appear here." />
          ) : (
            <ul className="queue-list">
              {progress.achievements.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span className="muted">{row.description}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      {parentAssisted ? (
        <SectionCard title="Learning with this child" description="You are helping as a parent. This does not sign you in as the pupil.">
          {practice.length === 0 ? (
            <EmptyState title="No practice assigned" description="When teachers assign early-learning activities, you can launch them here." />
          ) : (
            <ul className="queue-list">
              {practice.map((row) => (
                <li key={row.assignmentId}>
                  <Link href={`/parent/children/${params.id}/play/${row.assignmentId}`}>
                    <strong>{row.title}</strong>
                    <span className="muted">{row.latestAttempt?.completionState ?? "Ready"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : (
        <p className="muted">Parent-assisted practice is not enabled for this year group. Your child can complete practice in the student portal when it is assigned.</p>
      )}
    </>
  );
}
