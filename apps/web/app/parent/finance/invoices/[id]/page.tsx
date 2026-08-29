"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DataTable, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor } from "../../../../../lib/money";

type Bundle = {
  invoice: {
    reference: string;
    status: string;
    dueDate: string;
    totalMinor: number;
    paidMinor: number;
    creditTotalMinor: number;
    outstandingMinor: number;
    currency: string;
    paymentInstructions: string | null;
  };
  lines: Array<{ id: string; description: string; studentLegalName: string | null; amountMinor: number }>;
};

export default function ParentInvoicePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Bundle>(`/api/v1/parent/finance/invoices/${params.id}`)
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "This invoice is not available.")));
  }, [params.id]);

  if (error) return <PageError title="Invoice unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading invoice…" />;

  return (
    <>
      <PageHeader
        title={data.invoice.reference}
        description={`Due ${data.invoice.dueDate}`}
        breadcrumbs={[
          { href: "/parent/finance", label: "Finance" },
          { label: data.invoice.reference },
        ]}
      />
      <p>
        <StatusBadge status={data.invoice.status} /> Total {formatMinor(data.invoice.totalMinor, data.invoice.currency)} ·
        Paid {formatMinor(data.invoice.paidMinor, data.invoice.currency)} · Credits{" "}
        {formatMinor(data.invoice.creditTotalMinor, data.invoice.currency)} · Outstanding{" "}
        {formatMinor(data.invoice.outstandingMinor, data.invoice.currency)}
      </p>
      <DataTable
        headers={
          <>
            <th>Item</th>
            <th>Pupil</th>
            <th>Amount</th>
          </>
        }
      >
        {data.lines.map((line) => (
          <tr key={line.id}>
            <td>{line.description}</td>
            <td>{line.studentLegalName ?? "—"}</td>
            <td>{formatMinor(line.amountMinor, data.invoice.currency)}</td>
          </tr>
        ))}
      </DataTable>
      {data.invoice.paymentInstructions ? <p>{data.invoice.paymentInstructions}</p> : null}
    </>
  );
}
