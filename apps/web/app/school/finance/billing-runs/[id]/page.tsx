"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Alert,
  ConfirmationDialog,
  DataTable,
  LoadingState,
  PageError,
  PageHeader,
  StatusBadge,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor } from "../../../../../lib/money";
import { FinanceNav } from "../../finance-nav";

type Bundle = {
  run: {
    id: string;
    reference: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    expectedTotalMinor: number;
    currency: string;
    warningCount: number;
  };
  items: Array<{
    id: string;
    studentProfileId: string;
    legalName: string;
    standardAmountMinor: number;
    discountTotalMinor: number;
    netAmountMinor: number;
    currency: string;
    siblingPosition: number | null;
    warning: string | null;
    invoiceId: string | null;
    calculation: { feeScheduleName?: string; applied?: Array<{ name: string; calculatedMinor: number }> };
  }>;
};

export default function BillingRunDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const body = await api<Bundle>(`/api/v1/finance/billing-runs/${params.id}`);
    setData(body);
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load this billing run.")));
  }, [params.id]);

  async function confirm() {
    setBusy(true);
    try {
      await api(`/api/v1/finance/billing-runs/${params.id}/confirm`, { method: "POST", body: "{}" });
      await reload();
      setConfirmOpen(false);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not confirm the billing run."));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <PageError title="Billing run unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading billing run…" />;

  return (
    <>
      <PageHeader
        title={data.run.reference}
        description={`${data.run.periodStart} to ${data.run.periodEnd}. Confirming issues invoices; a second confirm for the same period will not create duplicates.`}
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/billing-runs", label: "Billing runs" },
          { label: data.run.reference },
        ]}
        actions={
          data.run.status === "previewed" ? (
            <button type="button" onClick={() => setConfirmOpen(true)}>
              Confirm and issue invoices
            </button>
          ) : null
        }
      />
      <FinanceNav />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p>
        <StatusBadge status={data.run.status} /> Expected {formatMinor(data.run.expectedTotalMinor, data.run.currency)}
        {data.run.warningCount ? ` · ${data.run.warningCount} warnings` : ""}
      </p>
      <DataTable
        headers={
          <>
            <th>Pupil</th>
            <th>Standard</th>
            <th>Discounts</th>
            <th>Net</th>
            <th>Notes</th>
          </>
        }
      >
        {data.items.map((item) => (
          <tr key={item.id}>
            <td>
              <Link href={`/school/finance/pupils/${item.studentProfileId}`}>{item.legalName}</Link>
              {item.siblingPosition ? ` · sibling ${item.siblingPosition}` : ""}
            </td>
            <td>{formatMinor(item.standardAmountMinor, item.currency)}</td>
            <td>
              {item.calculation.applied?.map((discount) => (
                <div key={discount.name}>
                  {discount.name} −{formatMinor(discount.calculatedMinor, item.currency)}
                </div>
              )) ?? formatMinor(item.discountTotalMinor, item.currency)}
            </td>
            <td>{formatMinor(item.netAmountMinor, item.currency)}</td>
            <td>
              {item.warning ?? item.calculation.feeScheduleName ?? "—"}
              {item.invoiceId ? (
                <>
                  {" "}
                  <Link href={`/school/finance/invoices/${item.invoiceId}`}>Invoice</Link>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </DataTable>
      <ConfirmationDialog
        open={confirmOpen}
        title="Issue invoices for this period?"
        description="This creates one family invoice per billing account. Running the same period again will reuse existing invoices."
        confirmLabel={busy ? "Issuing…" : "Confirm generation"}
        onConfirm={confirm}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
