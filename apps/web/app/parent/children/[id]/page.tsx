"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../../../../lib/api";
import { ComingLaterCard } from "../../../../components/coming-later";
import type { ComingLater, PortalChild } from "../../../../lib/portal";

type Detail = {
  child: PortalChild;
  sections: Record<string, ComingLater>;
};

const SECTION_LABELS: Array<{ key: string; title: string }> = [
  { key: "attendance", title: "Attendance" },
  { key: "homework", title: "Homework" },
  { key: "results", title: "Results" },
  { key: "teacherFeedback", title: "Teacher feedback" },
  { key: "reports", title: "Reports" },
  { key: "achievements", title: "Achievements" },
  { key: "activities", title: "Activities" },
  { key: "competitions", title: "Competitions" },
];

export default function ParentChildDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    api<Detail>(`/api/v1/parent/children/${params.id}`)
      .then(setData)
      .catch((err: Error) => {
        setError(err instanceof ApiError && err.status === 404 ? "Child not found." : err.message);
      });
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const child = data.child;

  return (
    <>
      <h1>{child.displayName}</h1>
      <p className="muted">{child.school.name}</p>
      <div className="card">
        <dl className="profile-list">
          <div>
            <dt>Legal name</dt>
            <dd>{child.legalName}</dd>
          </div>
          <div>
            <dt>Preferred name</dt>
            <dd>{child.preferredName ?? "—"}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{child.dateOfBirth ?? "—"}</dd>
          </div>
          <div>
            <dt>Academic year</dt>
            <dd>{child.currentAcademicYearName ?? "—"}</dd>
          </div>
          <div>
            <dt>Year group</dt>
            <dd>{child.currentYearGroupName ?? "—"}</dd>
          </div>
          <div>
            <dt>Form / class</dt>
            <dd>{child.currentFormClassName ?? "—"}</dd>
          </div>
          <div>
            <dt>House</dt>
            <dd>{child.houseName ?? "—"}</dd>
          </div>
          <div>
            <dt>Enrolment</dt>
            <dd>{child.enrolmentStatus}</dd>
          </div>
          {child.guardianship ? (
            <div>
              <dt>Your relationship</dt>
              <dd>
                {child.guardianship.relationship}
                {child.guardianship.hasParentalResponsibility ? " · parental responsibility" : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <h2>Coming later</h2>
      <div className="cards">
        {SECTION_LABELS.map((section) => (
          <ComingLaterCard
            key={section.key}
            title={section.title}
            message={data.sections[section.key]?.message ?? "Coming in a later phase."}
          />
        ))}
      </div>
    </>
  );
}
