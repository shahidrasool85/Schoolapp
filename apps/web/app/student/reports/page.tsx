"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Report = {
  id: string;
  reportingPeriodName: string | null;
  generalComment: string | null;
  sections: Array<{
    subjectName: string | null;
    attainmentSummary: string | null;
    progressJudgement: string | null;
    teacherComment: string | null;
    targetNextSteps: string | null;
  }>;
};

export default function StudentReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ reports: Report[] }>("/api/v1/student/reports")
      .then((body) => setReports(body.reports))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>My reports</h1>
      {reports.length === 0 ? <p className="muted">No published reports yet.</p> : reports.map((report) => (
        <div key={report.id} className="card" style={{ marginBottom: 16 }}>
          <h2>{report.reportingPeriodName}</h2>
          <p>{report.generalComment}</p>
          {report.sections.map((section, index) => (
            <div key={`${section.subjectName}-${index}`}>
              <strong>{section.subjectName}</strong>
              <p>{section.attainmentSummary}</p>
              <p className="muted">{section.progressJudgement}</p>
              <p>{section.teacherComment}</p>
              {section.targetNextSteps ? <p>Next steps: {section.targetNextSteps}</p> : null}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
