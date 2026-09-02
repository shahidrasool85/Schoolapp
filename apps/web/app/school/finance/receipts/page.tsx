"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable, EmptyState, LoadingState, PageError, PageHeader, StatusBadge } from "../../../../components/ui";
import { api, downloadAuthenticated } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { formatMinor } from "../../../../lib/money";
import { FinanceNav } from "../finance-nav";

type Receipt = {
  id: string;
  reference: string;
  invoiceId: string | null;
  familyName: string | null;
  amountMinor: number | null;
  currency: string | null;
  paymentDate: string | null;
};

export default function FinanceReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ receipts: Receipt[] }>("/api/v1/finance/receipts")
      .then((body) => setReceipts(body.receipts))
      .catch((err: Error) => setError(userFacingError(err, "Could not load receipts.")));
  }, []);

  if (error) return <PageError title="Receipts unavailable" description={error} />;
  if (!receipts) return <LoadingState label="Loading receipts…" />;
  const filtered = receipts.filter((item) =>
    `${item.reference} ${item.familyName ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader title="Receipts" description="Historical payment receipts. Reprints do not create another payment." />
      <FinanceNav />
      <p>
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search receipts" />
      </p>
      {filtered.length === 0 ? (
        <EmptyState title="No receipts" description="Receipts appear after a successful payment is recorded." />
      ) : (
        <DataTable
          headers={
            <>
              <th>Receipt</th>
              <th>Family</th>
              <th>Date</th>
              <th>Amount</th>
              <th></th>
            </>
          }
        >
          {filtered.map((receipt) => (
            <tr key={receipt.id}>
              <td>{receipt.reference}</td>
              <td>
                {receipt.invoiceId ? (
                  <Link href={`/school/finance/invoices/${receipt.invoiceId}`}>{receipt.familyName ?? "Invoice"}</Link>
                ) : (
                  receipt.familyName ?? "—"
                )}
              </td>
              <td>{receipt.paymentDate ?? "—"}</td>
              <td>
                {receipt.amountMinor != null && receipt.currency
                  ? formatMinor(Number(receipt.amountMinor), String(receipt.currency))
                  : "—"}
              </td>
              <td>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void downloadAuthenticated(`/api/v1/finance/receipts/${receipt.id}/pdf`, `${receipt.reference}.pdf`)
                  }
                >
                  Download
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
