"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { formatMinor } from "../../../../lib/money";

type Bundle = {
  charge: {
    id: string;
    title: string;
    reference: string;
    studentLegalName: string | null;
    categoryName: string | null;
    activityTitle: string | null;
    status: string;
    amountDueMinor: number;
    outstandingMinor?: number;
    currency: string;
    dueAt: string | null;
    payable?: boolean;
    parentNote: string | null;
  };
  transactions: Array<{ id: string; reference: string; amountMinor: number; status: string; paidAt: string | null }>;
  receipts: Array<{
    id: string;
    reference: string;
    snapshot: {
      schoolName?: string;
      receiptReference?: string;
      payerName?: string | null;
      pupilName?: string | null;
      formattedAmount?: string;
      paidAt?: string;
      providerReference?: string | null;
      status?: string;
    };
  }>;
};

export default function ParentChargePage() {
  const params = useParams<{ chargeId: string }>();
  const search = useSearchParams();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const pendingReturn = search.get("status") === "pending";

  async function load() {
    setData(await api<Bundle>(`/api/v1/parent/payments/${params.chargeId}`));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.chargeId]);

  async function pay() {
    setError("");
    try {
      const body = await api<{ checkoutUrl: string }>(`/api/v1/parent/payments/${params.chargeId}/checkout`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `pay-${params.chargeId}-${Date.now()}` }),
      });
      window.location.href = body.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment unavailable");
    }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.charge.title}</h1>
      {error ? <p className="error">{error}</p> : null}
      {pendingReturn && data.charge.payable ? (
        <p>Payment is still pending confirmation. This page does not treat the return URL as success.</p>
      ) : null}
      <p className="muted">
        {data.charge.reference} · {data.charge.studentLegalName} · {data.charge.categoryName}
        {data.charge.activityTitle ? ` · ${data.charge.activityTitle}` : ""}
      </p>
      <p>
        Amount due {formatMinor(data.charge.amountDueMinor, data.charge.currency)}
        {data.charge.outstandingMinor != null
          ? ` · outstanding ${formatMinor(data.charge.outstandingMinor, data.charge.currency)}`
          : ""}
        {data.charge.dueAt ? ` · due ${new Date(data.charge.dueAt).toLocaleDateString()}` : ""}
      </p>
      {data.charge.parentNote ? <p>{data.charge.parentNote}</p> : null}
      {data.charge.payable ? (
        <button type="button" onClick={pay}>
          Pay
        </button>
      ) : null}
      <h2>History</h2>
      {data.transactions.length === 0 ? <p>No payments yet.</p> : null}
      <div className="cards">
        {data.transactions.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.reference}</strong>
            <span className="muted">{item.status}</span>
            <span>
              {formatMinor(item.amountMinor, data.charge.currency)}
            </span>
          </div>
        ))}
      </div>
      <h2>Receipts</h2>
      {data.receipts.length === 0 ? <p>No receipts yet.</p> : null}
      {data.receipts.map((receipt) => (
        <article className="card" key={receipt.id}>
          <h3>Receipt {receipt.snapshot.receiptReference ?? receipt.reference}</h3>
          <p>{receipt.snapshot.schoolName}</p>
          <p>Pupil: {receipt.snapshot.pupilName}</p>
          <p>Payer: {receipt.snapshot.payerName}</p>
          <p>Amount: {receipt.snapshot.formattedAmount}</p>
          <p>Date: {receipt.snapshot.paidAt ? new Date(receipt.snapshot.paidAt).toLocaleString() : ""}</p>
          <p>Reference: {receipt.snapshot.providerReference}</p>
          <p>Status: {receipt.snapshot.status}</p>
        </article>
      ))}
    </>
  );
}
