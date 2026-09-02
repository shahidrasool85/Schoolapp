"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  captureSubmitTarget,
  feeScheduleAnnualMatchesInstalments,
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
};

function fieldString(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
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
    const amount = parseGbpPoundsToMinor(fieldString(form, "amount"));
    if (!amount.ok) {
      setFieldError(amount.error);
      return;
    }
    const annualRaw = fieldString(form, "annual");
    let annualAmountMinor: number | null = null;
    if (annualRaw) {
      const annual = parseGbpPoundsToMinor(annualRaw);
      if (!annual.ok) {
        setFieldError(annual.error);
        return;
      }
      annualAmountMinor = annual.amount;
    }
    const instalmentsRaw = fieldString(form, "instalments");
    const instalmentCount = instalmentsRaw ? Number(instalmentsRaw) : null;
    if (instalmentsRaw && (!Number.isInteger(instalmentCount) || Number(instalmentCount) < 1 || Number(instalmentCount) > 24)) {
      setFieldError("Instalments per year must be a whole number between 1 and 24.");
      return;
    }
    const annualCheck = feeScheduleAnnualMatchesInstalments({
      amountMinor: amount.amount,
      instalmentCount,
      annualAmountMinor,
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
          amountMinor: amount.amount,
          annualAmountMinor,
          billingFrequency: fieldString(form, "frequency") || "monthly",
          instalmentCount,
          effectiveFrom: fieldString(form, "effectiveFrom"),
          description: fieldString(form, "description") || null,
        }),
      });
      resetFormSafely(formEl);
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

  return (
    <>
      <PageHeader
        title="Fee schedules"
        description="Set standard tuition by academic year and year group. Amounts are stored in pence."
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {fieldError ? <Alert tone="danger">{fieldError}</Alert> : null}
      {canManage ? (
        <SectionCard title="Create schedule">
          <form className="stack" onSubmit={create}>
            <label>
              Name
              <input name="name" required placeholder="Year 5 2026/27 monthly" />
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
              Amount per invoice (£)
              <input name="amount" required placeholder="600.00" />
            </label>
            <label>
              Annual total (£, optional)
              <input name="annual" placeholder="6000.00" />
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
              Instalments per year
              <input name="instalments" type="number" min={1} max={24} placeholder="10" />
            </label>
            <label>
              Effective from
              <input name="effectiveFrom" type="date" required />
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
              <th>Amount</th>
              <th>Frequency</th>
              <th>Status</th>
            </>
          }
        >
          {schedules.map((schedule) => (
            <tr key={schedule.id}>
              <td>
                <Link href={`/school/finance/fee-schedules/${schedule.id}`}>{schedule.name}</Link>
              </td>
              <td>{schedule.academicYearName}</td>
              <td>{schedule.yearGroupName ?? "All"}</td>
              <td>{formatMinor(schedule.amountMinor, schedule.currency)}</td>
              <td>
                {schedule.billingFrequency}
                {schedule.instalmentCount ? ` · ${schedule.instalmentCount} instalments` : ""}
              </td>
              <td>
                <StatusBadge status={schedule.isActive ? "active" : "inactive"} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
