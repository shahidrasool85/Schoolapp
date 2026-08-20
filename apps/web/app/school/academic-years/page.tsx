"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type Year = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
};

export default function AcademicYearsPage() {
  const [years, setYears] = useState<Year[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const body = await api<{ academicYears: Year[] }>("/api/v1/academic-years");
    setYears(body.academicYears);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/academic-years", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        startsOn: form.get("startsOn"),
        endsOn: form.get("endsOn"),
        isCurrent: form.get("isCurrent") === "on",
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  async function makeCurrent(id: string, year: Year) {
    await api(`/api/v1/academic-years/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        isCurrent: true,
      }),
    });
    await load();
  }

  return (
    <>
      <h1>Academic years</h1>
      <form className="card form-grid" onSubmit={onSubmit}>
        <label>Name<input name="name" placeholder="2026/27" required /></label>
        <label>Starts<input name="startsOn" type="date" required /></label>
        <label>Ends<input name="endsOn" type="date" required /></label>
        <label style={{ alignItems: "center" }}>
          Current year
          <input name="isCurrent" type="checkbox" />
        </label>
        <div><button type="submit">Add academic year</button></div>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr><th>Name</th><th>Starts</th><th>Ends</th><th>Current</th><th></th></tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year.id}>
              <td>{year.name}</td>
              <td>{year.startsOn}</td>
              <td>{year.endsOn}</td>
              <td>{year.isCurrent ? "Yes" : ""}</td>
              <td>
                {!year.isCurrent ? (
                  <button type="button" className="secondary" onClick={() => makeCurrent(year.id, year)}>
                    Set current
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
