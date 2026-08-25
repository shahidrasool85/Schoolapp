"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";

type BehaviourSummary = {
  incidentsByStatus: Record<string, number>;
  positiveCount: number;
  outstandingFollowUps: number;
};

type PastoralSummary = {
  openConcerns: number;
  outstandingFollowUps: number;
};

export default function PastoralHubPage() {
  const [behaviour, setBehaviour] = useState<BehaviourSummary | null>(null);
  const [pastoral, setPastoral] = useState<PastoralSummary | null>(null);

  useEffect(() => {
    api<BehaviourSummary>("/api/v1/behaviour/summary")
      .then(setBehaviour)
      .catch(() => setBehaviour(null));
    api<PastoralSummary>("/api/v1/pastoral/summary")
      .then(setPastoral)
      .catch(() => setPastoral(null));
  }, []);

  return (
    <>
      <PageHeader
        title="Pastoral & Behaviour"
        description="Incidents, achievements, and pastoral concerns. Safeguarding is a separate, restricted area."
      />
      <div className="stat-grid">
        <StatCard
          label="Open incidents"
          value={(behaviour?.incidentsByStatus.open ?? 0) + (behaviour?.incidentsByStatus.in_progress ?? 0)}
          href="/school/pastoral/behaviour"
        />
        <StatCard label="Achievements" value={behaviour?.positiveCount ?? 0} href="/school/pastoral/achievements" />
        <StatCard label="Open pastoral" value={pastoral?.openConcerns ?? 0} href="/school/pastoral/concerns" />
        <StatCard
          label="Follow-ups"
          value={(behaviour?.outstandingFollowUps ?? 0) + (pastoral?.outstandingFollowUps ?? 0)}
        />
      </div>
      <div className="cards" style={{ marginTop: "1rem" }}>
        <Link className="card" href="/school/pastoral/behaviour">
          <strong>Behaviour</strong>
          <p>Incidents, actions, and follow-up.</p>
        </Link>
        <Link className="card" href="/school/pastoral/achievements">
          <strong>Achievements</strong>
          <p>Praise, merits, and positive records.</p>
        </Link>
        <Link className="card" href="/school/pastoral/concerns">
          <strong>Pastoral</strong>
          <p>Concerns, interventions, and reviews. Confidential notes remain restricted.</p>
        </Link>
      </div>
    </>
  );
}
