"use client";

import { FormEvent, useEffect, useState } from "react";
import { DataTable, FilterBar, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";

type Statement = {
  from: string;
  to: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  entries: Array<{ date: string; kind: string; reference: string; debitMinor: number; creditMinor: number; balanceMinor: number }>;
};

export default function ParentStatementPage() {
  const [data, setData] = useState<{ currency: string; statements: Statement[] } | null>(null);
  const [error, setError] = useState("");

  async function load(from?: string, to?: string) {
    const query = from && to ? `?from=${from}&to=${to}` : "";
    setData(await api(`/api/v1/parent/finance/statement${query}`));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(userFacingError(err, "Could not load your statement.")));
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await load(String(form.get("from")), String(form.get("to")));
  }

  if (error) return <PageError title="Statement unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading statement…" />;
  const statement = data.statements[0];

  return (
    <>
      <PageHeader
        title="Account statement"
        description="Opening balance, invoices, payments and credits for your authorised family account."
        breadcrumbs={[
          { href: "/parent/finance", label: "Finance" },
          { label: "Statement" },
        ]}
      />
      <FilterBar onSubmit={filter} actions={<button type="submit">Apply dates</button>}>
        <label>
          From
          <input name="from" type="date" defaultValue={statement?.from} />
        </label>
        <label>
          To
          <input name="to" type="date" defaultValue={statement?.to} />
        </label>
      </FilterBar>
      {statement ? (
        <>
          <p>
            Opening {formatMinor(statement.openingBalanceMinor, data.currency)} · Closing{" "}
            {formatMinor(statement.closingBalanceMinor, data.currency)}
          </p>
          <DataTable
            headers={
              <>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
              </>
            }
          >
            {statement.entries.map((entry) => (
              <tr key={`${entry.kind}-${entry.reference}`}>
                <td>{entry.date}</td>
                <td>{entry.kind}</td>
                <td>{entry.reference}</td>
                <td>{entry.debitMinor ? formatMinor(entry.debitMinor, data.currency) : "—"}</td>
                <td>{entry.creditMinor ? formatMinor(entry.creditMinor, data.currency) : "—"}</td>
                <td>{formatMinor(entry.balanceMinor, data.currency)}</td>
              </tr>
            ))}
          </DataTable>
        </>
      ) : (
        <p className="muted">No statement lines in this range.</p>
      )}
    </>
  );
}
