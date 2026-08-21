"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";

type YearGroup = {
  id: string;
  code: string;
  name: string;
  keyStage: number | null;
  studentLoginEnabled: boolean;
};

export default function YearGroupsPage() {
  const [groups, setGroups] = useState<YearGroup[]>([]);
  const [maxCode, setMaxCode] = useState("8");
  const [error, setError] = useState("");

  async function load() {
    const [yg, org] = await Promise.all([
      api<{ yearGroups: YearGroup[] }>("/api/v1/year-groups"),
      api<{ settings: { maxYearGroupCode?: string } | null }>("/api/v1/organisation"),
    ]);
    setGroups(yg.yearGroups);
    if (org.settings?.maxYearGroupCode) setMaxCode(org.settings.maxYearGroupCode);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function seed() {
    await api("/api/v1/year-groups/seed", { method: "POST", body: "{}" });
    await load();
  }

  async function saveMax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/organisation/settings", {
      method: "PATCH",
      body: JSON.stringify({ maxYearGroupCode: form.get("maxYearGroupCode") }),
    });
    await load();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/year-groups", {
      method: "POST",
      body: JSON.stringify({
        code: form.get("code"),
        name: form.get("name") || undefined,
        studentLoginEnabled: form.get("studentLoginEnabled") === "on",
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  async function toggleLogin(id: string, enabled: boolean) {
    await api(`/api/v1/year-groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ studentLoginEnabled: !enabled }),
    });
    await load();
  }

  return (
    <>
      <h1>Year groups</h1>
      <p className="muted">
        Reception through the school&apos;s configured maximum year (default Year 8, including 11+
        preparation). Student portal access is configured as a school default with year-group
        overrides — Reception, Year 1 and Year 2 can be enabled.
      </p>
      <form className="card form-grid" onSubmit={saveMax}>
        <label>
          Maximum year
          <select name="maxYearGroupCode" value={maxCode} onChange={(e) => setMaxCode(e.target.value)}>
            {["R", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((code) => (
              <option key={code} value={code}>{code === "R" ? "Reception" : `Year ${code}`}</option>
            ))}
          </select>
        </label>
        <div><button type="submit">Save maximum</button></div>
        <div><button type="button" className="secondary" onClick={seed}>Add standard year groups</button></div>
      </form>
      <form className="card form-grid" onSubmit={add}>
        <label>Code<input name="code" placeholder="R or 6" required /></label>
        <label>Name<input name="name" placeholder="Year 6" /></label>
        <label style={{ alignItems: "center" }}>
          Student login
          <input name="studentLoginEnabled" type="checkbox" />
        </label>
        <div><button type="submit">Add year group</button></div>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Key stage</th><th>Student login</th><th></th></tr>
        </thead>
        <tbody>
          {groups.map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.keyStage ?? "—"}</td>
              <td>{row.studentLoginEnabled ? "Enabled" : "Off"}</td>
              <td>
                <button type="button" className="secondary" onClick={() => toggleLogin(row.id, row.studentLoginEnabled)}>
                  Toggle login
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
