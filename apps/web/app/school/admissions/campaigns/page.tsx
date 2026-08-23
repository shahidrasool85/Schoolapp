"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Campaign = { id: string; publicCode: string; label: string; enabled: boolean; submissionsCount: number };
type Source = { label: string; code: string; submissions: number };

export default function AdmissionsCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const [campaignBody, sourceBody] = await Promise.all([
      api<{ campaigns: Campaign[] }>("/api/v1/admissions/campaigns"),
      api<{ sources: Source[] }>("/api/v1/admissions/sources"),
    ]);
    setCampaigns(campaignBody.campaigns);
    setSources(sourceBody.sources);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/v1/admissions/campaigns", {
      method: "POST",
      body: JSON.stringify({
        publicCode: form.get("publicCode"),
        label: form.get("label"),
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  return (
    <>
      <h1>Sources / Campaigns</h1>
      {error ? <p className="error">{error}</p> : null}
      <form className="card form-grid" onSubmit={create}>
        <label>
          Code
          <input name="publicCode" placeholder="facebook" required />
        </label>
        <label>
          Label
          <input name="label" placeholder="Facebook" required />
        </label>
        <button type="submit">Add source</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Code</th>
            <th>Enabled</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id}>
              <td>{campaign.label}</td>
              <td>
                <code>?source={campaign.publicCode}</code>
              </td>
              <td>{campaign.enabled ? "Yes" : "No"}</td>
              <td>{campaign.submissionsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Submission counts</h2>
      <ul>
        {sources.map((source) => (
          <li key={`${source.code}-${source.label}`}>
            {source.label}: {source.submissions}
          </li>
        ))}
      </ul>
    </>
  );
}
