"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatUkNumericDate, formatUkNumericDateRange } from "@schoolapp/domain";
import { Alert, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor, poundsToMinor } from "../../../../../lib/money";
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
};

function quoteHasSchedule(quote: Quote | null): boolean {
  return Boolean(quote?.feeScheduleName) && quote?.warning !== "no_fee_schedule";
}

export default function PupilFeeProfilePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
        description="Fee applicability uses the same overlap rules as billing-run preview. Today and the current billing period are labelled separately."
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
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
        <ul className="plain-list">
          {data.invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link href={`/school/finance/invoices/${invoice.id}`}>{invoice.reference}</Link>{" "}
              <StatusBadge status={invoice.status} /> {formatMinor(invoice.outstandingMinor, invoice.currency)}
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}
