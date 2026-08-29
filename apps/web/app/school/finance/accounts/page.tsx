"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Account = {
  id: string;
  name: string;
  primaryPayerName: string | null;
  outstandingMinor: number;
  pupilNames: string;
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ accounts: Account[] }>("/api/v1/finance/accounts")
      .then((body) => setAccounts(body.accounts))
      .catch((err: Error) => setError(userFacingError(err, "Could not load family accounts.")));
  }, []);

  if (error) return <PageError title="Accounts unavailable" description={error} />;
  if (!accounts) return <LoadingState label="Loading family accounts…" />;

  return (
    <>
      <PageHeader
        title="Family accounts"
        description="Families are grouped from live guardian relationships, not from matching surnames."
      />
      <FinanceNav />
      {accounts.length === 0 ? (
        <EmptyState title="No family accounts" description="Accounts are created when a billing run or pupil fee profile is prepared." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Family</th>
              <th>Pupils</th>
              <th>Payer</th>
              <th>Outstanding</th>
            </>
          }
        >
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>
                <Link href={`/school/finance/accounts/${account.id}`}>{account.name}</Link>
              </td>
              <td>{account.pupilNames}</td>
              <td>{account.primaryPayerName ?? "—"}</td>
              <td>{formatMinor(account.outstandingMinor, "GBP")}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
