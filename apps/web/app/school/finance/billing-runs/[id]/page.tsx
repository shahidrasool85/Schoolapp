"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  billingRunDisplayStatus,
  billingRunItemExclusionReason,
  billingRunItemIsIncluded,
  billingRunStatusLabel,
  formatUkNumericDate,
  formatUkNumericDateRange,
} from "@schoolapp/domain";
import {
  Alert,
  ConfirmationDialog,
  DataTable,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor } from "../../../../../lib/money";
import { FinanceNav } from "../../finance-nav";

function BillingRunItemRow({ item }: { item: Bundle["items"][number] }) {
  return (
    <tr>
      <td>
        <Link href={`/school/finance/pupils/${item.studentProfileId}`}>{item.legalName}</Link>
        {item.siblingPosition ? <div className="muted">Sibling {item.siblingPosition}</div> : null}
      </td>
      <td>{item.yearGroupName ?? "—"}</td>
      <td>{item.className ?? "—"}</td>
      <td>{item.feeScheduleName ?? item.calculation.feeScheduleName ?? "—"}</td>
      <td>
        {item.annualFeeLabel
          ? item.annualFeeLabel
          : item.annualAmountMinor != null
            ? formatMinor(item.annualAmountMinor, item.currency)
            : "—"}
      </td>
      <td>
        {item.instalmentLabel ??
          (item.instalmentNumber && item.instalmentCount
            ? `${item.instalmentNumber} of ${item.instalmentCount}`
            : item.instalmentNumber
              ? String(item.instalmentNumber)
              : "—")}
      </td>
      <td>{formatMinor(item.amountPerInstalmentMinor ?? item.standardAmountMinor, item.currency)}</td>
      <td>
        {formatMinor(item.discountTotalMinor, item.currency)}
        {item.calculation.applied?.map((discount) => (
          <div key={discount.name} className="muted">
            {discount.name} −{formatMinor(discount.calculatedMinor, item.currency)}
          </div>
        ))}
      </td>
      <td>
        <strong>{formatMinor(item.netAmountMinor, item.currency)}</strong>
      </td>
      <td>{formatUkNumericDateRange(item.periodStart, item.periodEnd)}</td>
      <td>
        {item.dueOn ? formatUkNumericDate(item.dueOn) : "—"}
        {item.warning ? <div className="muted">{item.warning}</div> : null}
        {item.invoiceId ? (
          <div>
            <Link href={`/school/finance/invoices/${item.invoiceId}`}>Invoice</Link>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

type Bundle = {
  run: {
    id: string;
    reference: string;
    status: string;
    previewStatus?: string;
    isStale?: boolean;
    periodStart: string;
    periodEnd: string;
    dueOn: string;
    academicYearId: string;
    billingFrequency: string;
    instalmentNumber: number | null;
    expectedTotalMinor: number;
    currency: string;
    warningCount: number;
  };
  confirmSummary?: {
    pupilCount: number;
    invoiceCount: number;
    totalMinor: number;
  };
  items: Array<{
    id: string;
    studentProfileId: string;
    legalName: string;
    yearGroupName: string | null;
    className: string | null;
    feeScheduleName: string | null;
    annualAmountMinor: number | null;
    instalmentNumber: number | null;
    instalmentCount: number | null;
    instalmentLabel?: string;
    annualFeeLabel?: string | null;
    amountPerInstalmentMinor: number | null;
    periodStart: string;
    periodEnd: string;
    dueOn: string | null;
    standardAmountMinor: number;
    discountTotalMinor: number;
    netAmountMinor: number;
    currency: string;
    siblingPosition: number | null;
    warning: string | null;
    error?: string | null;
    invoiceId: string | null;
    included?: boolean;
    exclusionReason?: string | null;
    calculation: { feeScheduleName?: string; applied?: Array<{ name: string; calculatedMinor: number }> };
  }>;
  includedItems?: Array<Bundle["items"][number]>;
  excludedItems?: Array<Bundle["items"][number]>;
};

export default function BillingRunDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const body = await api<Bundle>(`/api/v1/finance/billing-runs/${params.id}`);
    setData(body);
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load this billing run.")));
  }, [params.id]);

  async function refreshPreview() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: data.run.academicYearId,
          frequency: data.run.billingFrequency,
          periodStart: data.run.periodStart,
          periodEnd: data.run.periodEnd,
          dueOn: data.run.dueOn,
          instalmentNumber: data.run.instalmentNumber,
        }),
      });
      setNotice("Preview recalculated. Review the figures before confirming.");
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not refresh this preview."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!data || busy) return;
    const stale = Boolean(data.run.isStale) || data.run.status === "stale" || data.run.previewStatus === "stale";
    if (stale) {
      setError("This preview is stale. Refresh and review again before confirming.");
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/finance/billing-runs/${params.id}/confirm`, { method: "POST", body: "{}" });
      await reload();
      setConfirmOpen(false);
      setNotice("Invoices issued. Repeating confirm for this period will not create duplicates.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not confirm the billing run."));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <PageError title="Billing run unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading billing run…" />;

  const displayStatus = billingRunDisplayStatus({
    status: data.run.status,
    isStale: data.run.isStale,
    previewStatus: data.run.previewStatus,
  });
  const stale = displayStatus === "stale";
  const issued = displayStatus === "issued";
  const canConfirm = displayStatus === "preview";
  const included =
    data.includedItems ??
    data.items.filter((item) =>
      item.included ??
      billingRunItemIsIncluded({ error: item.error, netAmountMinor: item.netAmountMinor }),
    );
  const excluded =
    data.excludedItems ??
    data.items.filter(
      (item) =>
        !(
          item.included ??
          billingRunItemIsIncluded({ error: item.error, netAmountMinor: item.netAmountMinor })
        ),
    );
  const summary = data.confirmSummary ?? {
    pupilCount: new Set(included.map((item) => item.studentProfileId)).size,
    invoiceCount: included.length,
    totalMinor: included.reduce((sum, item) => sum + item.netAmountMinor, 0),
  };
  const invoiceWord = summary.invoiceCount === 1 ? "invoice" : "invoices";
  const pupilWord = summary.pupilCount === 1 ? "pupil" : "pupils";

  return (
    <>
      <PageHeader
        title={data.run.reference}
        description={`${formatUkNumericDateRange(data.run.periodStart, data.run.periodEnd)}. ${billingRunStatusLabel(displayStatus)}.`}
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/billing-runs", label: "Billing runs" },
          { label: data.run.reference },
        ]}
        actions={
          canConfirm ? (
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy}>
              Confirm and issue invoices
            </button>
          ) : stale ? (
            <button type="button" onClick={() => void refreshPreview()} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh stale preview"}
            </button>
          ) : null
        }
      />
      <FinanceNav />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {issued ? (
        <Alert tone="success">
          Issued. Family invoices exist for this period. Parents were not charged by the preview — only this confirmed
          run created invoices. Confirming again will not create duplicates.
        </Alert>
      ) : stale ? (
        <Alert tone="warning">
          This preview is stale. Fee schedules or eligible pupils have changed since it was prepared. Refresh and review
          again before confirming — invoices will not be issued from outdated figures. Parents have not been charged.
        </Alert>
      ) : (
        <Alert tone="info">
          This is a preview only. No invoices have been issued and parents have not been charged. Confirming is a
          separate, intentional step.
        </Alert>
      )}
      <p>
        <StatusBadge status={displayStatus} /> {billingRunStatusLabel(displayStatus)} · Expected{" "}
        {formatMinor(data.run.expectedTotalMinor, data.run.currency)}
        {data.run.warningCount ? ` · ${data.run.warningCount} warnings` : ""}
      </p>
      <SectionCard title={issued ? "Included pupils (invoices issued)" : "Included pupils (would be invoiced)"}>
        {included.length === 0 ? (
          <p className="muted">No pupils would be invoiced for this period.</p>
        ) : (
          <DataTable
            headers={
              <>
                <th>Pupil</th>
                <th>Year group</th>
                <th>Class</th>
                <th>Fee schedule</th>
                <th>Annual fee</th>
                <th>Instalment</th>
                <th>Regular instalment</th>
                <th>Discount</th>
                <th>Net</th>
                <th>Period</th>
                <th>Due date</th>
              </>
            }
          >
            {included.map((item) => (
              <BillingRunItemRow key={item.id} item={item} />
            ))}
          </DataTable>
        )}
      </SectionCard>
      <SectionCard title="Excluded pupils">
        {excluded.length === 0 ? (
          <p className="muted">Every eligible pupil in this period is included.</p>
        ) : (
          <DataTable
            headers={
              <>
                <th>Pupil</th>
                <th>Year group</th>
                <th>Class</th>
                <th>Fee schedule</th>
                <th>Reason</th>
              </>
            }
          >
            {excluded.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/school/finance/pupils/${item.studentProfileId}`}>{item.legalName}</Link>
                </td>
                <td>{item.yearGroupName ?? "—"}</td>
                <td>{item.className ?? "—"}</td>
                <td>{item.feeScheduleName ?? item.calculation.feeScheduleName ?? "—"}</td>
                <td>
                  {item.exclusionReason ??
                    billingRunItemExclusionReason({
                      error: item.error,
                      warning: item.warning,
                      netAmountMinor: item.netAmountMinor,
                    })}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
      <SectionCard title={issued ? "Issued invoices" : "Confirmation"}>
        {stale ? (
          <p>
            Confirmation is disabled until this preview is refreshed. The figures above may no longer match the invoices
            that would be issued. Parents have not been charged.
          </p>
        ) : issued ? (
          <p>
            {summary.invoiceCount} {invoiceWord} issued for {summary.pupilCount} {pupilWord}. Total{" "}
            <strong>{formatMinor(summary.totalMinor, data.run.currency)}</strong>. Repeating confirm will not create
            another set.
          </p>
        ) : (
          <>
            <p>
              {summary.pupilCount} {pupilWord} · {summary.invoiceCount} {invoiceWord} will be issued if you confirm.
              Preview does not create invoices.
            </p>
            <p>
              Total: <strong>{formatMinor(summary.totalMinor, data.run.currency)}</strong>
            </p>
            {canConfirm ? (
              <p className="toolbar">
                <button type="button" onClick={() => setConfirmOpen(true)} disabled={busy}>
                  Confirm and issue invoices
                </button>
              </p>
            ) : null}
          </>
        )}
      </SectionCard>
      <ConfirmationDialog
        open={confirmOpen}
        title="Issue invoices for this period?"
        description={`${summary.invoiceCount} ${invoiceWord} will be issued. Total: ${formatMinor(summary.totalMinor, data.run.currency)}. This creates one family invoice per billing account using the figures shown above. Running the same period again will reuse existing invoices.`}
        confirmLabel={busy ? "Issuing…" : "Confirm and issue invoices"}
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </>
  );
}
