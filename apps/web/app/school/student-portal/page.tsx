"use client";

import { FormEvent, useEffect, useState } from "react";
import { EmptyState } from "../../../components/ui";
import { RequirePermission } from "../../../components/require-permission";
import { SetupReturnBanner } from "../../../components/setup-return-banner";
import { api } from "../../../lib/api";

type YearGroup = {
  id: string;
  code: string;
  name: string;
  override: boolean | null;
  effectiveEnabled: boolean;
};

export default function StudentPortalPolicyPage() {
  return (
    <RequirePermission anyOf={["students.portal_access.manage"]}>
      <StudentPortalPolicyBody />
    </RequirePermission>
  );
}

function StudentPortalPolicyBody() {
  const [defaultEnabled, setDefaultEnabled] = useState(false);
  const [yearGroups, setYearGroups] = useState<YearGroup[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const body = await api<{
      policy: { defaultEnabled: boolean };
      yearGroups: YearGroup[];
    }>("/api/v1/student-portal-policy");
    setDefaultEnabled(body.policy.defaultEnabled);
    setYearGroups(body.yearGroups);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function saveDefault(event: FormEvent) {
    event.preventDefault();
    await api("/api/v1/student-portal-policy", {
      method: "PATCH",
      body: JSON.stringify({ defaultEnabled }),
    });
    setMessage("School default saved. Reception, Year 1 and Year 2 can be enabled.");
    await load();
  }

  async function saveYearGroup(id: string, value: string) {
    await api(`/api/v1/student-portal-policy/year-groups/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: value === "inherit" ? null : value === "on" }),
    });
    await load();
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <SetupReturnBanner />
      <h1>Student portal access</h1>
      <p className="muted">
        A student record exists whether or not the pupil can log in. Effective access is
        school default, then year-group override. Class and individual overrides are stored
        for a later phase.
      </p>
      <form className="card form-grid" onSubmit={saveDefault}>
        <label style={{ alignItems: "center" }}>
          School default: student portal enabled
          <input
            type="checkbox"
            checked={defaultEnabled}
            onChange={(e) => setDefaultEnabled(e.target.checked)}
          />
        </label>
        <div><button type="submit">Save default</button></div>
      </form>
      {message ? <p>{message}</p> : null}
      {yearGroups.length === 0 ? (
        <EmptyState
          title="No year groups yet"
          description="Create year groups first, then set Student Portal access by year."
        />
      ) : (
      <table>
        <thead>
          <tr><th>Year group</th><th>Override</th><th>Effective</th></tr>
        </thead>
        <tbody>
          {yearGroups.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <select
                  value={row.override === null ? "inherit" : row.override ? "on" : "off"}
                  onChange={(e) => saveYearGroup(row.id, e.target.value)}
                >
                  <option value="inherit">Inherit school default</option>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </td>
              <td>{row.effectiveEnabled ? "Enabled" : "Off"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </>
  );
}
