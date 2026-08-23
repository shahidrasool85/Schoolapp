"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
      <h1>Pastoral &amp; Behaviour</h1>
      <p className="muted">Incidents, achievements, and pastoral concerns. Safeguarding is a separate area.</p>
      <div className="cards">
        <div className="card">
          <span>Open incidents</span>
          <strong>{(behaviour?.incidentsByStatus.open ?? 0) + (behaviour?.incidentsByStatus.in_progress ?? 0)}</strong>
        </div>
        <div className="card">
          <span>Achievements</span>
          <strong>{behaviour?.positiveCount ?? 0}</strong>
        </div>
        <div className="card">
          <span>Open pastoral</span>
          <strong>{pastoral?.openConcerns ?? 0}</strong>
        </div>
        <div className="card">
          <span>Follow-ups</span>
          <strong>{(behaviour?.outstandingFollowUps ?? 0) + (pastoral?.outstandingFollowUps ?? 0)}</strong>
        </div>
      </div>
      <div className="cards" style={{ marginTop: 16 }}>
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
          <p>Concerns, interventions, and reviews.</p>
        </Link>
      </div>
    </>
  );
}
