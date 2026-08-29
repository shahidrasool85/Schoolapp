"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  ConfirmationDialog,
  DataTable,
  LoadingState,
  PageError,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../../../../../components/ui";
import { api } from "../../../../../lib/api";
import { userFacingError } from "../../../../../lib/errors";
import { formatMinor, poundsToMinor } from "../../../../../lib/money";
import { FinanceNav } from "../../finance-nav";

type Bundle = {
  invoice: {
    id: string;
    reference: string;
    billingAccountName: string | null;
    status: string;
    dueDate: string;
    currency: string;
    subtotalMinor: number;
    discountTotalMinor: number;
    totalMinor: number;
    paidMinor: number;
    outstandingMinor: number;
    paymentInstructions: string | null;
    deliveryState: string;
  };
  lines: Array<{
    id: string;
    kind: string;
    studentLegalName: string | null;
    description: string;
    amountMinor: number;
  }>;
  payments: Array<{ id: string; reference: string; amountMinor: number; method: string; status: string; receivedOn: string }>;
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);

  async function reload() {
    setData(await api<Bundle>(`/api/v1/finance/invoices/${params.id}`));
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(userFacingError(err, "Could not load invoice.")));
  }, [params.id]);

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/v1/finance/invoices/${params.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: poundsToMinor(String(form.get("amount") || "0")),
          method: form.get("method"),
          externalReference: form.get("reference") || null,
          note: form.get("note") || null,
        }),
      });
      setMessage("Payment recorded. Card and direct debit here are manual records only — no live collection.");
      event.currentTarget.reset();
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not record the payment."));
    }
  }

  async function voidInvoice() {
    try {
      await api(`/api/v1/finance/invoices/${params.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: "Voided by finance user" }),
      });
      setVoidOpen(false);
      await reload();
    } catch (err) {
      setError(userFacingError(err as Error, "Could not void the invoice."));
    }
  }

  if (error && !data) return <PageError title="Invoice unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading invoice…" />;
  const invoice = data.invoice;

  return (
    <>
      <PageHeader
        title={invoice.reference}
        description={`${invoice.billingAccountName ?? "Family account"} · due ${invoice.dueDate}. Delivery: ${invoice.deliveryState.replace("_", " ")} (email is not sent unless a real provider is configured).`}
        breadcrumbs={[
          { href: "/school/finance", label: "Finance" },
          { href: "/school/finance/invoices", label: "Invoices" },
          { label: invoice.reference },
        ]}
        actions={
          invoice.status !== "void" && invoice.paidMinor === 0 ? (
            <button type="button" className="secondary" onClick={() => setVoidOpen(true)}>
              Void invoice
            </button>
          ) : null
        }
      />
      <FinanceNav />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p>
        <StatusBadge status={invoice.status} /> Total {formatMinor(invoice.totalMinor, invoice.currency)} · Outstanding{" "}
        {formatMinor(invoice.outstandingMinor, invoice.currency)}
      </p>
      <SectionCard title="How this amount was calculated">
        <DataTable
          headers={
            <>
              <th>Line</th>
              <th>Pupil</th>
              <th>Amount</th>
            </>
          }
        >
          {data.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td>{line.studentLegalName ?? "—"}</td>
              <td>{formatMinor(line.amountMinor, invoice.currency)}</td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>
      {invoice.status !== "void" && invoice.outstandingMinor > 0 ? (
        <SectionCard title="Record a payment">
          <form className="stack" onSubmit={pay}>
            <label>
              Amount (£)
              <input name="amount" required placeholder="300.00" />
            </label>
            <label>
              Method
              <select name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card (recorded, not collected)</option>
                <option value="direct_debit">Direct debit (recorded, not collected)</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Reference
              <input name="reference" />
            </label>
            <label>
              Note
              <textarea name="note" />
            </label>
            <button type="submit">Record payment</button>
          </form>
        </SectionCard>
      ) : null}
      <SectionCard title="Payments">
        {data.payments.length === 0 ? (
          <p className="muted">No payments recorded against this invoice.</p>
        ) : (
          <ul className="plain-list">
            {data.payments.map((payment) => (
              <li key={payment.id}>
                {payment.receivedOn} · {payment.reference} · {payment.method} · {formatMinor(payment.amountMinor, invoice.currency)}{" "}
                <StatusBadge status={payment.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <ConfirmationDialog
        open={voidOpen}
        title="Void this invoice?"
        description="The invoice remains in the audit history. Paid invoices cannot be voided."
        confirmLabel="Void"
        danger
        onConfirm={voidInvoice}
        onClose={() => setVoidOpen(false)}
      />
    </>
  );
}
