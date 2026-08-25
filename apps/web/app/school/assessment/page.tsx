"use client";

import Link from "next/link";
import { Card, PageHeader } from "../../../components/ui";

export default function AssessmentHubPage() {
  return (
    <>
      <PageHeader
        title="Assessment & Progress"
        description="Formal assessments, result entry, and progress reports. Separate from Teaching & Learning assignment marks."
        actions={
          <Link className="button" href="/school/assessment/assessments/new">
            Create assessment
          </Link>
        }
      />
      <div className="cards">
        <Card href="/school/assessment/assessments">
          <strong>Assessments</strong>
          <p>Create and manage formal assessments.</p>
        </Card>
        <Card href="/school/assessment/results">
          <strong>Results</strong>
          <p>Enter and review recorded results.</p>
        </Card>
        <Card href="/school/assessment/reports">
          <strong>Reports</strong>
          <p>Draft, review, and publish progress reports.</p>
        </Card>
        <Card href="/school/assessment/periods">
          <strong>Reporting periods</strong>
          <p>Configure the academic reporting calendar.</p>
        </Card>
      </div>
    </>
  );
}
