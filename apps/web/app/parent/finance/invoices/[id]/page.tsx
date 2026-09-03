"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DataTable, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../../lib/api";
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
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);

  async function reload() {
    setData(await api<Bundle>(`/api/v1/parent/finance/invoices/${params.id}`));
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "This invoice is not available.")));
  }, [params.id]);

  async function pay() {
    if (payingRef.current) return;
    payingRef.current = true;
    setError("");
    setPaying(true);
    try {
      const body = await api<{ checkoutUrl: string }>(`/api/v1/parent/finance/invoices/${params.id}/checkout`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `pay-inv-${params.id}-${Date.now()}` }),
      });
      window.location.href = body.checkoutUrl;
    } catch (err) {
      payingRef.current = false;
      setError(userFacingError(err as Error, "Payment is not available for this invoice."));
      setPaying(false);
    }
  }

  if (error && !data) return <PageError title="Invoice unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading invoice…" />;
  const canPay =
    data.invoice.outstandingMinor > 0 && ["issued", "partially_paid", "overdue"].includes(data.invoice.status);

  return (
    <>
      <PageHeader
        title={data.invoice.reference}
        description={`Due ${data.invoice.dueDate}`}
        breadcrumbs={[
          { href: "/parent/finance", label: "Finance" },
          { label: data.invoice.reference },
        ]}
        actions={
          <>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                downloadAuthenticated(
                  `/api/v1/parent/finance/invoices/${params.id}/pdf`,
                  `${data.invoice.reference}.pdf`,
                ).catch((err: Error) => setError(userFacingError(err, "Could not download this invoice.")))
              }
            >
              Download invoice
            </button>
            {canPay ? (
              <button type="button" onClick={() => void pay()} disabled={paying}>
                {paying ? "Opening payment…" : "Pay now"}
              </button>
            ) : null}
          </>
        }
      />
      {error ? <p className="error">{error}</p> : null}
      <p>
        <StatusBadge status={data.invoice.status} /> Total {formatMinor(data.invoice.totalMinor, data.invoice.currency)} ·
        Paid {formatMinor(data.invoice.paidMinor, data.invoice.currency)} · Credits{" "}
        {formatMinor(data.invoice.creditTotalMinor, data.invoice.currency)} · Outstanding{" "}
        {formatMinor(data.invoice.outstandingMinor, data.invoice.currency)}
      </p>
      <p className="muted">
        Payment confirmation comes from the school payment provider, not from this page returning after checkout.
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
