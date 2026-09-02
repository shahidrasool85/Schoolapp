"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, EmptyState, LoadingState, PageError, PageHeader, SectionCard } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { FinanceNav } from "../finance-nav";

type Account = { id: string; name: string };

export default function FinanceStatementsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ accounts: Account[] }>("/api/v1/finance/accounts")
      .then((body) => setAccounts(body.accounts))
      .catch((err: Error) => setError(userFacingError(err, "Could not load family accounts.")));
  }, []);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("billingAccountId") ?? "");
    const preset = String(form.get("preset") ?? "current_academic_year");
    const format = String(form.get("format") ?? "pdf");
    const from = String(form.get("from") ?? "");
    const to = String(form.get("to") ?? "");
    const query = new URLSearchParams({ billingAccountId: accountId, preset, format });
    if (preset === "custom") {
      query.set("from", from);
      query.set("to", to);
    }
    try {
      await downloadAuthenticated(
        `/api/v1/finance/statements?${query.toString()}`,
        format === "zip" ? "family-statement.zip" : "family-statement.pdf",
      );
      setNotice("Statement downloaded. This reprints existing records; it does not create payments.");
    } catch (err) {
      setError(userFacingError(err as Error, "Could not download that statement."));
    }
  }

  if (error && !accounts) return <PageError title="Statements unavailable" description={error} />;
  if (!accounts) return <LoadingState label="Loading families…" />;

  return (
    <>
      <PageHeader
        title="Family statements"
        description="Download a statement for a family covering an academic year, UK tax year, calendar year, or custom dates."
      />
      <FinanceNav />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {accounts.length === 0 ? (
        <EmptyState title="No family accounts" description="Statements become available once billing accounts exist." />
      ) : (
        <SectionCard title="Generate statement">
          <form className="stack" onSubmit={download}>
            <label>
              Family
              <select name="billingAccountId" required>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select name="preset" defaultValue="current_academic_year">
                <option value="current_academic_year">Current academic year</option>
                <option value="previous_academic_year">Previous academic year</option>
                <option value="current_uk_tax_year">Current UK tax year (6 Apr–5 Apr)</option>
                <option value="previous_uk_tax_year">Previous UK tax year</option>
                <option value="calendar_year">Calendar year</option>
                <option value="custom">Custom date range</option>
              </select>
            </label>
            <label>
              Custom from
              <input name="from" type="date" />
            </label>
            <label>
              Custom to
              <input name="to" type="date" />
            </label>
            <label>
              Format
              <select name="format" defaultValue="pdf">
                <option value="pdf">Statement PDF</option>
                <option value="zip">All documents (ZIP)</option>
              </select>
            </label>
            <button type="submit">Download</button>
          </form>
        </SectionCard>
      )}
    </>
  );
}
