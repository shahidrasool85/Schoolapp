"use client";

import { FormEvent, useEffect, useState } from "react";
import { captureSubmitTarget, resetFormSafely } from "@schoolapp/domain";
import { Alert, EmptyState } from "../../../../components/ui";
import { SetupReturnBanner } from "../../../../components/setup-return-banner";
import { api, ApiError } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type Period = {
  id: string;
  name: string;
  periodType: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  isActive?: boolean;
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

function hhmm(value: string): string {
  return value.slice(0, 5);
}

export default function SchoolDayPage() {
  const permissions = usePermissions();
  const canManage = permissions.has("timetable.manage_school");
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    const weekdays = [1, 2, 3, 4, 5].filter((day) => form.get(`d${day}`) === "on");
    setSaving(true);
    setError("");
    setNotice("");
    try {
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
      resetFormSafely(formEl);
      setDirty(false);
      setSaved(true);
      setNotice("School-day profile saved. You can add periods below or return to School Setup.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add a school-day profile."));
    } finally {
      setSaving(false);
    }
  }

  async function addPeriod(event: FormEvent<HTMLFormElement>, profileId: string) {
    event.preventDefault();
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setNotice("");
    try {
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
      resetFormSafely(formEl);
      setSaved(true);
      setNotice("Period added. You can add more, or return to School Setup.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not add a period."));
    }
  }

  async function savePeriod(event: FormEvent<HTMLFormElement>, periodId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/timetable/periods/${periodId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          startsAt: String(form.get("startsAt") ?? ""),
          endsAt: String(form.get("endsAt") ?? ""),
          sortOrder: Number(form.get("sortOrder") || 0),
        }),
      });
      setEditingId(null);
      setNotice("Period updated.");
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not update that period."));
    }
  }

  async function deletePeriod(period: Period) {
    if (!confirm(`Delete ${period.name}? This is blocked if the period is used by timetable lessons.`)) return;
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/timetable/periods/${period.id}`, { method: "DELETE" });
      setNotice(`${period.name} deleted.`);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message);
        return;
      }
      setError(userFacingError(err, "Could not delete that period."));
    }
  }

  async function deactivatePeriod(period: Period) {
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/timetable/periods/${period.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      });
      setNotice(`${period.name} deactivated. Historical timetable lessons are unchanged.`);
      await load();
    } catch (err) {
      setError(userFacingError(err, "Could not deactivate that period."));
    }
  }

  return (
    <>
      <SetupReturnBanner dirty={dirty} afterSave={saved} />
      <h1>School day / Periods</h1>
      <p className="muted">
        Define weekday structures. Friday can finish earlier than the rest of the week. Add a
        profile with start and end times, then add lesson and break periods.
      </p>
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
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <p className="error">{error}</p> : null}
      {permissions.ready && canManage ? (
        <form className="card form-grid" onSubmit={createProfile} onChange={() => setDirty(true)}>
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
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add school-day profile"}
            </button>
          </div>
        </form>
      ) : permissions.ready ? (
        <p className="muted">Period definitions are managed by school administration.</p>
      ) : null}
      {profiles.length === 0 ? (
        <EmptyState
          title="No school-day profiles yet"
          description="Add a weekday profile with start and end times, then define periods for lessons and breaks."
        />
      ) : null}
      {profiles.map((profile) => (
        <section className="card" key={profile.id}>
          <h2>{profile.name}</h2>
          <p className="muted">
            {profile.weekdays.map((day) => DAYS[day - 1]).join(", ")} · {hhmm(profile.startsAt)}–
            {hhmm(profile.endsAt)} {profile.isActive ? "" : "(inactive)"}
          </p>
          {profile.periods.length === 0 ? <p>No periods in this profile.</p> : (
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Type</th>
                  <th>Time</th>
                  {canManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {profile.periods.map((period) => (
                  <tr key={period.id}>
                    {editingId === period.id && canManage ? (
                      <td colSpan={4}>
                        <form className="form-grid" onSubmit={(event) => savePeriod(event, period.id)}>
                          <label>
                            Name
                            <input name="name" required defaultValue={period.name} />
                          </label>
                          <label>
                            Starts
                            <input name="startsAt" type="time" required defaultValue={hhmm(period.startsAt)} />
                          </label>
                          <label>
                            Ends
                            <input name="endsAt" type="time" required defaultValue={hhmm(period.endsAt)} />
                          </label>
                          <label>
                            Order
                            <input name="sortOrder" type="number" defaultValue={period.sortOrder} />
                          </label>
                          <div>
                            <button type="submit">Save</button>{" "}
                            <button type="button" onClick={() => setEditingId(null)}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    ) : (
                      <>
                        <td>
                          {period.name}
                          {period.isActive === false ? " (inactive)" : ""}
                        </td>
                        <td>{period.periodType}</td>
                        <td>
                          {hhmm(period.startsAt)}–{hhmm(period.endsAt)}
                        </td>
                        {canManage ? (
                          <td>
                            <button type="button" onClick={() => setEditingId(period.id)}>
                              Edit
                            </button>{" "}
                            <button type="button" onClick={() => void deletePeriod(period)}>
                              Delete
                            </button>
                            {period.isActive !== false ? (
                              <>
                                {" "}
                                <button type="button" onClick={() => void deactivatePeriod(period)}>
                                  Deactivate
                                </button>
                              </>
                            ) : null}
                          </td>
                        ) : null}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canManage ? (
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
          ) : null}
        </section>
      ))}
    </>
  );
}
