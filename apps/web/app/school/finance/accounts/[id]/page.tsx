"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DataTable, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor } from "../../../../../lib/money";
import { FinanceNav } from "../../finance-nav";

type Bundle = {
  account: { id: string; name: string; outstandingMinor: number; primaryPayerName: string | null };
  pupils: Array<{ student_profile_id: string; legal_name: string }>;
  invoices: Array<{
    id: string;
    reference: string;
    status: string;
    totalMinor: number;
    outstandingMinor: number;
    currency: string;
    dueDate: string;
  }>;
};

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Bundle>(`/api/v1/finance/accounts/${params.id}`)
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load this family account.")));
  }, [params.id]);

  if (error) return <PageError title="Account unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading family account…" />;

  return (
    <>
      <PageHeader
        title={data.account.name}
        description={`Outstanding ${formatMinor(data.account.outstandingMinor, "GBP")}${data.account.primaryPayerName ? ` · ${data.account.primaryPayerName}` : ""}`}
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/accounts", label: "Families" },
          { label: data.account.name },
        ]}
      />
      <FinanceNav />
      <SectionCard title="Pupils">
        <ul className="plain-list">
          {data.pupils.map((pupil) => (
            <li key={pupil.student_profile_id}>
              <Link href={`/school/finance/pupils/${pupil.student_profile_id}`}>{pupil.legal_name}</Link>
            </li>
          ))}
        </ul>
      </SectionCard>
      <DataTable
        headers={
          <>
            <th>Invoice</th>
            <th>Due</th>
            <th>Total</th>
            <th>Outstanding</th>
            <th>Status</th>
          </>
        }
      >
        {data.invoices.map((invoice) => (
          <tr key={invoice.id}>
            <td>
              <Link href={`/school/finance/invoices/${invoice.id}`}>{invoice.reference}</Link>
            </td>
            <td>{invoice.dueDate}</td>
            <td>{formatMinor(invoice.totalMinor, invoice.currency)}</td>
            <td>{formatMinor(invoice.outstandingMinor, invoice.currency)}</td>
            <td>
              <StatusBadge status={invoice.status} />
            </td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
