"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  STUDENT_FEE_STATUS_LABELS,
  PARENT_PAYMENT_AVAILABILITY_LABELS,
  formatUkNumericDate,
  studentFeeStatusLabel,
  type StudentFeeStatus,
} from "@schoolapp/domain";
import {
  Alert,
  DataTable,
  EmptyState,
  FilterBar,
  LoadingState,
  PageError,
  PageHeader,
  SearchInput,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { usePermissions } from "../../../../lib/use-permissions";
import { FinanceNav } from "../finance-nav";

type FeesResponse = {
  period: { periodStart: string; periodEnd: string } | null;
  academicYearName: string | null;
  tuitionEnabled: boolean;
  summary: {
    currency: string;
    expectedAnnualFeesMinor: number;
    invoicedMinor: number;
    receivedMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    pupilsWithFees: number;
    pupilsWithOutstanding: number;
    pupilsOverdue: number;
    pupilsNoFeeAssigned: number;
  };
  pupils: Array<{
    studentProfileId: string;
    legalName: string;
    yearGroupId: string | null;
    yearGroupName: string | null;
    classId: string | null;
    className: string | null;
    feeScheduleName: string | null;
    annualFeeMinor: number | null;
    discountMinor: number;
    discountLabel: string | null;
    netAnnualFeeMinor: number | null;
    currentInstalmentMinor: number | null;
    invoicedMinor: number;
    paidMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    nextDueDate: string | null;
    status: StudentFeeStatus;
    parentPaymentAvailability: keyof typeof PARENT_PAYMENT_AVAILABILITY_LABELS;
    warning: string | null;
    currency: string;
  }>;
  missingInvoices: {
    count: number;
    billingRunId: string | null;
    href: string | null;
  };
};

export default function StudentFeesPage() {
  const [data, setData] = useState<FeesResponse | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [yearGroupId, setYearGroupId] = useState("");
  const [classId, setClassId] = useState("");
  const [yearOptions, setYearOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [classOptions, setClassOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [paid, setPaid] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [discounted, setDiscounted] = useState(false);
  const [noFee, setNoFee] = useState(false);
  const [sort, setSort] = useState("name");
  const [busy, setBusy] = useState(false);
  const permissions = usePermissions();
  const canPrepare = permissions.has("finance.billing_runs.manage") || permissions.has("finance.manage");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (yearGroupId) params.set("yearGroupId", yearGroupId);
    if (classId) params.set("classId", classId);
    if (paid) params.set("paid", "true");
    if (unpaid) params.set("unpaid", "true");
    if (overdue) params.set("overdue", "true");
    if (discounted) params.set("discounted", "true");
    if (noFee) params.set("noFeeAssigned", "true");
    if (sort) params.set("sort", sort);
    const qs = params.toString();
    return qs ? `/api/v1/finance/student-fees?${qs}` : "/api/v1/finance/student-fees";
  }, [search, status, yearGroupId, classId, paid, unpaid, overdue, discounted, noFee, sort]);

  useEffect(() => {
    let cancelled = false;
    api<FeesResponse>(query)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setYearOptions((current) => {
          const next = new Map(current.map((row) => [row.id, row.name]));
          for (const row of body.pupils) {
            if (row.yearGroupId && row.yearGroupName) next.set(row.yearGroupId, row.yearGroupName);
          }
          return [...next.entries()].map(([id, name]) => ({ id, name }));
        });
        setClassOptions((current) => {
          const next = new Map(current.map((row) => [row.id, row.name]));
          for (const row of body.pupils) {
            if (row.classId && row.className) next.set(row.classId, row.className);
          }
          return [...next.entries()].map(([id, name]) => ({ id, name }));
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(userFacingError(err, "Could not load student fees."));
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function preparePeriod() {
    setBusy(true);
    setError("");
    try {
      const body = await api<{ run: { id: string } }>("/api/v1/finance/student-fees/prepare-period", {
        method: "POST",
        body: "{}",
      });
      window.location.href = `/school/finance/billing-runs/${body.run.id}`;
    } catch (err) {
      setError(userFacingError(err as Error, "Could not prepare this period's invoices."));
      setBusy(false);
    }
  }

  if (error && !data) return <PageError title="Student fees unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading student fees…" />;

  const currency = data.summary.currency;
  const visible = data.pupils;

  return (
    <>
      <PageHeader
        title="Student fees"
        description="One row per pupil: the fee plan, what has been invoiced, what has been paid, and what is still outstanding."
        actions={
          canPrepare ? (
            <button type="button" onClick={() => void preparePeriod()} disabled={busy}>
              {busy ? "Preparing…" : "Prepare monthly fees"}
            </button>
          ) : null
        }
      />
      <FinanceNav />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {data.missingInvoices.count > 0 ? (
        <Alert tone="warning">
          {data.missingInvoices.count === 1
            ? "1 pupil has not yet been invoiced for an issued period."
            : `${data.missingInvoices.count} pupils have not yet been invoiced for an issued period.`}{" "}
          {data.missingInvoices.href ? <Link href={data.missingInvoices.href}>Review missing invoices</Link> : null}
        </Alert>
      ) : null}
      <div className="stat-grid">
        <StatCard label="Expected annual fees" value={formatMinor(data.summary.expectedAnnualFeesMinor, currency)} />
        <StatCard label="Invoiced" value={formatMinor(data.summary.invoicedMinor, currency)} href="/school/finance/invoices" />
        <StatCard label="Received" value={formatMinor(data.summary.receivedMinor, currency)} href="/school/finance/payments" />
        <StatCard label="Outstanding" value={formatMinor(data.summary.outstandingMinor, currency)} />
        <StatCard label="Overdue" value={formatMinor(data.summary.overdueMinor, currency)} />
        <StatCard
          label="Pupils"
          value={String(data.summary.pupilsWithFees)}
          hint={`${data.summary.pupilsWithOutstanding} outstanding · ${data.summary.pupilsOverdue} overdue`}
        />
      </div>
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search pupil" label="Pupil" />
        <label>
          Year group
          <select value={yearGroupId} onChange={(event) => setYearGroupId(event.target.value)}>
            <option value="">All</option>
            {yearOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Class
          <select value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="">All</option>
            {classOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {Object.entries(STUDENT_FEE_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">Pupil name</option>
            <option value="balance">Outstanding</option>
            <option value="overdue">Overdue</option>
            <option value="nextDue">Next due date</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Paid
        </label>
        <label>
          <input type="checkbox" checked={unpaid} onChange={(event) => setUnpaid(event.target.checked)} /> Unpaid
        </label>
        <label>
          <input type="checkbox" checked={overdue} onChange={(event) => setOverdue(event.target.checked)} /> Overdue
        </label>
        <label>
          <input type="checkbox" checked={discounted} onChange={(event) => setDiscounted(event.target.checked)} /> Discounted
        </label>
        <label>
          <input type="checkbox" checked={noFee} onChange={(event) => setNoFee(event.target.checked)} /> No fee assigned
        </label>
      </FilterBar>
      {visible.length === 0 ? (
        <EmptyState
          title="No matching pupils"
          description={
            data.tuitionEnabled
              ? "Enrol pupils and add a fee schedule for their year group to see fee plans here."
              : "Turn on tuition billing in Finance settings to assign school fees."
          }
        />
      ) : (
        <>
          <div className="student-fees-table">
            <DataTable
              headers={
                <>
                  <th>Pupil</th>
                  <th>Year group</th>
                  <th>Class</th>
                  <th>Annual fee</th>
                  <th>Discount</th>
                  <th>Net annual fee</th>
                  <th>Current instalment</th>
                  <th>Invoiced</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Overdue</th>
                  <th>Next due</th>
                  <th>Status</th>
                  <th>Parent payment</th>
                </>
              }
            >
              {visible.map((row) => (
                <tr key={row.studentProfileId}>
                  <td>
                    <Link href={`/school/finance/pupils/${row.studentProfileId}`}>{row.legalName}</Link>
                  </td>
                  <td>{row.yearGroupName ?? "—"}</td>
                  <td>{row.className ?? "—"}</td>
                  <td>{row.annualFeeMinor == null ? "—" : formatMinor(row.annualFeeMinor, row.currency)}</td>
                  <td>
                    {row.discountMinor > 0 ? formatMinor(row.discountMinor, row.currency) : "—"}
                    {row.discountLabel ? <div className="muted">{row.discountLabel}</div> : null}
                  </td>
                  <td>{row.netAnnualFeeMinor == null ? "—" : formatMinor(row.netAnnualFeeMinor, row.currency)}</td>
                  <td>
                    {row.currentInstalmentMinor == null ? "—" : formatMinor(row.currentInstalmentMinor, row.currency)}
                  </td>
                  <td>{formatMinor(row.invoicedMinor, row.currency)}</td>
                  <td>{formatMinor(row.paidMinor, row.currency)}</td>
                  <td>
                    <strong>{formatMinor(row.outstandingMinor, row.currency)}</strong>
                  </td>
                  <td>{formatMinor(row.overdueMinor, row.currency)}</td>
                  <td>{row.nextDueDate ? formatUkNumericDate(row.nextDueDate) : "—"}</td>
                  <td>
                    <StatusBadge status={row.status} />
                    <span className="visually-hidden">{studentFeeStatusLabel(row.status)}</span>
                  </td>
                  <td>{PARENT_PAYMENT_AVAILABILITY_LABELS[row.parentPaymentAvailability]}</td>
                </tr>
              ))}
            </DataTable>
          </div>
          <div className="student-fees-cards">
            {visible.map((row) => (
              <SectionCard key={row.studentProfileId} title={row.legalName}>
                <p className="muted">
                  {row.yearGroupName ?? "No year group"}
                  {row.className ? ` · ${row.className}` : ""}
                </p>
                <p>
                  <StatusBadge status={row.status} />{" "}
                  {PARENT_PAYMENT_AVAILABILITY_LABELS[row.parentPaymentAvailability]}
                </p>
                <p>
                  Annual {row.annualFeeMinor == null ? "—" : formatMinor(row.annualFeeMinor, row.currency)}
                  {row.discountMinor > 0 ? ` · Discount ${formatMinor(row.discountMinor, row.currency)}` : ""}
                  {row.netAnnualFeeMinor != null ? ` · Net ${formatMinor(row.netAnnualFeeMinor, row.currency)}` : ""}
                </p>
                <p>
                  Invoiced {formatMinor(row.invoicedMinor, row.currency)} · Paid {formatMinor(row.paidMinor, row.currency)}{" "}
                  · Outstanding <strong>{formatMinor(row.outstandingMinor, row.currency)}</strong>
                  {row.overdueMinor > 0 ? ` · Overdue ${formatMinor(row.overdueMinor, row.currency)}` : ""}
                </p>
                <p>
                  <Link href={`/school/finance/pupils/${row.studentProfileId}`}>Open pupil fees</Link>
                </p>
              </SectionCard>
            ))}
          </div>
        </>
      )}
    </>
  );
}
