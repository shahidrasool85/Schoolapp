"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, LoadingState, PageError, PageHeader, SectionCard, StatCard, StatusBadge } from "../../../components/ui";
import { api } from "../../../lib/api";
import { userFacingError } from "../../../lib/errors";
import { formatMinor } from "../../../lib/money";
import { FinanceNav } from "./finance-nav";

type Overview = {
  currencies: Array<{
    currency: string;
    outstandingMinor: number;
    paidThisPeriodMinor: number;
    overdueCount: number;
    refundMinor: number;
  }>;
  tuition: {
    settings: { tuitionEnabled: boolean; currency: string };
    invoicedMinor: number;
    collectedMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    creditsMinor: number;
    upcomingRuns: Array<{ id: string; reference: string; periodStart: string; status: string }>;
    recentPayments: Array<{
      id: string;
      reference: string;
      amountMinor: number;
      currency: string;
      invoiceReference: string;
      billingAccountName: string;
    }>;
    recentInvoices: Array<{
      id: string;
      reference: string;
      status: string;
      totalMinor: number;
      currency: string;
      billingAccountName: string | null;
    }>;
    overdueAccounts: Array<{
      id: string;
      reference: string;
      outstandingMinor: number;
      currency: string;
      billingAccountName: string | null;
      daysOverdue: number;
    }>;
  } | null;
};

export default function FinanceOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/v1/finance/overview")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load finance overview.")));
  }, []);

  if (error) return <PageError title="Finance unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading finance…" />;

  const tuition = data.tuition;
  const currency = tuition?.settings.currency ?? data.currencies[0]?.currency ?? "GBP";

  return (
    <>
      <PageHeader
        title="Finance"
        description="School fees, family accounts, and other payments for this school only."
        actions={
          <>
            <Link className="button secondary" href="/school/finance/billing-runs">
              Billing runs
            </Link>
            <Link className="button" href="/school/finance/charges/new">
              Other charge
            </Link>
          </>
        }
      />
      <FinanceNav />
      {tuition?.settings.tuitionEnabled ? (
        <div className="stat-grid">
          <StatCard label="Invoiced" value={formatMinor(tuition.invoicedMinor, currency)} href="/school/finance/invoices" />
          <StatCard label="Collected" value={formatMinor(tuition.collectedMinor, currency)} />
          <StatCard label="Outstanding" value={formatMinor(tuition.outstandingMinor, currency)} href="/school/finance/arrears" />
          <StatCard label="Overdue" value={formatMinor(tuition.overdueMinor, currency)} href="/school/finance/arrears?bucket=overdue" />
          <StatCard label="Credits" value={formatMinor(tuition.creditsMinor, currency)} />
        </div>
      ) : (
        <SectionCard title="School fees">
          <p className="muted">
            Tuition billing is turned off. State-funded schools can leave it disabled. Other payments for trips,
            clubs and examinations continue as before.
          </p>
          <p>
            <Link href="/school/finance/settings">Enable tuition in Finance settings</Link>
          </p>
        </SectionCard>
      )}
      {data.currencies.length > 0 ? (
        <div className="stat-grid">
          {data.currencies.map((row) => (
            <StatCard
              key={row.currency}
              label={`${row.currency} other payments outstanding`}
              value={formatMinor(row.outstandingMinor, row.currency)}
              href="/school/finance/outstanding"
              hint={`Paid this month ${formatMinor(row.paidThisPeriodMinor, row.currency)} · Overdue ${row.overdueCount}`}
            />
          ))}
        </div>
      ) : null}
      {tuition?.settings.tuitionEnabled ? (
        <div className="card-grid">
          <SectionCard title="Recent invoices">
            {tuition.recentInvoices.length === 0 ? (
              <EmptyState title="No invoices yet" description="Preview a billing run before any invoices are created." />
            ) : (
              <ul className="plain-list">
                {tuition.recentInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/school/finance/invoices/${invoice.id}`}>
                      {invoice.reference} · {invoice.billingAccountName}
                    </Link>
                    <StatusBadge status={invoice.status} /> {formatMinor(invoice.totalMinor, invoice.currency)}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Recent payments">
            {tuition.recentPayments.length === 0 ? (
              <EmptyState title="No invoice payments" description="Record a bank transfer, cheque or other payment against an invoice." />
            ) : (
              <ul className="plain-list">
                {tuition.recentPayments.map((payment) => (
                  <li key={payment.id}>
                    {payment.reference} · {payment.billingAccountName} · {formatMinor(payment.amountMinor, payment.currency)}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Overdue accounts">
            {tuition.overdueAccounts.length === 0 ? (
              <EmptyState title="Nothing overdue" description="Overdue family invoices will appear here." />
            ) : (
              <ul className="plain-list">
                {tuition.overdueAccounts.map((item) => (
                  <li key={item.id}>
                    <Link href={`/school/finance/invoices/${item.id}`}>
                      {item.billingAccountName} · {item.daysOverdue} days
                    </Link>{" "}
                    {formatMinor(item.outstandingMinor, item.currency)}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
