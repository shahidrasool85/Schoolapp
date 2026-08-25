"use client";

import Link from "next/link";
import { PageHeader, SectionCard } from "../../../components/ui";

export default function ReportsHubPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Operational extracts from canonical school records. Not a BI dashboard."
      />
      <div className="stat-grid">
        <SectionCard title="Pupils" description="On-roll pupil list with year group, class, and leaving dates.">
          <p className="toolbar"><Link href="/school/reports/pupils">Open pupil roll</Link></p>
        </SectionCard>
        <SectionCard title="Attendance" description="Sessions possible, present, authorised, unauthorised, and late.">
          <p className="toolbar"><Link href="/school/reports/attendance">Open attendance summary</Link></p>
        </SectionCard>
        <SectionCard title="Admissions" description="Joiners, leavers, and enrolment status for a date range.">
          <p className="toolbar"><Link href="/school/reports/admissions">Open admissions report</Link></p>
        </SectionCard>
        <SectionCard title="SEND" description="Statutory SEND provision. Requires additional-needs permission.">
          <p className="toolbar"><Link href="/school/reports/send">Open SEND report</Link></p>
        </SectionCard>
        <SectionCard title="Statutory" description="Data quality and census snapshot workspace.">
          <p className="toolbar"><Link href="/school/statutory">Open statutory data</Link></p>
        </SectionCard>
        <SectionCard title="Exports" description="Recent permission-checked CSV and XML downloads.">
          <p className="toolbar"><Link href="/school/reports/exports">Open export history</Link></p>
        </SectionCard>
      </div>
    </>
  );
}
