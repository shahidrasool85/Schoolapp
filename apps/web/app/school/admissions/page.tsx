"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingState, PageError, PageHeader, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Dashboard = {
  counts: {
    newEnquiries: number;
    applicationsStarted: number;
    applicationsSubmitted: number;
    awaitingReview: number;
    assessmentsDue: number;
    waitingList: number;
    offersMade: number;
    offersAwaitingResponse: number;
    offersAccepted: number;
    rejected: number;
    withdrawn: number;
    recentlyEnrolled: number;
  };
  links: Record<string, string>;
};

const CARDS: Array<{ key: keyof Dashboard["counts"]; label: string; href: string }> = [
  { key: "newEnquiries", label: "New enquiries", href: "/school/admissions/enquiries?status=open" },
  { key: "applicationsStarted", label: "Applications started", href: "/school/admissions/applications?status=draft" },
  { key: "applicationsSubmitted", label: "Applications submitted", href: "/school/admissions/applications?status=submitted" },
  { key: "awaitingReview", label: "Awaiting review", href: "/school/admissions/applications?status=under_review" },
  { key: "assessmentsDue", label: "Assessments / interviews due", href: "/school/admissions/assessments?status=scheduled" },
  { key: "waitingList", label: "Waiting list", href: "/school/admissions/waiting-list" },
  { key: "offersMade", label: "Offers made", href: "/school/admissions/offers?status=made" },
  { key: "offersAwaitingResponse", label: "Offers awaiting response", href: "/school/admissions/offers?status=made" },
  { key: "offersAccepted", label: "Offers accepted", href: "/school/admissions/offers?status=accepted" },
  { key: "rejected", label: "Rejected", href: "/school/admissions/applications?status=rejected" },
  { key: "withdrawn", label: "Withdrawn", href: "/school/admissions/applications?status=withdrawn" },
  { key: "recentlyEnrolled", label: "Recently enrolled", href: "/school/admissions/applications?status=enrolled" },
];

export default function AdmissionsDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Dashboard>("/api/v1/admissions/dashboard")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load admissions.")));
  }, []);

  if (error) return <PageError description={error} />;
  if (!data) return <LoadingState label="Loading admissions…" />;

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Enquiry through to enrolment. Public forms and staff-entered records use the same workflow. An applicant is not an enrolled pupil until conversion."
        actions={
          <>
            <Link className="button" href="/school/admissions/applications">
              Applications
            </Link>
            <Link className="button secondary" href="/school/admissions/forms">
              Public forms
            </Link>
          </>
        }
      />
      <div className="stat-grid">
        {CARDS.map((card) => (
          <StatCard key={card.key} label={card.label} value={data.counts[card.key]} href={card.href} />
        ))}
      </div>
    </>
  );
}
