"use client";

import Link from "next/link";

export default function AssessmentHubPage() {
  return (
    <>
      <h1>Assessment &amp; Progress</h1>
      <p className="muted">
        Formal assessments, result entry, and progress reports. Separate from Teaching &amp; Learning
        assignment marks.
      </p>
      <div className="stat-grid">
        <Link className="stat-card" href="/school/assessment/assessments">
          <span>Assessments</span>
          <strong>Open</strong>
        </Link>
        <Link className="stat-card" href="/school/assessment/results">
          <span>Results</span>
          <strong>Enter</strong>
        </Link>
        <Link className="stat-card" href="/school/assessment/reports">
          <span>Reports</span>
          <strong>Open</strong>
        </Link>
        <Link className="stat-card" href="/school/assessment/periods">
          <span>Reporting periods</span>
          <strong>Configure</strong>
        </Link>
      </div>
    </>
  );
}
