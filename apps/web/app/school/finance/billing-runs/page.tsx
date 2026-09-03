"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { billingRunDisplayStatus, billingRunStatusLabel } from "@schoolapp/domain";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Run = {
  id: string;
  reference: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  previewStatus?: string;
  isStale?: boolean;
  itemCount: number;
  warningCount: number;
  expectedTotalMinor: number;
  currency: string;
};

export default function BillingRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [years, setYears] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ runs: Run[] }>("/api/v1/finance/billing-runs"),
      api<{ academicYears: Array<{ id: string; name: string }> }>("/api/v1/academic-years"),
    ])
      .then(([runBody, yearBody]) => {
        setRuns(runBody.runs);
        setYears(yearBody.academicYears);
      })
      .catch((err: Error) => setError(userFacingError(err, "Could not load billing runs.")));
  }, []);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      const body = await api<{ run: { id: string } }>("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: form.get("academicYearId"),
          frequency: form.get("frequency"),
          periodStart: form.get("periodStart"),
          periodEnd: form.get("periodEnd"),
          dueOn: form.get("dueOn") || null,
          instalmentNumber: form.get("instalmentNumber") ? Number(form.get("instalmentNumber")) : null,
        }),
      });
      setMessage("Preview ready. Review the calculations before confirming.");
      router.push(`/school/finance/billing-runs/${body.run.id}`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not preview the billing run."));
    }
  }

  if (error && !runs) return <PageError title="Billing runs unavailable" description={error} />;
  if (!runs) return <LoadingState label="Loading billing runs…" />;

  return (
    <>
      <PageHeader
        title="Billing runs"
        description="Preview first — a preview never charges parents. Confirming issues invoices. Repeating the same period will not duplicate them."
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      <SectionCard title="Preview a period">
        <form className="stack" onSubmit={preview}>
          <label>
            Academic year
            <select name="academicYearId" required>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frequency
            <select name="frequency" defaultValue="monthly">
              <option value="monthly">Monthly</option>
              <option value="termly">Termly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Period start
            <input name="periodStart" type="date" required defaultValue="2026-09-01" />
          </label>
          <label>
            Period end
            <input name="periodEnd" type="date" required defaultValue="2026-09-30" />
          </label>
          <label>
            Due on
            <input name="dueOn" type="date" />
          </label>
          <label>
            Instalment number
            <input name="instalmentNumber" type="number" min={1} placeholder="1" />
          </label>
          <button type="submit">Preview only</button>
        </form>
      </SectionCard>
      {runs.length === 0 ? (
        <EmptyState title="No billing runs" description="Create a preview to see who would be billed and why." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Reference</th>
              <th>Period</th>
              <th>Pupils</th>
              <th>Expected</th>
              <th>Status</th>
            </>
          }
        >
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link href={`/school/finance/billing-runs/${run.id}`}>{run.reference}</Link>
              </td>
              <td>
                {run.periodStart} – {run.periodEnd}
              </td>
              <td>
                {run.itemCount}
                {run.warningCount ? ` · ${run.warningCount} warnings` : ""}
              </td>
              <td>{formatMinor(run.expectedTotalMinor, run.currency)}</td>
              <td>
                <StatusBadge
                  status={billingRunDisplayStatus({
                    status: run.status,
                    isStale: run.isStale,
                    previewStatus: run.previewStatus,
                  })}
                />
                <div className="muted">
                  {billingRunStatusLabel(
                    billingRunDisplayStatus({
                      status: run.status,
                      isStale: run.isStale,
                      previewStatus: run.previewStatus,
                    }),
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
