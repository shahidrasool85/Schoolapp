"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert, DataTable, EmptyState, FilterBar, PageHeader, StatusBadge } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { isoWeekRange, startOfIsoWeek } from "../../../../lib/dates";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type Option = { id: string; name: string };
type Staff = { id: string; fullName?: string; name?: string };
type PeriodOption = Option & { startsAt?: string; endsAt?: string; isActive?: boolean };
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
  className: string | null;
  subjectName: string | null;
  roomName: string | null;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hhmm(value: string | undefined): string {
  return (value ?? "").slice(0, 5);
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
  const [years, setYears] = useState<Array<Option & { isCurrent?: boolean }>>([]);
  const [classId, setClassId] = useState("");
  const [staffProfileId, setStaffProfileId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [customTime, setCustomTime] = useState(false);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === periodId) ?? null,
    [periods, periodId],
  );
  const derivedStarts = customTime ? "" : hhmm(selectedPeriod?.startsAt);
  const derivedEnds = customTime ? "" : hhmm(selectedPeriod?.endsAt);

  async function loadOptions() {
    const [classBody, staffBody, roomBody, subjectBody, yearBody, profileBody] = await Promise.all([
      api<{ classes: Option[] }>("/api/v1/classes"),
      api<{ staff: Staff[] }>("/api/v1/staff"),
      api<{ rooms: Option[] }>("/api/v1/timetable/rooms"),
      api<{ subjects: Option[] }>("/api/v1/subjects"),
      api<{ academicYears: Array<Option & { isCurrent: boolean }> }>("/api/v1/academic-years"),
      api<{
        profiles: Array<{
          name: string;
          periods: Array<PeriodOption>;
        }>;
      }>("/api/v1/timetable/school-day-profiles"),
    ]);
    setClasses(classBody.classes);
    setTeachers(staffBody.staff);
    setRooms(roomBody.rooms);
    setSubjects(subjectBody.subjects);
    setYears(yearBody.academicYears);
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
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const yearId = String(form.get("academicYearId") ?? years.find((year) => year.isCurrent)?.id ?? "");
    const selected = String(form.get("periodId") ?? "") || null;
    const useCustom = customTime || !selected;
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
          effectiveFrom: String(form.get("effectiveFrom") ?? "2026-09-01"),
          teachers: [{ staffProfileId: String(form.get("staffProfileId") ?? ""), isPrimary: true }],
        }),
      });
      setMessage(created.message ?? "Recurring lesson saved.");
      event.currentTarget.reset();
      setPeriodId("");
      setCustomTime(false);
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not save that timetable entry."));
    }
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
          description="If a recurring lesson was saved, its first occurrence may be in a later week. Try the week of 7 September 2026 for the demo year."
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
            </>
          }
        >
          {occurrences.map((lesson) => (
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
            </tr>
          ))}
        </DataTable>
      )}
      {canManage ? (
        <>
          <h2>Add a recurring lesson</h2>
          <form className="card form-grid" onSubmit={onCreate}>
            <label>
              Academic year
              <select name="academicYearId" defaultValue={years.find((year) => year.isCurrent)?.id}>
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
              <input name="effectiveFrom" type="date" defaultValue="2026-09-01" />
            </label>
            <div>
              <button type="submit">Save lesson</button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">School-wide timetable changes are managed by school administration.</p>
      )}
      {entries.length > 0 ? (
        <p className="muted">{entries.length} recurring definitions match the current filters.</p>
      ) : null}
      <p>
        <Link href="/school/timetable/cover">Assign cover or record a change</Link>
      </p>
    </>
  );
}
