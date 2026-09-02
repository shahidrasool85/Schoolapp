"use client";

import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import { formatMinor } from "../../../lib/money";

type StudentFinance = {
  enabled: boolean;
  invoices: Array<{
    id: string;
    reference: string;
    status: string;
    dueDate: string;
    totalMinor: number;
    outstandingMinor: number;
    currency: string;
  }>;
};

export default function StudentFinancePage() {
  const [data, setData] = useState<StudentFinance | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<StudentFinance>("/api/v1/student/finance")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Finance is not available.")));
  }, []);

  if (error) return <PageError title="Finance unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading…" />;

  if (!data.enabled) {
    return (
      <>
        <PageHeader title="My fees" description="This school keeps fee information in the parent portal." />
        <EmptyState
          title="Not shown in the student portal"
          description="Parents can view invoices, receipts and payments. School administrators can turn on student fee visibility later if needed."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My fees"
        description="Only invoices that apply to you. Family payment and sibling details are not shown here."
      />
      {data.invoices.length === 0 ? (
        <EmptyState title="No invoices" description="When the school issues a fee that applies to you, it will appear here." />
      ) : (
        <ul className="plain-list">
          {data.invoices.map((invoice) => (
            <li key={invoice.id}>
              {invoice.reference} <StatusBadge status={invoice.status} /> due {invoice.dueDate} ·{" "}
              {formatMinor(invoice.totalMinor, invoice.currency)}
              {invoice.outstandingMinor > 0 ? ` · outstanding ${formatMinor(invoice.outstandingMinor, invoice.currency)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
