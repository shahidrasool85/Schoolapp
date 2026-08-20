"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Entry = {
  id: string;
  applicationId: string;
  applicationReference: string | null;
  pupilLegalName: string | null;
  intendedAcademicYearName: string | null;
  intendedYearGroupName: string | null;
  status: string;
  priority: number | null;
  addedAt: string;
};

type Option = { id: string; name: string };

export default function WaitingListPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [yearGroupId, setYearGroupId] = useState("");
  const [error, setError] = useState("");

  async function load(group = yearGroupId) {
    const params = new URLSearchParams({ status: "active" });
    if (group) params.set("yearGroupId", group);
    const [list, yg] = await Promise.all([
      api<{ entries: Entry[] }>(`/api/v1/admissions/waiting-list?${params}`),
      api<{ yearGroups: Option[] }>("/api/v1/year-groups"),
    ]);
    setEntries(list.entries);
    setGroups(yg.yearGroups);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <div className="toolbar">
        <h1>Waiting list</h1>
        <select
          value={yearGroupId}
          onChange={(e) => {
            setYearGroupId(e.target.value);
            load(e.target.value).catch((err: Error) => setError(err.message));
          }}
        >
          <option value="">All year groups</option>
          {groups.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </div>
      <p className="muted">
        Priority is optional and staff-managed. The system does not rank by first-come-first-served.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Application</th>
            <th>Pupil</th>
            <th>Intake</th>
            <th>Year group</th>
            <th>Priority</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/school/admissions/applications/${row.applicationId}`}>
                  {row.applicationReference}
                </Link>
              </td>
              <td>{row.pupilLegalName}</td>
              <td>{row.intendedAcademicYearName ?? "—"}</td>
              <td>{row.intendedYearGroupName ?? "—"}</td>
              <td>{row.priority ?? "—"}</td>
              <td>{row.addedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
