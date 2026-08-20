"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Offer = {
  id: string;
  applicationId: string;
  applicationReference: string | null;
  pupilLegalName: string | null;
  status: string;
  offeredAcademicYearName: string | null;
  offeredYearGroupName: string | null;
  offerMadeOn: string;
  responseDeadline: string | null;
  intendedStartDate: string | null;
};

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function load(nextStatus = status) {
    const qs = nextStatus ? `?status=${encodeURIComponent(nextStatus)}` : "";
    const body = await api<{ offers: Offer[] }>(`/api/v1/admissions/offers${qs}`);
    setOffers(body.offers);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("status") ?? "";
    setStatus(initial);
    load(initial).catch((err: Error) => setError(err.message));
  }, []);

  async function respond(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/admissions/offers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: form.get("status"),
        waitlistOnDecline: form.get("waitlistOnDecline") === "on",
      }),
    });
    await load();
  }

  return (
    <>
      <div className="toolbar">
        <h1>Offers</h1>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            load(e.target.value).catch((err: Error) => setError(err.message));
          }}
        >
          <option value="">All</option>
          {["made", "accepted", "declined", "expired", "withdrawn"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Application</th>
            <th>Pupil</th>
            <th>Offered</th>
            <th>Deadline</th>
            <th>Status</th>
            <th>Response</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.id}>
              <td>
                <Link href={`/school/admissions/applications/${offer.applicationId}`}>
                  {offer.applicationReference}
                </Link>
              </td>
              <td>{offer.pupilLegalName}</td>
              <td>{offer.offeredYearGroupName ?? "—"} / {offer.offeredAcademicYearName ?? "—"}</td>
              <td>{offer.responseDeadline ?? "—"}</td>
              <td>{offer.status}</td>
              <td>
                {offer.status === "made" ? (
                  <form className="form-grid" onSubmit={(e) => respond(e, offer.id).catch((err: Error) => setError(err.message))}>
                    <select name="status" defaultValue="accepted">
                      <option value="accepted">Accept</option>
                      <option value="declined">Decline</option>
                      <option value="expired">Expire</option>
                      <option value="withdrawn">Withdraw</option>
                    </select>
                    <label>
                      <input type="checkbox" name="waitlistOnDecline" />
                      Waiting list if declined
                    </label>
                    <button type="submit">Save</button>
                  </form>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
