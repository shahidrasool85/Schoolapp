"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, LoadingState, PageError, PageHeader, SectionCard, StatusBadge } from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor, poundsToMinor } from "../../../../../lib/money";
import { FinanceNav } from "../../finance-nav";

type Bundle = {
  studentProfileId: string;
  legalName: string;
  quote: {
    feeScheduleName: string | null;
    billingFrequency: string | null;
    standardAmountMinor: number;
    appliedDiscounts: Array<{ name: string; calculatedMinor: number }>;
    discountTotalMinor: number;
    netAmountMinor: number;
    currency: string;
    siblingPosition: number | null;
  } | null;
  invoices: Array<{ id: string; reference: string; status: string; outstandingMinor: number; currency: string }>;
};

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

  return (
    <>
      <PageHeader
        title={`${data.legalName} — school fees`}
        description="Standard tuition, eligible discounts, and the net amount that would be billed now."
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { label: data.legalName },
        ]}
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {quote ? (
        <SectionCard title="Current calculation">
          <p>
            {quote.feeScheduleName ?? "No schedule"} · {quote.billingFrequency}
            {quote.siblingPosition ? ` · sibling position ${quote.siblingPosition}` : ""}
          </p>
          <p>Standard tuition {formatMinor(quote.standardAmountMinor, quote.currency)}</p>
          {quote.appliedDiscounts.map((discount) => (
            <p key={discount.name}>
              {discount.name} −{formatMinor(discount.calculatedMinor, quote.currency)}
            </p>
          ))}
          <p>
            <strong>Net tuition {formatMinor(quote.netAmountMinor, quote.currency)}</strong>
          </p>
        </SectionCard>
      ) : (
        <p className="muted">No current fee schedule applies to this pupil.</p>
      )}
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
