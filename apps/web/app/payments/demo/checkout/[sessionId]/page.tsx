"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { formatMinor } from "../../../../../lib/money";

type Session = {
  id: string;
  title: string;
  pupilName: string;
  amountMinor: number;
  currency: string;
  status: string;
};

export default function DemoCheckoutPage() {
  const params = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ session: Session }>(`/api/v1/payments/demo/checkout/${params.sessionId}`)
      .then((body) => setSession(body.session))
      .catch((err: Error) => setError(err.message));
  }, [params.sessionId]);

  async function complete(outcome: "succeeded" | "failed" | "cancelled") {
    setError("");
    try {
      const body = await api<{ chargeId: string }>(`/api/v1/payments/demo/checkout/${params.sessionId}/complete`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      });
      if (outcome === "cancelled") {
        window.location.href = `/parent/payments/${body.chargeId}?status=cancelled`;
        return;
      }
      if (outcome === "failed") {
        setMessage("Demo payment failed. Schoolapp did not mark the charge paid.");
        return;
      }
      window.location.href = `/parent/payments/${body.chargeId}?status=pending`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    }
  }

  if (error && !session) return <p className="error">{error}</p>;
  if (!session) return <p>Loading demo checkout…</p>;

  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", padding: "1rem" }}>
      <h1>Demo checkout</h1>
      <p className="muted">Local fake provider. No card details are collected.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      <p>
        <strong>{session.title}</strong>
      </p>
      <p>{session.pupilName}</p>
      <p>
        {formatMinor(session.amountMinor, session.currency)}
      </p>
      <p>Session status: {session.status}</p>
      <div className="toolbar">
        <button type="button" onClick={() => complete("succeeded")}>
          Simulate success
        </button>
        <button type="button" className="secondary" onClick={() => complete("failed")}>
          Simulate failure
        </button>
        <button type="button" className="secondary" onClick={() => complete("cancelled")}>
          Cancel
        </button>
      </div>
    </main>
  );
}
