"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingState, PageError, PageHeader, StatCard } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";

type Overview = {
  asOf: string;
  dataQuality: { errorCount: number; warningCount: number; informationCount: number };
  onRollCount: number;
  pupilCount: number;
  sendCount: number;
  censusRunCount: number;
  exportCount: number;
  schoolProfileComplete: boolean;
};

export default function StatutoryDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/v1/statutory/overview")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load statutory data.")));
  }, []);

  if (error) return <PageError title="Statutory data unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading statutory workspace…" />;

  return (
    <>
      <PageHeader
        title="Statutory data"
        description="Maintain census-ready pupil and school records. Schoolapp is not a DfE COLLECT submission product."
        actions={
          <Link className="button" href="/school/statutory/census">
            Census workspace
          </Link>
        }
      />
      <div className="stat-grid">
        <StatCard
          label="Data quality errors"
          value={data.dataQuality.errorCount}
          href="/school/statutory/data-quality"
          hint={`${data.dataQuality.warningCount} warnings · ${data.dataQuality.informationCount} notices`}
        />
        <StatCard
          label="Census runs"
          value={data.censusRunCount}
          href="/school/statutory/census"
          hint={data.schoolProfileComplete ? "School identifiers recorded" : "School profile incomplete"}
        />
        <StatCard
          label="Pupils on roll"
          value={data.onRollCount}
          href="/school/reports/pupils"
          hint={`${data.pupilCount} pupil records`}
        />
        <StatCard
          label="SEND classified"
          value={data.sendCount}
          href="/school/reports/send"
          hint="K or E provision only"
        />
        <StatCard
          label="Attendance reports"
          value={data.onRollCount}
          href="/school/reports/attendance"
          hint="On-roll pupils using live registers"
        />
        <StatCard
          label="Exports"
          value={data.exportCount}
          href="/school/reports/exports"
          hint="Audited CSV and XML downloads"
        />
      </div>
      <p className="toolbar">
        <Link href="/school/statutory/data-quality">Data quality</Link>
        <Link href="/school/settings/statutory">School statutory profile</Link>
        <Link href="/school/reports">Reports</Link>
      </p>
    </>
  );
}
