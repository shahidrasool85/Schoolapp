"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatUkNumericDate, formatUkNumericDateRange } from "@schoolapp/domain";
import { Alert, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor, poundsToMinor } from "../../../../../lib/money";
import { usePermissions } from "../../../../../lib/use-permissions";
import { FinanceNav } from "../../finance-nav";

type Quote = {
  feeScheduleName: string | null;
  billingFrequency: string | null;
  annualAmountMinor: number | null;
  amountPerInstalmentMinor: number | null;
  standardAmountMinor: number;
  appliedDiscounts: Array<{ name: string; calculatedMinor: number }>;
  discountTotalMinor: number;
  netAmountMinor: number;
  currency: string;
  siblingPosition: number | null;
  periodStart?: string;
  periodEnd?: string;
  warning?: string | null;
};

type Bundle = {
  studentProfileId: string;
  legalName: string;
  enrolment: {
    academicYearName: string | null;
    yearGroupName: string | null;
    className: string | null;
    startedOn: string;
    endedOn: string | null;
    status: string;
  } | null;
  evaluatedOn: string;
  evaluatedPeriod: { periodStart: string; periodEnd: string } | null;
  todayQuote: Quote | null;
  quote: Quote | null;
  appliesToday: boolean;
  appliesInEvaluatedPeriod: boolean;
  upcoming: {
    feeScheduleName: string | null;
    annualAmountMinor: number | null;
    amountPerInstalmentMinor: number;
    currency: string;
    periodStart: string;
    periodEnd: string;
    effectiveFrom: string;
  } | null;
  invoices: Array<{ id: string; reference: string; status: string; outstandingMinor: number; currency: string }>;
  fees: {
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
    status: string;
    parentPaymentAvailability: string;
    billingAccountId: string | null;
    currency: string;
    warning: string | null;
    scheduleConflict: boolean;
  } | null;
  receipts: Array<{ id: string; reference: string; amountMinor: number | null; currency: string | null; paymentDate: string | null }>;
};

function quoteHasSchedule(quote: Quote | null): boolean {
  return Boolean(quote?.feeScheduleName) && quote?.warning !== "no_fee_schedule";
}

export default function PupilFeeProfilePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const permissions = usePermissions();
  const canNotify = permissions.has("finance.invoices.manage") || permissions.has("finance.billing_runs.manage") || permissions.has("finance.manage");
  const canRecord = permissions.has("finance.payments.record_offline") || permissions.has("finance.invoices.manage") || permissions.has("finance.manage");

  async function reload() {
    setData(await api<Bundle>(`/api/v1/finance/pupils/${params.id}`));
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load this pupil fee profile.")));
  }, [params.id]);

  async function addConcession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/v1/finance/pupils/${params.id}/concessions`, {
        method: "POST",
        body: JSON.stringify({
          kind: form.get("kind"),
          name: form.get("name"),
          amountType: form.get("amountType"),
          percentBps: form.get("amountType") === "percent" ? Math.round(Number(form.get("percent") || 0) * 100) : null,
          amountMinor: form.get("amountType") === "fixed" ? poundsToMinor(String(form.get("fixed") || "0")) : null,
          reason: form.get("reason"),
        }),
      });
      setMessage("Concession recorded against this pupil.");
      event.currentTarget.reset();
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not save the concession."));
    }
  }

  if (error && !data) return <PageError title="Pupil billing unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading pupil billing…" />;
  const quote = data.quote;
  const periodApplies = data.appliesInEvaluatedPeriod || quoteHasSchedule(quote);
  const todayApplies = data.appliesToday || quoteHasSchedule(data.todayQuote);

  return (
    <>
      <PageHeader
        title={`${data.legalName} — school fees`}
        description="Fee plan, invoices and payments for this pupil. Family totals stay on the family account."
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/student-fees", label: "Student fees" },
          { label: data.legalName },
        ]}
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {data.enrolment ? (
        <p className="muted">
          {data.enrolment.academicYearName} · {data.enrolment.yearGroupName ?? "No year group"}
          {data.enrolment.className ? ` · ${data.enrolment.className}` : ""} · enrolled from{" "}
          {formatUkNumericDate(data.enrolment.startedOn)}
          {data.enrolment.endedOn ? ` to ${formatUkNumericDate(data.enrolment.endedOn)}` : ""}
        </p>
      ) : (
        <Alert tone="warning">This pupil is not enrolled in the current academic year.</Alert>
      )}
      {data.fees?.scheduleConflict ? (
        <Alert tone="warning">More than one fee schedule matches this pupil. Check Advanced → Fee schedules.</Alert>
      ) : null}
      {data.fees && data.fees.warning === "no_fee_schedule" ? (
        <Alert tone="warning">No applicable fee schedule. Add a year-group schedule or assign one on this pupil.</Alert>
      ) : null}
      {data.fees ? (
        <div className="stat-grid">
          <StatCard
            label="Annual fee"
            value={data.fees.annualFeeMinor == null ? "—" : formatMinor(data.fees.annualFeeMinor, data.fees.currency)}
          />
          <StatCard
            label="Discount / concession"
            value={formatMinor(data.fees.discountMinor, data.fees.currency)}
            hint={data.fees.discountLabel ?? undefined}
          />
          <StatCard
            label="Net annual fee"
            value={data.fees.netAnnualFeeMinor == null ? "—" : formatMinor(data.fees.netAnnualFeeMinor, data.fees.currency)}
          />
          <StatCard label="Invoiced" value={formatMinor(data.fees.invoicedMinor, data.fees.currency)} />
          <StatCard label="Paid" value={formatMinor(data.fees.paidMinor, data.fees.currency)} />
          <StatCard label="Outstanding" value={formatMinor(data.fees.outstandingMinor, data.fees.currency)} />
          <StatCard label="Overdue" value={formatMinor(data.fees.overdueMinor, data.fees.currency)} />
          <StatCard label="Status" value={data.fees.status.replaceAll("_", " ")} />
        </div>
      ) : null}
      <SectionCard title={`Applies today (${formatUkNumericDate(data.evaluatedOn)})`}>
        {todayApplies && data.todayQuote ? (
          <p>
            {data.todayQuote.feeScheduleName} —{" "}
            {formatMinor(data.todayQuote.amountPerInstalmentMinor ?? data.todayQuote.standardAmountMinor, data.todayQuote.currency)}{" "}
            per instalment
          </p>
        ) : (
          <p>No fee schedule applies today.</p>
        )}
      </SectionCard>
      {data.evaluatedPeriod ? (
        <SectionCard
          title={`Current billing period (${formatUkNumericDateRange(data.evaluatedPeriod.periodStart, data.evaluatedPeriod.periodEnd)})`}
        >
          {periodApplies && quote ? (
            <>
              <p>
                {quote.feeScheduleName ?? "No schedule"} · {quote.billingFrequency}
                {quote.siblingPosition ? ` · sibling position ${quote.siblingPosition}` : ""}
              </p>
              {quote.annualAmountMinor != null ? (
                <p>Annual fee {formatMinor(quote.annualAmountMinor, quote.currency)}</p>
              ) : null}
              <p>Amount per instalment {formatMinor(quote.amountPerInstalmentMinor ?? quote.standardAmountMinor, quote.currency)}</p>
              {quote.appliedDiscounts.map((discount) => (
                <p key={discount.name}>
                  {discount.name} −{formatMinor(discount.calculatedMinor, quote.currency)}
                </p>
              ))}
              <p>
                <strong>Net tuition {formatMinor(quote.netAmountMinor, quote.currency)}</strong>
              </p>
            </>
          ) : (
            <p className="muted">No fee schedule applies in this billing period.</p>
          )}
        </SectionCard>
      ) : null}
      {data.upcoming ? (
        <Alert tone="info">
          Upcoming schedule: {data.upcoming.feeScheduleName} —{" "}
          {formatMinor(data.upcoming.amountPerInstalmentMinor, data.upcoming.currency)} per instalment from{" "}
          {formatUkNumericDate(data.upcoming.effectiveFrom)}
          {data.upcoming.annualAmountMinor != null
            ? ` (annual ${formatMinor(data.upcoming.annualAmountMinor, data.upcoming.currency)})`
            : ""}
          .
        </Alert>
      ) : null}
      <SectionCard title="Add a pupil concession">
        <form className="stack" onSubmit={addConcession}>
          <label>
            Type
            <select name="kind" defaultValue="individual">
              <option value="scholarship">Scholarship</option>
              <option value="bursary">Bursary</option>
              <option value="individual">Individual concession</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Amount type
            <select name="amountType" defaultValue="fixed">
              <option value="fixed">Fixed</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <label>
            Percent
            <input name="percent" />
          </label>
          <label>
            Fixed (£)
            <input name="fixed" placeholder="50.00" />
          </label>
          <label>
            Reason
            <input name="reason" required />
          </label>
          <button type="submit">Add concession</button>
        </form>
      </SectionCard>
      <SectionCard title="Invoices">
        {data.invoices.length === 0 ? (
          <p className="muted">No invoices have been issued for this pupil yet.</p>
        ) : (
          <ul className="plain-list">
            {data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link href={`/school/finance/invoices/${invoice.id}`}>{invoice.reference}</Link>{" "}
                <StatusBadge status={invoice.status} /> {formatMinor(invoice.outstandingMinor, invoice.currency)}
                {canNotify && invoice.status !== "void" && invoice.status !== "paid" ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        api(`/api/v1/finance/invoices/${invoice.id}/notify`, { method: "POST", body: "{}" })
                          .then(() => setMessage("Payment notification queued for the authorised payer."))
                          .catch((err: Error) =>
                            setError(userFacingError(err, "Could not send the payment notification.")),
                          );
                      }}
                    >
                      Send payment notification
                    </button>
                  </>
                ) : null}
                {canRecord && invoice.outstandingMinor > 0 ? (
                  <>
                    {" "}
                    <Link href={`/school/finance/invoices/${invoice.id}`}>Record offline payment</Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Receipts">
        {(data.receipts ?? []).length === 0 ? (
          <p className="muted">Receipts appear after a payment is recorded.</p>
        ) : (
          <ul className="plain-list">
            {(data.receipts ?? []).map((receipt) => (
              <li key={receipt.id}>
                {receipt.paymentDate ?? ""} · {receipt.reference}
                {receipt.amountMinor != null && receipt.currency
                  ? ` · ${formatMinor(receipt.amountMinor, receipt.currency)}`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {data.fees?.billingAccountId ? (
        <p>
          <Link href={`/school/finance/accounts/${data.fees.billingAccountId}`}>Open family account</Link>
        </p>
      ) : null}
    </>
  );
}
