"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { formatMinor, poundsToMinor } from "../../../../../lib/money";

type Bundle = {
  charge: {
    id: string;
    reference: string;
    title: string;
    status: string;
    studentLegalName: string | null;
    categoryName: string | null;
    activityTitle: string | null;
    amountDueMinor: number;
    outstandingMinor?: number;
    netPaidMinor?: number;
    currency: string;
    dueAt: string | null;
    parentNote: string | null;
  };
  transactions: Array<{
    id: string;
    reference: string;
    amountMinor: number;
    status: string;
    channel: string;
    providerKey: string;
    paidAt: string | null;
  }>;
  refunds: Array<{ id: string; reference: string; amountMinor: number; status: string; reason: string }>;
};

export default function StaffChargeDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setData(await api<Bundle>(`/api/v1/finance/charges/${params.id}`));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [params.id]);

  async function post(path: string, body: unknown, ok: string) {
    setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setMessage(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function issue() {
    await post(`/api/v1/finance/charges/${params.id}/issue`, {}, "Charge issued");
  }

  async function cancel() {
    await post(`/api/v1/finance/charges/${params.id}/cancel`, {}, "Charge cancelled");
  }

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post(
      `/api/v1/finance/charges/${params.id}/adjust`,
      {
        kind: String(form.get("kind") || "reduction"),
        amountMinor: poundsToMinor(String(form.get("amountPounds") || "")),
        reason: String(form.get("reason") || ""),
      },
      "Adjustment recorded",
    );
  }

  async function offline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post(
      `/api/v1/finance/charges/${params.id}/offline-payment`,
      {
        amountMinor: poundsToMinor(String(form.get("amountPounds") || "")),
        method: String(form.get("method") || "cash"),
        reference: String(form.get("reference") || "") || undefined,
        note: String(form.get("note") || "") || undefined,
        idempotencyKey: `offline-${params.id}-${String(form.get("reference") || Date.now())}`,
      },
      "Offline payment recorded",
    );
  }

  async function refund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post(
      `/api/v1/finance/charges/${params.id}/refund`,
      {
        amountMinor: poundsToMinor(String(form.get("amountPounds") || "")),
        reason: String(form.get("reason") || ""),
        idempotencyKey: `refund-${params.id}-${Date.now()}`,
      },
      "Refund requested",
    );
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>{data.charge.title}</h1>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      <p className="muted">
        {data.charge.reference} · {data.charge.studentLegalName} · {data.charge.categoryName} · {data.charge.status}
        {data.charge.activityTitle ? ` · ${data.charge.activityTitle}` : ""}
      </p>
      <p>
        Due {formatMinor(data.charge.amountDueMinor, data.charge.currency)}
        {data.charge.outstandingMinor != null
          ? ` · outstanding ${formatMinor(data.charge.outstandingMinor, data.charge.currency)}`
          : ""}
      </p>
      {data.charge.parentNote ? <p>{data.charge.parentNote}</p> : null}
      <div className="toolbar">
        {data.charge.status === "draft" ? (
          <button type="button" onClick={issue}>
            Issue
          </button>
        ) : null}
        {data.charge.status === "issued" || data.charge.status === "draft" ? (
          <button type="button" className="secondary" onClick={cancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <h2>Record offline payment</h2>
      <form className="toolbar" onSubmit={offline}>
        <input name="amountPounds" inputMode="decimal" placeholder="Amount £" required />
        <select name="method" defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cheque">Cheque</option>
          <option value="card_terminal">Card terminal</option>
          <option value="other">Other</option>
        </select>
        <input name="reference" placeholder="Reference" />
        <button type="submit">Record</button>
      </form>
      <h2>Adjust / waive</h2>
      <form className="toolbar" onSubmit={adjust}>
        <select name="kind" defaultValue="reduction">
          <option value="waiver">Waiver</option>
          <option value="reduction">Reduction</option>
          <option value="subsidy">Subsidy</option>
          <option value="discount">Discount</option>
        </select>
        <input name="amountPounds" inputMode="decimal" placeholder="Amount £" required />
        <input name="reason" required placeholder="Reason" />
        <button type="submit">Apply</button>
      </form>
      <h2>Refund</h2>
      <form className="toolbar" onSubmit={refund}>
        <input name="amountPounds" inputMode="decimal" placeholder="Amount £" required />
        <input name="reason" required placeholder="Reason" />
        <button type="submit">Refund</button>
      </form>
      <h2>Transactions</h2>
      {data.transactions.length === 0 ? <p>No transactions.</p> : null}
      <div className="cards">
        {data.transactions.map((item) => (
          <div className="card" key={item.id}>
            <strong>{item.reference}</strong>
            <span className="muted">
              {item.channel} · {item.providerKey} · {item.status}
            </span>
            <span>
              {formatMinor(item.amountMinor, data.charge.currency)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
