"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  captureSubmitTarget,
  feeScheduleAnnualMatchesInstalments,
  feeScheduleCreateSummary,
  formatGbpMinor,
  parseGbpPoundsToMinor,
  resetFormSafely,
} from "@schoolapp/domain";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { usePermissions } from "../../../../lib/use-permissions";
import { FinanceNav } from "../finance-nav";

type Schedule = {
  id: string;
  name: string;
  academicYearName: string | null;
  yearGroupName: string | null;
  amountMinor: number;
  annualAmountMinor: number | null;
  currency: string;
  billingFrequency: string;
  instalmentCount: number | null;
  isActive: boolean;
  usage?: {
    unused: boolean;
    usedInBillingRun: boolean;
    hasInvoices: boolean;
    ended: boolean;
    archived: boolean;
  };
  overlapWarning: string | null;
};

function fieldString(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function usageLabels(schedule: Schedule): string[] {
  if (!schedule.isActive && schedule.usage?.ended) return ["Ended"];
  if (!schedule.isActive && schedule.usage?.archived) return ["Archived"];
  const labels: string[] = [];
  if (schedule.usage?.hasInvoices) labels.push("Has invoices");
  if (schedule.usage?.usedInBillingRun) labels.push("Used in billing run");
  if (schedule.usage?.unused) labels.push("Unused");
  if (schedule.isActive && labels.length === 0) labels.push("Active");
  return labels;
}

export default function FeeSchedulesPage() {
  const permissions = usePermissions();
  const canManage = permissions.has("finance.fee_schedules.manage");
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [years, setYears] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [annualPounds, setAnnualPounds] = useState("");
  const [instalments, setInstalments] = useState("10");

  const liveSummary = useMemo(() => {
    const annual = parseGbpPoundsToMinor(annualPounds);
    const count = Number(instalments);
    if (!annual.ok || !Number.isInteger(count) || count < 1) return null;
    const summary = feeScheduleCreateSummary({ annualMinor: annual.amount, instalmentCount: count });
    return summary.ok ? summary : { text: summary.error, roundingNote: null, amountPerInstalmentMinor: null };
  }, [annualPounds, instalments]);

  async function reload() {
    const [scheduleBody, yearBody, groupBody] = await Promise.all([
      api<{ schedules: Schedule[] }>("/api/v1/finance/fee-schedules"),
      api<{ academicYears: Array<{ id: string; name: string }> }>("/api/v1/academic-years"),
      api<{ yearGroups: Array<{ id: string; name: string }> }>("/api/v1/year-groups"),
    ]);
    setSchedules(scheduleBody.schedules);
    setYears(yearBody.academicYears);
    setGroups(groupBody.yearGroups);
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load fee schedules.")));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setMessage("");
    setError("");
    setFieldError("");
    const annual = parseGbpPoundsToMinor(fieldString(form, "annual"));
    if (!annual.ok) {
      setFieldError(annual.error);
      return;
    }
    const instalmentsRaw = fieldString(form, "instalments");
    const instalmentCount = Number(instalmentsRaw);
    if (!Number.isInteger(instalmentCount) || instalmentCount < 1 || instalmentCount > 24) {
      setFieldError("Instalments per year must be a whole number between 1 and 24.");
      return;
    }
    const plan = feeScheduleCreateSummary({ annualMinor: annual.amount, instalmentCount });
    if (!plan.ok) {
      setFieldError(plan.error);
      return;
    }
    const annualCheck = feeScheduleAnnualMatchesInstalments({
      amountMinor: plan.amountPerInstalmentMinor,
      instalmentCount,
      annualAmountMinor: annual.amount,
    });
    if (!annualCheck.ok) {
      setFieldError(annualCheck.error);
      return;
    }
    const academicYearId = fieldString(form, "academicYearId");
    if (!academicYearId) {
      setFieldError("Select an academic year.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/finance/fee-schedules", {
        method: "POST",
        body: JSON.stringify({
          name: fieldString(form, "name"),
          academicYearId,
          yearGroupId: fieldString(form, "yearGroupId") || null,
          annualAmountMinor: annual.amount,
          amountMinor: plan.amountPerInstalmentMinor,
          billingFrequency: fieldString(form, "frequency") || "monthly",
          instalmentCount,
          effectiveFrom: fieldString(form, "effectiveFrom"),
          effectiveUntil: fieldString(form, "effectiveUntil") || null,
          description: fieldString(form, "description") || null,
        }),
      });
      resetFormSafely(formEl);
      setAnnualPounds("");
      setInstalments("10");
      setMessage("Fee schedule saved. Later edits will not change invoices already issued.");
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not create the schedule."));
    } finally {
      setSaving(false);
    }
  }

  if (error && !schedules) return <PageError title="Fee schedules unavailable" description={error} />;
  if (!schedules) return <LoadingState label="Loading fee schedules…" />;

  const overlapWarnings = [...new Set(schedules.map((schedule) => schedule.overlapWarning).filter(Boolean))];

  return (
    <>
      <PageHeader
        title="Fee schedules"
        description="Set annual tuition by academic year and year group. The amount per instalment is calculated in pence."
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {fieldError ? <Alert tone="danger">{fieldError}</Alert> : null}
      {overlapWarnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning} Identify unused schedules before deleting. Used schedules must be ended or archived.
        </Alert>
      ))}
      {canManage ? (
        <SectionCard title="Create schedule">
          <form className="stack" onSubmit={create}>
            <label>
              Name
              <input name="name" required placeholder="Year 3 Tuition 2026/27" />
            </label>
            <label>
              Academic year
              <select name="academicYearId" required>
                <option value="">Select academic year</option>
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Year group
              <select name="yearGroupId">
                <option value="">All year groups</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Annual tuition fee (£)
              <input
                name="annual"
                required
                placeholder="6000.00"
                value={annualPounds}
                onChange={(event) => setAnnualPounds(event.target.value)}
              />
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
              Number of instalments
              <input
                name="instalments"
                type="number"
                min={1}
                max={24}
                required
                value={instalments}
                onChange={(event) => setInstalments(event.target.value)}
              />
            </label>
            <p>
              Amount per instalment:{" "}
              <strong>
                {liveSummary && "amountPerInstalmentMinor" in liveSummary && liveSummary.amountPerInstalmentMinor != null
                  ? formatGbpMinor(liveSummary.amountPerInstalmentMinor)
                  : "—"}
              </strong>
            </p>
            {liveSummary ? (
              <Alert tone="info">
                {liveSummary.text}
                {liveSummary.roundingNote ? ` ${liveSummary.roundingNote}` : ""}
              </Alert>
            ) : (
              <p className="muted">Enter the annual fee and instalments to see the charging summary before you save.</p>
            )}
            <label>
              Effective from
              <input name="effectiveFrom" type="date" required />
            </label>
            <label>
              Effective until (optional — leave blank unless this is a replacement that ends)
              <input name="effectiveUntil" type="date" />
            </label>
            <label>
              Description
              <textarea name="description" />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create schedule"}
            </button>
          </form>
        </SectionCard>
      ) : (
        <p className="muted">Fee schedules are managed by school finance administrators.</p>
      )}
      {schedules.length === 0 ? (
        <EmptyState title="No schedules yet" description="Create a schedule before running billing." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Name</th>
              <th>Year</th>
              <th>Year group</th>
              <th>Annual / instalment</th>
              <th>Frequency</th>
              <th>Usage</th>
            </>
          }
        >
          {schedules.map((schedule) => (
            <tr key={schedule.id}>
              <td>
                <Link href={`/school/finance/fee-schedules/${schedule.id}`}>{schedule.name}</Link>
                {schedule.overlapWarning ? <div className="muted">{schedule.overlapWarning}</div> : null}
              </td>
              <td>{schedule.academicYearName}</td>
              <td>{schedule.yearGroupName ?? "All"}</td>
              <td>
                {schedule.annualAmountMinor != null
                  ? `${formatMinor(schedule.annualAmountMinor, schedule.currency)} / `
                  : ""}
                {formatMinor(schedule.amountMinor, schedule.currency)}
              </td>
              <td>
                {schedule.billingFrequency}
                {schedule.instalmentCount ? ` · ${schedule.instalmentCount} instalments` : ""}
              </td>
              <td>
                {usageLabels(schedule).map((label) => (
                  <StatusBadge key={label} status={label.toLowerCase().replaceAll(" ", "_")} />
                ))}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
