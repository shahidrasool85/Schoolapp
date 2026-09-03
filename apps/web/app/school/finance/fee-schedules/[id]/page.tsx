"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  feeScheduleAnnualMatchesInstalments,
  feeScheduleCreateSummary,
  feeScheduleDeletedRedirect,
  formatUkNumericDate,
  parseGbpPoundsToMinor,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  ConfirmationDialog,
  EmptyState,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor } from "../../../../../lib/money";
import { usePermissions } from "../../../../../lib/use-permissions";
import { FinanceNav } from "../../finance-nav";

type Schedule = {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string | null;
  yearGroupName: string | null;
  className: string | null;
  amountMinor: number;
  annualAmountMinor: number | null;
  currency: string;
  billingFrequency: string;
  instalmentCount: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
  description: string | null;
  invoiceCount?: number | null;
  billingRunCount?: number | null;
  usage?: {
    unused: boolean;
    usedInBillingRun: boolean;
    hasInvoices: boolean;
    ended: boolean;
    archived: boolean;
  };
  overlapWarning?: string | null;
};

type Lifecycle = {
  canDelete: boolean;
  hasInvoices: boolean;
  invoiceCount?: number;
  billingRunCount?: number;
  unused?: boolean;
  usedInBillingRun?: boolean;
  message: string;
};

function statusLabel(schedule: Schedule): string {
  if (schedule.usage?.ended) return "ended";
  if (schedule.usage?.archived) return "archived";
  return schedule.isActive ? "active" : "inactive";
}

export default function FeeScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const permissions = usePermissions();
  const canManage = permissions.has("finance.fee_schedules.manage") || permissions.has("finance.manage");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [annualPounds, setAnnualPounds] = useState("");
  const [instalments, setInstalments] = useState("");

  async function load() {
    const body = await api<{ schedule: Schedule; lifecycle: Lifecycle }>(
      `/api/v1/finance/fee-schedules/${params.id}`,
    );
    setSchedule(body.schedule);
    setLifecycle(body.lifecycle);
    const annual =
      body.schedule.annualAmountMinor ??
      (body.schedule.instalmentCount ? body.schedule.amountMinor * body.schedule.instalmentCount : body.schedule.amountMinor);
    setAnnualPounds((annual / 100).toFixed(2));
    setInstalments(body.schedule.instalmentCount ? String(body.schedule.instalmentCount) : "1");
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load this fee schedule.")));
  }, [params.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schedule) return;
    const form = new FormData(event.currentTarget);
    const annual = parseGbpPoundsToMinor(String(form.get("annual") ?? annualPounds));
    if (!annual.ok) {
      setError(annual.error);
      return;
    }
    const instalmentCount = Number(String(form.get("instalments") ?? instalments));
    if (!Number.isInteger(instalmentCount) || instalmentCount < 1 || instalmentCount > 24) {
      setError("Instalments per year must be a whole number between 1 and 24.");
      return;
    }
    const plan = feeScheduleCreateSummary({ annualMinor: annual.amount, instalmentCount });
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    const annualCheck = feeScheduleAnnualMatchesInstalments({
      amountMinor: plan.amountPerInstalmentMinor,
      instalmentCount,
      annualAmountMinor: annual.amount,
    });
    if (!annualCheck.ok) {
      setError(annualCheck.error);
      return;
    }
    try {
      await api(`/api/v1/finance/fee-schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          amountMinor: plan.amountPerInstalmentMinor,
          annualAmountMinor: annual.amount,
          instalmentCount,
          effectiveUntil: form.get("effectiveUntil") || null,
          isActive: form.get("isActive") === "on",
          description: form.get("description") || null,
        }),
      });
      setNotice("Schedule updated. Historical invoices are unchanged.");
      await load();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not update this schedule."));
    }
  }

  async function previewPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schedule) return;
    const form = new FormData(event.currentTarget);
    try {
      const body = await api<{ run: { id: string } }>("/api/v1/finance/billing-runs/preview", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: schedule.academicYearId,
          frequency: schedule.billingFrequency,
          periodStart: form.get("periodStart"),
          periodEnd: form.get("periodEnd"),
          dueOn: form.get("dueOn") || null,
        }),
      });
      router.push(`/school/finance/billing-runs/${body.run.id}`);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not preview this billing period."));
    }
  }

  async function endSchedule() {
    if (!schedule) return;
    try {
      await api(`/api/v1/finance/fee-schedules/${schedule.id}/end`, {
        method: "POST",
        body: JSON.stringify({ effectiveUntil: new Date().toISOString().slice(0, 10) }),
      });
      setNotice("Schedule ended. Existing invoices remain.");
      await load();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not end this schedule."));
    }
  }

  async function archive() {
    if (!schedule) return;
    try {
      await api(`/api/v1/finance/fee-schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      });
      setNotice("Schedule archived.");
      await load();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not archive this schedule."));
    }
  }

  async function destroy() {
    if (!schedule || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/v1/finance/fee-schedules/${schedule.id}`, { method: "DELETE" });
      router.push(feeScheduleDeletedRedirect());
    } catch (err) {
      setError(userFacingError(err as Error, "Could not delete this schedule."));
      setConfirmDelete(false);
      setDeleting(false);
    }
  }

  if (error && !schedule) return <PageError title="Fee schedule unavailable" description={error} />;
  if (!schedule) return <LoadingState label="Loading fee schedule…" />;

  const impliedAnnual =
    schedule.annualAmountMinor ??
    (schedule.instalmentCount ? schedule.amountMinor * schedule.instalmentCount : null);
  const liveSummary = useMemo(() => {
    const annual = parseGbpPoundsToMinor(annualPounds);
    const count = Number(instalments);
    if (!annual.ok || !Number.isInteger(count) || count < 1) return null;
    const summary = feeScheduleCreateSummary({ annualMinor: annual.amount, instalmentCount: count });
    return summary.ok ? summary : { text: summary.error, roundingNote: null, amountPerInstalmentMinor: null };
  }, [annualPounds, instalments]);
  const invoicesGenerated = lifecycle?.invoiceCount ?? schedule.invoiceCount ?? 0;
  const billingRunsUsed = lifecycle?.billingRunCount ?? schedule.billingRunCount ?? 0;

  return (
    <>
      <PageHeader
        title={schedule.name}
        description="The fee schedule is the charging rule. It is not an invoice or a payment."
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/fee-schedules", label: "Fee schedules" },
          { label: schedule.name },
        ]}
      />
      <FinanceNav />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {schedule.overlapWarning ? <Alert tone="warning">{schedule.overlapWarning}</Alert> : null}
      <SectionCard title="Configured charges">
        <p>
          <StatusBadge status={statusLabel(schedule)} /> {schedule.academicYearName} ·{" "}
          {schedule.yearGroupName ?? "All pupils"}
          {schedule.className ? ` · ${schedule.className}` : ""}
        </p>
        <dl className="stack">
          <div>
            <dt>Academic year</dt>
            <dd>{schedule.academicYearName ?? "—"}</dd>
          </div>
          <div>
            <dt>Target year group / class</dt>
            <dd>
              {schedule.yearGroupName ?? "All year groups"}
              {schedule.className ? ` · ${schedule.className}` : ""}
            </dd>
          </div>
          <div>
            <dt>Annual total</dt>
            <dd>
              {impliedAnnual != null ? formatMinor(impliedAnnual, schedule.currency) : "Not recorded"}
              {schedule.annualAmountMinor == null && impliedAnnual != null ? " (amount per instalment × instalments)" : ""}
            </dd>
          </div>
          <div>
            <dt>Frequency</dt>
            <dd>{schedule.billingFrequency}</dd>
          </div>
          <div>
            <dt>Instalments per year</dt>
            <dd>{schedule.instalmentCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Amount per instalment</dt>
            <dd>{formatMinor(schedule.amountMinor, schedule.currency)}</dd>
          </div>
          <div>
            <dt>Effective from</dt>
            <dd>{formatUkNumericDate(schedule.effectiveFrom)}</dd>
          </div>
          <div>
            <dt>Effective until</dt>
            <dd>{schedule.effectiveUntil ? formatUkNumericDate(schedule.effectiveUntil) : "—"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={statusLabel(schedule)} />
            </dd>
          </div>
          <div>
            <dt>Invoices generated</dt>
            <dd>{invoicesGenerated}</dd>
          </div>
          <div>
            <dt>Billing runs used</dt>
            <dd>{billingRunsUsed}</dd>
          </div>
        </dl>
        <p className="muted">{lifecycle?.message}</p>
      </SectionCard>
      {canManage ? (
        <>
          <SectionCard title="Edit future charges">
            <p className="muted">Changing these values does not rewrite invoices that have already been issued.</p>
            <form className="stack" onSubmit={save}>
              <label>
                Name
                <input name="name" defaultValue={schedule.name} required />
              </label>
              <label>
                Annual tuition fee (£)
                <input
                  name="annual"
                  required
                  value={annualPounds}
                  onChange={(event) => setAnnualPounds(event.target.value)}
                />
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
                Regular instalment:{" "}
                <strong>
                  {liveSummary && "amountPerInstalmentMinor" in liveSummary && liveSummary.amountPerInstalmentMinor != null
                    ? formatMinor(liveSummary.amountPerInstalmentMinor, schedule.currency)
                    : "—"}
                </strong>
              </p>
              {liveSummary ? (
                <p className="muted">
                  {liveSummary.text}
                  {liveSummary.roundingNote ? ` ${liveSummary.roundingNote}` : ""}
                </p>
              ) : null}
              <label>
                Effective until
                <input name="effectiveUntil" type="date" defaultValue={schedule.effectiveUntil ?? ""} />
              </label>
              <label>
                <input name="isActive" type="checkbox" defaultChecked={schedule.isActive} /> Active
              </label>
              <button type="submit">Save</button>
            </form>
          </SectionCard>
          <SectionCard title="Preview this period">
            <p className="muted">
              Creates a billing-run preview only. Invoices are issued later from the billing run, after you confirm.
            </p>
            <form className="stack" onSubmit={previewPeriod}>
              <label>
                Period start
                <input name="periodStart" type="date" required />
              </label>
              <label>
                Period end
                <input name="periodEnd" type="date" required />
              </label>
              <label>
                Due date
                <input name="dueOn" type="date" />
              </label>
              <button type="submit">Preview billing run</button>
            </form>
          </SectionCard>
          <p className="toolbar">
            <Button type="button" variant="secondary" onClick={() => void endSchedule()}>
              End schedule
            </Button>
            <Button type="button" variant="secondary" onClick={() => void archive()}>
              Archive
            </Button>
            {lifecycle?.canDelete ? (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            ) : (
              <span className="muted">Delete is unavailable after invoices or billing-run items exist. End or archive instead.</span>
            )}
          </p>
        </>
      ) : (
        <EmptyState title="View only" description="School finance administrators can generate charges and edit future amounts." />
      )}
      <p>
        <Link href="/school/finance/invoices">Open invoices</Link>
      </p>
      <ConfirmationDialog
        open={confirmDelete}
        title="Delete this fee schedule?"
        description="This schedule has never generated financial transactions."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        danger
        busy={deleting}
        onConfirm={() => void destroy()}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
      />
    </>
  );
}
