"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, DataTable, EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor, poundsToMinor } from "../../../../lib/money";
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

export default function FeeSchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [years, setYears] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      await api("/api/v1/finance/fee-schedules", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          academicYearId: form.get("academicYearId"),
          yearGroupId: form.get("yearGroupId") || null,
          amountMinor: poundsToMinor(String(form.get("amount") || "0")),
          annualAmountMinor: String(form.get("annual") || "") ? poundsToMinor(String(form.get("annual"))) : null,
          billingFrequency: form.get("frequency"),
          instalmentCount: form.get("instalments") ? Number(form.get("instalments")) : null,
          effectiveFrom: form.get("effectiveFrom"),
          description: form.get("description") || null,
        }),
      });
      event.currentTarget.reset();
      setMessage("Fee schedule saved. Later edits will not change invoices already issued.");
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not create the schedule."));
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
      <SectionCard title="Create schedule">
        <form className="stack" onSubmit={create}>
          <label>
            Name
            <input name="name" required placeholder="Year 5 2026/27 monthly" />
          </label>
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
            <input name="effectiveFrom" type="date" required defaultValue="2026-09-01" />
          </label>
          <label>
            Description
            <textarea name="description" />
          </label>
          <button type="submit">Create schedule</button>
        </form>
      </SectionCard>
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
              <td>{schedule.name}</td>
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
