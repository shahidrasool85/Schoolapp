"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../../lib/api";

type Period = {
  id: string;
  name: string;
  periodType: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
};
type Profile = {
  id: string;
  name: string;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  periods: Period[];
};
type Year = { id: string; name: string; isCurrent: boolean };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SchoolDayPage() {
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState("");

  async function load(nextYear = yearId) {
    const yearBody = await api<{ academicYears: Year[] }>("/api/v1/academic-years");
    setYears(yearBody.academicYears);
    const selected = nextYear || yearBody.academicYears.find((year) => year.isCurrent)?.id || yearBody.academicYears[0]?.id || "";
    setYearId(selected);
    if (!selected) return;
    const body = await api<{ profiles: Profile[] }>(`/api/v1/timetable/school-day-profiles?academicYearId=${selected}`);
    setProfiles(body.profiles);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weekdays = [1, 2, 3, 4, 5].filter((day) => form.get(`d${day}`) === "on");
    await api("/api/v1/timetable/school-day-profiles", {
      method: "POST",
      body: JSON.stringify({
        academicYearId: yearId,
        name: String(form.get("name") ?? ""),
        weekdays,
        startsAt: String(form.get("startsAt") ?? ""),
        endsAt: String(form.get("endsAt") ?? ""),
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  async function addPeriod(event: FormEvent<HTMLFormElement>, profileId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/v1/timetable/school-day-profiles/${profileId}/periods`, {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        periodType: String(form.get("periodType") ?? "teaching"),
        startsAt: String(form.get("startsAt") ?? ""),
        endsAt: String(form.get("endsAt") ?? ""),
        sortOrder: Number(form.get("sortOrder") || 0),
      }),
    });
    event.currentTarget.reset();
    await load();
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>School day / Periods</h1>
      <p className="muted">Define weekday structures. Friday can finish earlier than the rest of the week.</p>
      <label>
        Academic year
        <select
          value={yearId}
          onChange={(event) => {
            setYearId(event.target.value);
            load(event.target.value).catch((err: Error) => setError(err.message));
          }}
        >
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </select>
      </label>
      <form className="card form-grid" onSubmit={createProfile}>
        <label>
          Profile name
          <input name="name" required placeholder="Standard day" />
        </label>
        <label>
          Starts
          <input name="startsAt" type="time" required defaultValue="08:30" />
        </label>
        <label>
          Ends
          <input name="endsAt" type="time" required defaultValue="15:15" />
        </label>
        <div>
          {DAYS.map((label, index) => (
            <label key={label}>
              <input name={`d${index + 1}`} type="checkbox" defaultChecked={index < 5} /> {label}
            </label>
          ))}
        </div>
        <div>
          <button type="submit">Add school-day profile</button>
        </div>
      </form>
      {profiles.length === 0 ? <p>No school-day profiles yet.</p> : null}
      {profiles.map((profile) => (
        <section className="card" key={profile.id}>
          <h2>{profile.name}</h2>
          <p className="muted">
            {profile.weekdays.map((day) => DAYS[day - 1]).join(", ")} · {profile.startsAt.slice(0, 5)}–
            {profile.endsAt.slice(0, 5)} {profile.isActive ? "" : "(inactive)"}
          </p>
          {profile.periods.length === 0 ? <p>No periods in this profile.</p> : (
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Type</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {profile.periods.map((period) => (
                  <tr key={period.id}>
                    <td>{period.name}</td>
                    <td>{period.periodType}</td>
                    <td>
                      {period.startsAt.slice(0, 5)}–{period.endsAt.slice(0, 5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form className="form-grid" onSubmit={(event) => addPeriod(event, profile.id)}>
            <label>
              Name
              <input name="name" required placeholder="Period 1" />
            </label>
            <label>
              Type
              <select name="periodType" defaultValue="teaching">
                <option value="teaching">Teaching</option>
                <option value="registration">Registration</option>
                <option value="break">Break</option>
                <option value="lunch">Lunch</option>
                <option value="assembly">Assembly</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Starts
              <input name="startsAt" type="time" required />
            </label>
            <label>
              Ends
              <input name="endsAt" type="time" required />
            </label>
            <label>
              Order
              <input name="sortOrder" type="number" defaultValue={profile.periods.length + 1} />
            </label>
            <div>
              <button type="submit">Add period</button>
            </div>
          </form>
        </section>
      ))}
    </>
  );
}
