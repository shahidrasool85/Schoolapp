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
      <div className="cards">
        <div className="card">
          <span>Assessments</span>
          <strong><Link href="/school/assessment/assessments">Open</Link></strong>
        </div>
        <div className="card">
          <span>Results</span>
          <strong><Link href="/school/assessment/results">Enter</Link></strong>
        </div>
        <div className="card">
          <span>Reports</span>
          <strong><Link href="/school/assessment/reports">Open</Link></strong>
        </div>
        <div className="card">
          <span>Reporting periods</span>
          <strong><Link href="/school/assessment/periods">Configure</Link></strong>
        </div>
      </div>
    </>
  );
}
