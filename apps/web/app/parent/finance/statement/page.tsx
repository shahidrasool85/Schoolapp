"use client";

import { FormEvent, useEffect, useState } from "react";
import { DataTable, FilterBar, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";

type Statement = {
  from: string;
  to: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  entries: Array<{ date: string; kind: string; reference: string; debitMinor: number; creditMinor: number; balanceMinor: number }>;
};

type FamilyDocument = {
  document: {
    from: string;
    to: string;
    openingMinor: number;
    closingMinor: number;
    outstandingMinor: number;
    currency: string;
    pupilNames: string[];
    entries: Array<{
      date: string;
      kind: string;
      reference: string;
      debitMinor: number;
      creditMinor: number;
      balanceMinor: number;
    }>;
  };
};

const PRESETS = [
  { value: "current_academic_year", label: "Current academic year" },
  { value: "previous_academic_year", label: "Previous academic year" },
  { value: "current_uk_tax_year", label: "Current UK tax year (6 Apr–5 Apr)" },
  { value: "previous_uk_tax_year", label: "Previous UK tax year" },
  { value: "calendar_year", label: "Calendar year" },
  { value: "custom", label: "Custom date range" },
];

export default function ParentStatementPage() {
  const [legacy, setLegacy] = useState<{ currency: string; statements: Statement[] } | null>(null);
  const [family, setFamily] = useState<FamilyDocument | null>(null);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("current_academic_year");

  async function load(nextPreset = preset, from?: string, to?: string) {
    const query = new URLSearchParams({ preset: nextPreset });
    if (nextPreset === "custom" && from && to) {
      query.set("from", from);
      query.set("to", to);
    }
    try {
      const body = await api<FamilyDocument | { currency: string; statements: Statement[] }>(
        `/api/v1/parent/finance/statement?${query.toString()}`,
      );
      if ("document" in body) {
        setFamily(body);
        setLegacy(null);
      } else {
        setLegacy(body);
        setFamily(null);
      }
    } catch (err) {
      setError(userFacingError(err as Error, "Could not load your statement."));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPreset = String(form.get("preset") || "custom");
    setPreset(nextPreset);
    await load(nextPreset, String(form.get("from") || ""), String(form.get("to") || ""));
  }

  async function download(format: "pdf" | "zip") {
    const query = new URLSearchParams({ preset, format });
    try {
      await downloadAuthenticated(
        `/api/v1/parent/finance/statement?${query.toString()}`,
        format === "zip" ? "family-finance-documents.zip" : "family-statement.pdf",
      );
    } catch (err) {
      setError(userFacingError(err as Error, "Could not download that statement."));
    }
  }

  if (error && !legacy && !family) return <PageError title="Statement unavailable" description={error} />;
  if (!legacy && !family) return <LoadingState label="Loading statement…" />;
  const statement = family?.document;
  const legacyStatement = legacy?.statements[0];
  const currency = family?.document.currency ?? legacy?.currency ?? "GBP";

  return (
    <>
      <PageHeader
        title="Account statement"
        description="Opening balance, invoices, payments, credits and receipts for your authorised children."
        breadcrumbs={[
          { href: "/parent/finance", label: "Finance" },
          { label: "Statement" },
        ]}
      />
      {error ? <p className="error">{error}</p> : null}
      <FilterBar
        onSubmit={filter}
        actions={
          <>
            <button type="submit">Apply</button>
            <button type="button" className="secondary" onClick={() => void download("pdf")}>
              Download statement
            </button>
            <button type="button" className="secondary" onClick={() => void download("zip")}>
              Download all documents
            </button>
          </>
        }
      >
        <label>
          Period
          <select name="preset" defaultValue={preset} onChange={(event) => setPreset(event.target.value)}>
            {PRESETS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input name="from" type="date" defaultValue={statement?.from ?? legacyStatement?.from} />
        </label>
        <label>
          To
          <input name="to" type="date" defaultValue={statement?.to ?? legacyStatement?.to} />
        </label>
      </FilterBar>
      {statement ? (
        <>
          {statement.pupilNames.length ? <p>Children included: {statement.pupilNames.join(", ")}</p> : null}
          <p>
            Opening {formatMinor(statement.openingMinor, currency)} · Closing {formatMinor(statement.closingMinor, currency)}{" "}
            · Outstanding {formatMinor(statement.outstandingMinor, currency)}
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
              <tr key={`${entry.kind}-${entry.reference}-${entry.date}`}>
                <td>{entry.date}</td>
                <td>{entry.kind}</td>
                <td>{entry.reference}</td>
                <td>{entry.debitMinor ? formatMinor(entry.debitMinor, currency) : "—"}</td>
                <td>{entry.creditMinor ? formatMinor(entry.creditMinor, currency) : "—"}</td>
                <td>{formatMinor(entry.balanceMinor, currency)}</td>
              </tr>
            ))}
          </DataTable>
        </>
      ) : legacyStatement ? (
        <>
          <p>
            Opening {formatMinor(legacyStatement.openingBalanceMinor, currency)} · Closing{" "}
            {formatMinor(legacyStatement.closingBalanceMinor, currency)}
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
            {legacyStatement.entries.map((entry) => (
              <tr key={`${entry.kind}-${entry.reference}`}>
                <td>{entry.date}</td>
                <td>{entry.kind}</td>
                <td>{entry.reference}</td>
                <td>{entry.debitMinor ? formatMinor(entry.debitMinor, currency) : "—"}</td>
                <td>{entry.creditMinor ? formatMinor(entry.creditMinor, currency) : "—"}</td>
                <td>{formatMinor(entry.balanceMinor, currency)}</td>
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
