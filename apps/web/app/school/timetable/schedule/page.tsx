"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  captureSubmitTarget,
  defaultRecurrenceEffectiveFrom,
  defaultStopFromDate,
  DEFAULT_SCHOOL_TIMEZONE,
  resetFormSafely,
  todayInTimeZone,
} from "@schoolapp/domain";
import {
  Alert,
  Button,
  ConfirmationDialog,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  PageHeader,
  StatusBadge,
} from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { isoWeekRange, startOfIsoWeek } from "../../../../lib/dates";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type Option = { id: string; name: string };
type Year = Option & { isCurrent?: boolean; startsOn?: string; endsOn?: string };
type Staff = { id: string; fullName?: string; name?: string };
type PeriodOption = Option & { startsAt?: string; endsAt?: string; isActive?: boolean };
type RecurrenceLifecycle = {
  status?: string;
  canDelete: boolean;
  canEnd: boolean;
  canEditStructure: boolean;
  message: string;
};
type Occurrence = {
  entryId: string;
  date: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  classId: string;
  className: string;
  subjectName: string | null;
  roomName: string | null;
  status: string;
  covered: boolean;
  teachers: Array<{ fullName: string }>;
};
type Entry = {
  id: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  classId?: string;
  className: string | null;
  subjectId?: string | null;
  subjectName: string | null;
  roomId?: string | null;
  roomName: string | null;
  academicYearId?: string;
  lessonType?: string;
  staffNotes?: string | null;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
  lifecycleStatus?: string;
  teachers?: Array<{ staffProfileId: string; fullName: string; isPrimary?: boolean }>;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hhmm(value: string | undefined): string {
  return (value ?? "").slice(0, 5);
}

function statusLabel(status: string | undefined): string {
  if (status === "future") return "Scheduled";
  if (status === "ended") return "Ended";
  if (status === "active") return "Active";
  return status ?? "Active";
}

export default function TimetableSchedulePage() {
  const permissions = usePermissions();
  const canManage = permissions.has("timetable.manage") || permissions.has("timetable.manage_school");
  const [from, setFrom] = useState(() => startOfIsoWeek("2026-09-07"));
  const [classes, setClasses] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Staff[]>([]);
  const [rooms, setRooms] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [timezone, setTimezone] = useState(DEFAULT_SCHOOL_TIMEZONE);
  const [classId, setClassId] = useState("");
  const [staffProfileId, setStaffProfileId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [customTime, setCustomTime] = useState(false);
  const [academicYearId, setAcademicYearId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [ending, setEnding] = useState<{ entry: Entry; lifecycle: RecurrenceLifecycle; stopFrom: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<{ entry: Entry; lifecycle: RecurrenceLifecycle } | null>(null);

  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);
  const selectedYear = years.find((year) => year.id === academicYearId) ?? years.find((year) => year.isCurrent) ?? years[0];
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === periodId) ?? null,
    [periods, periodId],
  );
  const derivedStarts = customTime ? "" : hhmm(selectedPeriod?.startsAt);
  const derivedEnds = customTime ? "" : hhmm(selectedPeriod?.endsAt);

  function applyYearDefault(year: Year | undefined, yearsList = years, asOf = today) {
    const chosen = year ?? yearsList.find((item) => item.isCurrent) ?? yearsList[0];
    if (!chosen) {
      setAcademicYearId("");
      setEffectiveFrom(asOf);
      return;
    }
    setAcademicYearId(chosen.id);
    setEffectiveFrom(
      defaultRecurrenceEffectiveFrom({
        today: asOf,
        academicYearStartsOn: chosen.startsOn ?? asOf,
        academicYearEndsOn: chosen.endsOn,
      }),
    );
  }

  async function loadOptions() {
    const [classBody, staffBody, roomBody, subjectBody, yearBody, profileBody, orgBody] = await Promise.all([
      api<{ classes: Option[] }>("/api/v1/classes"),
      api<{ staff: Staff[] }>("/api/v1/staff"),
      api<{ rooms: Option[] }>("/api/v1/timetable/rooms"),
      api<{ subjects: Option[] }>("/api/v1/subjects"),
      api<{ academicYears: Year[] }>("/api/v1/academic-years"),
      api<{
        profiles: Array<{
          name: string;
          periods: Array<PeriodOption>;
        }>;
      }>("/api/v1/timetable/school-day-profiles"),
      api<{ organisation?: { timezone?: string } }>("/api/v1/organisation").catch(() => ({
        organisation: { timezone: DEFAULT_SCHOOL_TIMEZONE },
      })),
    ]);
    setClasses(classBody.classes);
    setTeachers(staffBody.staff);
    setRooms(roomBody.rooms);
    setSubjects(subjectBody.subjects);
    setYears(yearBody.academicYears);
    const tz = orgBody.organisation?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    setTimezone(tz);
    const asOf = todayInTimeZone(tz);
    setPeriods(
      profileBody.profiles.flatMap((profile) =>
        profile.periods
          .filter((period) => period.isActive !== false)
          .map((period) => ({
            ...period,
            name: `${period.name} — ${hhmm(period.startsAt)}–${hhmm(period.endsAt)}`,
          })),
      ),
    );
    applyYearDefault(
      yearBody.academicYears.find((year) => year.id === academicYearId) ??
        yearBody.academicYears.find((year) => year.isCurrent) ??
        yearBody.academicYears[0],
      yearBody.academicYears,
      asOf,
    );
  }

  async function loadGrid(nextFrom = from, nextClass = classId, nextStaff = staffProfileId, nextRoom = roomId) {
    const week = isoWeekRange(nextFrom);
    const qs = new URLSearchParams({
      week: week.from,
      from: week.from,
      to: week.to,
      includeCancelled: "true",
    });
    if (nextClass) qs.set("classId", nextClass);
    if (nextStaff) qs.set("staffProfileId", nextStaff);
    if (nextRoom) qs.set("roomId", nextRoom);
    const body = await api<{ occurrences: Occurrence[] }>(`/api/v1/timetable/occurrences?${qs}`);
    setOccurrences(body.occurrences);
    const entryQs = new URLSearchParams();
    if (nextClass) entryQs.set("classId", nextClass);
    if (nextStaff) entryQs.set("staffProfileId", nextStaff);
    if (nextRoom) entryQs.set("roomId", nextRoom);
    const entryBody = await api<{ entries: Entry[] }>(`/api/v1/timetable/entries?${entryQs}`);
    setEntries(entryBody.entries);
  }

  useEffect(() => {
    Promise.all([loadOptions(), loadGrid()]).catch((err: Error) => setError(userFacingError(err, "Could not load the timetable.")));
  }, []);

  async function onFilter(event: FormEvent) {
    event.preventDefault();
    setError("");
    await loadGrid();
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    setError("");
    setMessage("");
    const yearId = academicYearId || String(form.get("academicYearId") ?? selectedYear?.id ?? "");
    const year = years.find((item) => item.id === yearId);
    const fromDate = effectiveFrom || String(form.get("effectiveFrom") ?? "");
    if (year?.startsOn && fromDate < year.startsOn) {
      setError("Effective from cannot be before the selected academic year.");
      return;
    }
    const selected = String(form.get("periodId") ?? "") || null;
    const useCustom = customTime || !selected;
    setSaving(true);
    try {
      const created = await api<{
        message?: string;
        firstOccurrence?: { date: string; startsAt: string; endsAt: string } | null;
      }>("/api/v1/timetable/entries", {
        method: "POST",
        body: JSON.stringify({
          academicYearId: yearId,
          schoolDayPeriodId: useCustom ? null : selected,
          customTime: useCustom,
          weekday: Number(form.get("weekday")),
          startsAt: useCustom ? String(form.get("startsAt") ?? "") || undefined : undefined,
          endsAt: useCustom ? String(form.get("endsAt") ?? "") || undefined : undefined,
          classId: String(form.get("classId") ?? ""),
          subjectId: String(form.get("subjectId") ?? "") || null,
          roomId: String(form.get("roomId") ?? "") || null,
          lessonType: String(form.get("lessonType") ?? "lesson"),
          effectiveFrom: fromDate,
          teachers: [{ staffProfileId: String(form.get("staffProfileId") ?? ""), isPrimary: true }],
        }),
      });
      setMessage(created.message ?? "Recurring lesson saved.");
      resetFormSafely(formEl);
      setPeriodId("");
      setCustomTime(false);
      applyYearDefault(year);
      const nextFrom = created.firstOccurrence?.date ? startOfIsoWeek(created.firstOccurrence.date) : from;
      if (nextFrom !== from) setFrom(nextFrom);
      await loadGrid(nextFrom);
    } catch (err) {
      setError(userFacingError(err, "Could not save that timetable entry."));
    } finally {
      setSaving(false);
    }
  }

  async function openLifecycle(entry: Entry, mode: "edit" | "end" | "delete") {
    setError("");
    const body = await api<{ entry: Entry & { lifecycle: RecurrenceLifecycle }; today: string }>(
      `/api/v1/timetable/entries/${entry.id}/lifecycle`,
    );
    if (mode === "edit") {
      setEditing(body.entry);
      return;
    }
    if (mode === "end") {
      setEnding({
        entry: body.entry,
        lifecycle: body.entry.lifecycle,
        stopFrom: defaultStopFromDate(body.today || today),
      });
      return;
    }
    setDeleting({ entry: body.entry, lifecycle: body.entry.lifecycle });
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const formEl = captureSubmitTarget(event);
    const form = new FormData(formEl);
    try {
      const payload: Record<string, unknown> = {
        staffNotes: String(form.get("staffNotes") ?? "") || null,
      };
      if (editing.lifecycleStatus === "future") {
        payload.weekday = Number(form.get("weekday"));
        payload.classId = String(form.get("classId") ?? editing.classId ?? "");
        payload.subjectId = String(form.get("subjectId") ?? "") || null;
        payload.roomId = String(form.get("roomId") ?? "") || null;
        payload.effectiveFrom = String(form.get("effectiveFrom") ?? editing.effectiveFrom);
        payload.teachers = [{ staffProfileId: String(form.get("staffProfileId") ?? ""), isPrimary: true }];
      }
      await api(`/api/v1/timetable/entries/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setEditing(null);
      setMessage("Recurring lesson updated.");
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not update that recurring lesson."));
    }
  }

  async function confirmEnd() {
    if (!ending) return;
    try {
      const body = await api<{ message?: string }>(`/api/v1/timetable/entries/${ending.entry.id}/end`, {
        method: "POST",
        body: JSON.stringify({ stopFrom: ending.stopFrom }),
      });
      setEnding(null);
      setMessage(body.message ?? "Recurrence ended. Past timetable history is kept.");
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not end that recurrence."));
      setEnding(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/api/v1/timetable/entries/${deleting.entry.id}`, { method: "DELETE" });
      setDeleting(null);
      setMessage("Future recurrence deleted.");
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not delete that recurrence."));
      setDeleting(null);
    }
  }

  function RecurrenceActions({ entry }: { entry: Entry }) {
    if (!canManage) return null;
    const ended = entry.lifecycleStatus === "ended";
    const future = entry.lifecycleStatus === "future";
    return (
      <div className="table-actions">
        {!ended ? (
          <Button type="button" variant="secondary" onClick={() => void openLifecycle(entry, "edit")}>
            Edit
          </Button>
        ) : null}
        {!ended ? (
          <Button type="button" variant="ghost" onClick={() => void openLifecycle(entry, "end")}>
            End recurrence
          </Button>
        ) : null}
        {future ? (
          <Button type="button" variant="ghost" onClick={() => void openLifecycle(entry, "delete")}>
            Delete future recurrence
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Timetable"
        description="Filter by week, class, teacher, or room. Selecting a date snaps to the Monday of that week."
      />
      <FilterBar onSubmit={(event) => onFilter(event).catch((err: Error) => setError(userFacingError(err)))} actions={<button type="submit">Apply filters</button>}>
        <label htmlFor="schedule-week">
          Week commencing
          <input
            id="schedule-week"
            type="date"
            value={from}
            onChange={(event) => setFrom(startOfIsoWeek(event.target.value))}
          />
        </label>
        <label htmlFor="schedule-class">
          Class
          <select id="schedule-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="">All authorised classes</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="schedule-teacher">
          Teacher
          <select id="schedule-teacher" value={staffProfileId} onChange={(event) => setStaffProfileId(event.target.value)}>
            <option value="">Any teacher</option>
            {teachers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName ?? item.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="schedule-room">
          Room
          <select id="schedule-room" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">Any room</option>
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      ) : null}
      {occurrences.length === 0 ? (
        <EmptyState
          title="No lessons in this view"
          description="If a recurring lesson was saved, its first occurrence may be in a later week. The week view updates automatically after a successful save."
        />
      ) : (
        <DataTable
          headers={
            <>
              <th>Day</th>
              <th>Time</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Teacher</th>
              <th>Room</th>
              <th>Status</th>
              {canManage ? <th className="num">Actions</th> : null}
            </>
          }
        >
          {occurrences.map((lesson) => {
            const source = entries.find((item) => item.id === lesson.entryId);
            return (
              <tr key={`${lesson.entryId}-${lesson.date}`}>
                <td>
                  {DAYS[lesson.weekday - 1]} {lesson.date}
                </td>
                <td>
                  {hhmm(lesson.startsAt)}–{hhmm(lesson.endsAt)}
                </td>
                <td>{lesson.className}</td>
                <td>{lesson.subjectName ?? "—"}</td>
                <td>{lesson.teachers.map((teacher) => teacher.fullName).join(", ")}</td>
                <td>{lesson.roomName ?? "—"}</td>
                <td>
                  <StatusBadge status={lesson.covered ? "Cover" : lesson.status} />
                </td>
                {canManage ? (
                  <td className="num">
                    {source ? <RecurrenceActions entry={source} /> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </DataTable>
      )}
      {canManage ? (
        <>
          <h2>Add a recurring lesson</h2>
          <form className="card form-grid" onSubmit={onCreate}>
            <label>
              Academic year
              <select
                name="academicYearId"
                value={academicYearId}
                onChange={(event) => {
                  const next = years.find((year) => year.id === event.target.value);
                  applyYearDefault(next);
                }}
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Weekday
              <select name="weekday" defaultValue={1}>
                {DAYS.slice(0, 7).map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select
                name="periodId"
                value={customTime ? "" : periodId}
                onChange={(event) => {
                  setCustomTime(false);
                  setPeriodId(event.target.value);
                }}
                disabled={customTime}
              >
                <option value="">Select period</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ alignItems: "center" }}>
              Custom time
              <input
                type="checkbox"
                checked={customTime}
                onChange={(event) => {
                  setCustomTime(event.target.checked);
                  if (event.target.checked) setPeriodId("");
                }}
              />
            </label>
            {customTime ? (
              <>
                <label>
                  Starts
                  <input name="startsAt" type="time" required />
                </label>
                <label>
                  Ends
                  <input name="endsAt" type="time" required />
                </label>
              </>
            ) : (
              <p className="muted">
                Time: {derivedStarts && derivedEnds ? `${derivedStarts}–${derivedEnds}` : "Select a period"}
                <span> (from the school-day period)</span>
              </p>
            )}
            <label>
              Class
              <select name="classId" required>
                <option value="">Select class</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <select name="subjectId">
                <option value="">None</option>
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Room
              <select name="roomId">
                <option value="">No room</option>
                {rooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Teacher
              <select name="staffProfileId" required>
                <option value="">Select teacher</option>
                {teachers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName ?? item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select name="lessonType" defaultValue="lesson">
                <option value="lesson">Lesson</option>
                <option value="registration">Registration</option>
                <option value="assembly">Assembly</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Effective from
              <input
                name="effectiveFrom"
                type="date"
                value={effectiveFrom}
                min={selectedYear?.startsOn}
                max={selectedYear?.endsOn}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                required
              />
            </label>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save lesson"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">School-wide timetable changes are managed by school administration.</p>
      )}
      {entries.length > 0 ? (
        <>
          <h2>Recurring definitions</h2>
          <p className="muted">
            {entries.length} recurring definition{entries.length === 1 ? "" : "s"} match the current filters. Actions
            apply to the recurrence, not a single generated lesson.
          </p>
          <DataTable
            headers={
              <>
                <th>Day</th>
                <th>Time</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Effective</th>
                <th>Status</th>
                {canManage ? <th className="num">Actions</th> : null}
              </>
            }
          >
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{DAYS[entry.weekday - 1]}</td>
                <td>
                  {hhmm(entry.startsAt)}–{hhmm(entry.endsAt)}
                </td>
                <td>{entry.className ?? "—"}</td>
                <td>{entry.subjectName ?? "—"}</td>
                <td>
                  {entry.effectiveFrom}
                  {entry.effectiveUntil ? ` → ${entry.effectiveUntil}` : ""}
                </td>
                <td>
                  <StatusBadge status={statusLabel(entry.lifecycleStatus)} />
                </td>
                {canManage ? (
                  <td className="num">
                    <RecurrenceActions entry={entry} />
                  </td>
                ) : null}
              </tr>
            ))}
          </DataTable>
        </>
      ) : (
        <p className="muted">No recurring definitions match the current filters.</p>
      )}
      <p>
        <Link href="/school/timetable/cover">Assign cover or record a change</Link>
      </p>
      <Dialog
        open={Boolean(editing)}
        title={editing ? `Edit ${editing.className ?? "recurring lesson"}` : "Edit recurring lesson"}
        description={
          editing?.lifecycleStatus === "future"
            ? "This recurrence has not started. Changes apply to the definition."
            : "This recurrence has history. Only notes can be changed here. End it from a date to stop future lessons."
        }
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="academic-create-form is-dialog" onSubmit={saveEdit}>
            {editing.lifecycleStatus === "future" ? (
              <div className="academic-create-fields is-three">
                <FormField label="Weekday">
                  <select name="weekday" defaultValue={editing.weekday}>
                    {DAYS.map((day, index) => (
                      <option key={day} value={index + 1}>
                        {day}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Class">
                  <select name="classId" defaultValue={editing.classId}>
                    {classes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Effective from">
                  <Input name="effectiveFrom" type="date" defaultValue={editing.effectiveFrom} required />
                </FormField>
                <FormField label="Subject">
                  <select name="subjectId" defaultValue={editing.subjectId ?? ""}>
                    <option value="">None</option>
                    {subjects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Room">
                  <select name="roomId" defaultValue={editing.roomId ?? ""}>
                    <option value="">No room</option>
                    {rooms.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Teacher">
                  <select name="staffProfileId" defaultValue={editing.teachers?.[0]?.staffProfileId} required>
                    {teachers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fullName ?? item.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            ) : null}
            <FormField label="Staff notes">
              <Input name="staffNotes" defaultValue={editing.staffNotes ?? ""} />
            </FormField>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(ending)}
        title={ending ? `End recurrence for ${ending.entry.className ?? "this lesson"}?` : "End recurrence"}
        description="Lessons on or after the stop date will not be generated. Past timetable history, attendance and cover stay in place."
        onClose={() => setEnding(null)}
      >
        {ending ? (
          <form
            className="academic-create-form is-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmEnd();
            }}
          >
            <FormField label="Stop from">
              <Input
                type="date"
                value={ending.stopFrom}
                min={today}
                onChange={(event) => setEnding({ ...ending, stopFrom: event.target.value })}
                required
              />
            </FormField>
            <p className="muted">{ending.lifecycle.message}</p>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEnding(null)}>
                {ending.lifecycle.canEnd ? "Cancel" : "Close"}
              </Button>
              {ending.lifecycle.canEnd ? <Button type="submit">End recurrence</Button> : null}
            </div>
          </form>
        ) : null}
      </Dialog>
      <ConfirmationDialog
        open={Boolean(deleting)}
        title={deleting ? `Delete future recurrence for “${deleting.entry.className}”?` : "Delete future recurrence"}
        description={
          deleting?.lifecycle.canDelete
            ? "This recurrence has not started and has no timetable history. It will be removed."
            : deleting?.lifecycle.message || "This recurrence cannot be deleted."
        }
        confirmLabel={deleting?.lifecycle.canDelete ? "Delete future recurrence" : "Close"}
        danger={Boolean(deleting?.lifecycle.canDelete)}
        onConfirm={() => {
          if (!deleting?.lifecycle.canDelete) {
            setDeleting(null);
            return;
          }
          void confirmDelete();
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
