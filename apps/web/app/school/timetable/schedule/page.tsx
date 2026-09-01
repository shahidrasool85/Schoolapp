"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  captureSubmitTarget,
  defaultRecurrenceEffectiveFrom,
  defaultRepeatUntilKind,
  defaultStopFromDate,
  DEFAULT_SCHOOL_TIMEZONE,
  formatUkCalendarDate,
  recurrenceEndsLabel,
  resetFormSafely,
  todayInTimeZone,
  type RepeatUntilKind,
} from "@schoolapp/domain";
import { TimetableWeekNav } from "../../../../components/timetable-week-nav";
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
import { formatDate, isoWeekRange, startOfIsoWeek } from "../../../../lib/dates";
import { userFacingError } from "../../../../lib/errors";
import { usePermissions } from "../../../../lib/use-permissions";

type Option = { id: string; name: string };
type Year = Option & { isCurrent?: boolean; startsOn?: string; endsOn?: string };
type Term = Option & { startsOn: string; endsOn: string };
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
type RecurrencePreview = {
  effectiveFrom: string;
  effectiveUntil: string | null;
  repeatUntilLabel: string;
  occurrenceCount: number;
  dates: string[];
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  className: string | null;
  subjectName: string | null;
  roomName: string | null;
  teacherNames: string[];
  weekday: number;
  startsAt: string | null;
  endsAt: string | null;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hhmm(value: string | undefined | null): string {
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
  const [timezone, setTimezone] = useState(DEFAULT_SCHOOL_TIMEZONE);
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);
  const [from, setFrom] = useState(() => startOfIsoWeek(todayInTimeZone(DEFAULT_SCHOOL_TIMEZONE)));
  const [classes, setClasses] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Staff[]>([]);
  const [rooms, setRooms] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
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
  const [weekday, setWeekday] = useState(1);
  const [createClassId, setCreateClassId] = useState("");
  const [createSubjectId, setCreateSubjectId] = useState("");
  const [createRoomId, setCreateRoomId] = useState("");
  const [createTeacherId, setCreateTeacherId] = useState("");
  const [lessonType, setLessonType] = useState("lesson");
  const [repeatUntilKind, setRepeatUntilKind] = useState<RepeatUntilKind>("end_of_term");
  const [customUntil, setCustomUntil] = useState("");
  const [occurrenceCount, setOccurrenceCount] = useState(6);
  const [preview, setPreview] = useState<RecurrencePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [applyFrom, setApplyFrom] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [ending, setEnding] = useState<{
    entry: Entry;
    lifecycle: RecurrenceLifecycle;
    stopFrom: string;
    lastScheduledLesson: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<{ entry: Entry; lifecycle: RecurrenceLifecycle } | null>(null);

  const selectedYear = years.find((year) => year.id === academicYearId) ?? years.find((year) => year.isCurrent) ?? years[0];
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === periodId) ?? null,
    [periods, periodId],
  );
  const derivedStarts = customTime ? "" : hhmm(selectedPeriod?.startsAt);
  const derivedEnds = customTime ? "" : hhmm(selectedPeriod?.endsAt);
  const termsConfigured = terms.length > 0;

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

  async function loadTerms(yearId: string, nextKind?: RepeatUntilKind) {
    if (!yearId) {
      setTerms([]);
      setRepeatUntilKind(nextKind ?? "end_of_academic_year");
      return;
    }
    const body = await api<{ terms: Term[] }>(`/api/v1/academic-years/${yearId}/terms`);
    setTerms(body.terms);
    const kind = nextKind ?? defaultRepeatUntilKind(body.terms.length > 0);
    setRepeatUntilKind(kind === "end_of_term" && body.terms.length === 0 ? "end_of_academic_year" : kind);
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
    setFrom((current) => (current === startOfIsoWeek(todayInTimeZone(DEFAULT_SCHOOL_TIMEZONE)) ? startOfIsoWeek(asOf) : current));
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
    const year =
      yearBody.academicYears.find((item) => item.id === academicYearId) ??
      yearBody.academicYears.find((item) => item.isCurrent) ??
      yearBody.academicYears[0];
    applyYearDefault(year, yearBody.academicYears, asOf);
    if (year?.id) await loadTerms(year.id);
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

  function goToWeek(next: string) {
    setFrom(next);
    loadGrid(next).catch((err: Error) => setError(userFacingError(err)));
  }

  function repeatUntilPayload() {
    if (repeatUntilKind === "custom_date") return { kind: "custom_date" as const, date: customUntil };
    if (repeatUntilKind === "occurrence_count") {
      return { kind: "occurrence_count" as const, count: Number(occurrenceCount) };
    }
    return { kind: repeatUntilKind };
  }

  async function refreshPreview() {
    if (!canManage || !academicYearId || !effectiveFrom) {
      setPreview(null);
      return;
    }
    if (repeatUntilKind === "custom_date" && !customUntil) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    setPreviewLoading(true);
    try {
      const body = await api<{ preview: RecurrencePreview }>("/api/v1/timetable/entries/preview", {
        method: "POST",
        body: JSON.stringify({
          academicYearId,
          weekday,
          effectiveFrom,
          schoolDayPeriodId: customTime ? null : periodId || null,
          customTime,
          classId: createClassId || undefined,
          subjectId: createSubjectId || null,
          roomId: createRoomId || null,
          teachers: createTeacherId ? [{ staffProfileId: createTeacherId, isPrimary: true }] : undefined,
          repeatUntil: repeatUntilPayload(),
        }),
      });
      setPreview(body.preview);
      setPreviewError("");
    } catch (err) {
      setPreview(null);
      setPreviewError(userFacingError(err, "Could not preview this recurring lesson."));
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([loadOptions(), loadGrid()]).catch((err: Error) => setError(userFacingError(err, "Could not load the timetable.")));
  }, []);

  useEffect(() => {
    if (!canManage) return;
    const handle = window.setTimeout(() => {
      void refreshPreview();
    }, 280);
    return () => window.clearTimeout(handle);
  }, [
    canManage,
    academicYearId,
    weekday,
    effectiveFrom,
    periodId,
    customTime,
    createClassId,
    createSubjectId,
    createRoomId,
    createTeacherId,
    repeatUntilKind,
    customUntil,
    occurrenceCount,
  ]);

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
      setError("The start date cannot be before the selected academic year.");
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
          weekday,
          startsAt: useCustom ? String(form.get("startsAt") ?? "") || undefined : undefined,
          endsAt: useCustom ? String(form.get("endsAt") ?? "") || undefined : undefined,
          classId: createClassId || String(form.get("classId") ?? ""),
          subjectId: createSubjectId || String(form.get("subjectId") ?? "") || null,
          roomId: createRoomId || String(form.get("roomId") ?? "") || null,
          lessonType,
          effectiveFrom: fromDate,
          teachers: [{ staffProfileId: createTeacherId || String(form.get("staffProfileId") ?? ""), isPrimary: true }],
          repeatUntil: repeatUntilPayload(),
        }),
      });
      setMessage(created.message ?? "Recurring lesson saved.");
      resetFormSafely(formEl);
      setPeriodId("");
      setCustomTime(false);
      setCreateClassId("");
      setCreateSubjectId("");
      setCreateRoomId("");
      setCreateTeacherId("");
      setLessonType("lesson");
      setWeekday(1);
      setShowDates(false);
      applyYearDefault(year);
      if (yearId) await loadTerms(yearId);
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
    const stopFrom = defaultStopFromDate(today);
    const body = await api<{
      entry: Entry & { lifecycle: RecurrenceLifecycle };
      today: string;
      lastScheduledLesson: string | null;
    }>(`/api/v1/timetable/entries/${entry.id}/lifecycle${mode === "end" ? `?stopFrom=${stopFrom}` : ""}`);
    if (mode === "edit") {
      setEditing(body.entry);
      setApplyFrom(defaultStopFromDate(body.today || today));
      return;
    }
    if (mode === "end") {
      setEnding({
        entry: body.entry,
        lifecycle: body.entry.lifecycle,
        stopFrom,
        lastScheduledLesson: body.lastScheduledLesson,
      });
      return;
    }
    setDeleting({ entry: body.entry, lifecycle: body.entry.lifecycle });
  }

  async function updateEndPreview(stopFrom: string) {
    if (!ending) return;
    setEnding({ ...ending, stopFrom });
    try {
      const body = await api<{ lastScheduledLesson: string | null }>(
        `/api/v1/timetable/entries/${ending.entry.id}/lifecycle?stopFrom=${stopFrom}`,
      );
      setEnding((current) => (current ? { ...current, stopFrom, lastScheduledLesson: body.lastScheduledLesson } : current));
    } catch {
      /* keep the selected stop date even if the preview refresh fails */
    }
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

  async function applyStructuralChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || replacing) return;
    const form = new FormData(captureSubmitTarget(event));
    setReplacing(true);
    try {
      const body = await api<{ message?: string }>(`/api/v1/timetable/entries/${editing.id}/replace`, {
        method: "POST",
        body: JSON.stringify({
          applyFrom,
          weekday: Number(form.get("replaceWeekday") ?? editing.weekday),
          classId: String(form.get("replaceClassId") ?? editing.classId ?? ""),
          subjectId: String(form.get("replaceSubjectId") ?? "") || null,
          roomId: String(form.get("replaceRoomId") ?? "") || null,
          teachers: [{ staffProfileId: String(form.get("replaceStaffProfileId") ?? ""), isPrimary: true }],
          repeatUntil: { kind: "end_of_academic_year" },
        }),
      });
      setEditing(null);
      setMessage(body.message ?? "The recurring lesson now continues from the chosen date.");
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not apply that change from the chosen date."));
    } finally {
      setReplacing(false);
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
      setMessage(body.message ?? "Recurring lesson ended. Past timetable history is kept.");
      await loadGrid();
    } catch (err) {
      setError(userFacingError(err, "Could not end that recurring lesson."));
      setEnding(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/api/v1/timetable/entries/${deleting.entry.id}`, { method: "DELETE" });
      setDeleting(null);
      setMessage("Unused future recurrence deleted.");
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
            Delete
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="School Timetable"
        description="Manage the school's weekly timetable and the recurring lesson rules that generate it."
      />
      <FilterBar onSubmit={(event) => onFilter(event).catch((err: Error) => setError(userFacingError(err)))} actions={<button type="submit">Show week</button>}>
        <TimetableWeekNav weekFrom={from} today={today} inputId="schedule-week" onWeekChange={goToWeek} />
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
      <h2>Weekly school timetable</h2>
      <p className="muted">Generated lessons for the selected week. These come from the recurring lesson rules below.</p>
      {occurrences.length === 0 ? (
        <EmptyState
          title="No lessons in this week"
          description="If a recurring lesson was saved, its first occurrence may be in a later week. Use previous or next week to look around the calendar."
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
                  {DAYS[lesson.weekday - 1]} {formatDate(lesson.date)}
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
          <p className="muted">
            Repeat this lesson every selected weekday and time from the start date until the chosen end, only on valid
            teaching dates.
          </p>
          <form className="card form-grid" onSubmit={onCreate}>
            <label>
              Academic year
              <select
                name="academicYearId"
                value={academicYearId}
                onChange={(event) => {
                  const next = years.find((year) => year.id === event.target.value);
                  applyYearDefault(next);
                  if (next?.id) void loadTerms(next.id);
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
              <select name="weekday" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                {DAYS.map((day, index) => (
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
              <select name="classId" value={createClassId} onChange={(event) => setCreateClassId(event.target.value)} required>
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
              <select name="subjectId" value={createSubjectId} onChange={(event) => setCreateSubjectId(event.target.value)}>
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
              <select name="roomId" value={createRoomId} onChange={(event) => setCreateRoomId(event.target.value)}>
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
              <select
                name="staffProfileId"
                value={createTeacherId}
                onChange={(event) => setCreateTeacherId(event.target.value)}
                required
              >
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
              <select name="lessonType" value={lessonType} onChange={(event) => setLessonType(event.target.value)}>
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
            <fieldset className="academic-create-fields" style={{ gridColumn: "1 / -1" }}>
              <legend>Repeat until</legend>
              <p className="muted">
                {termsConfigured
                  ? "End of term is recommended when the start date falls inside a configured term."
                  : "This academic year has no terms yet, so lessons use the academic year dates."}
              </p>
              <label>
                <input
                  type="radio"
                  name="repeatUntilKind"
                  value="end_of_term"
                  checked={repeatUntilKind === "end_of_term"}
                  disabled={!termsConfigured}
                  onChange={() => setRepeatUntilKind("end_of_term")}
                />{" "}
                End of term
              </label>
              {!termsConfigured ? (
                <p className="muted">
                  Configure term dates first.{" "}
                  {selectedYear ? (
                    <Link href={`/school/academic-years/${selectedYear.id}/terms`}>
                      Academic setup → Academic years → Terms
                    </Link>
                  ) : (
                    <Link href="/school/academic-years">Academic setup → Academic years → Terms</Link>
                  )}
                </p>
              ) : null}
              <label>
                <input
                  type="radio"
                  name="repeatUntilKind"
                  value="end_of_academic_year"
                  checked={repeatUntilKind === "end_of_academic_year"}
                  onChange={() => setRepeatUntilKind("end_of_academic_year")}
                />{" "}
                End of academic year
              </label>
              <label>
                <input
                  type="radio"
                  name="repeatUntilKind"
                  value="custom_date"
                  checked={repeatUntilKind === "custom_date"}
                  onChange={() => setRepeatUntilKind("custom_date")}
                />{" "}
                Custom date
              </label>
              {repeatUntilKind === "custom_date" ? (
                <label>
                  Last date
                  <input
                    type="date"
                    value={customUntil}
                    min={effectiveFrom || selectedYear?.startsOn}
                    max={selectedYear?.endsOn}
                    onChange={(event) => setCustomUntil(event.target.value)}
                    required
                  />
                </label>
              ) : null}
              <label>
                <input
                  type="radio"
                  name="repeatUntilKind"
                  value="occurrence_count"
                  checked={repeatUntilKind === "occurrence_count"}
                  onChange={() => setRepeatUntilKind("occurrence_count")}
                />{" "}
                Number of occurrences
              </label>
              {repeatUntilKind === "occurrence_count" ? (
                <label>
                  Occurrences
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={occurrenceCount}
                    onChange={(event) => setOccurrenceCount(Number(event.target.value))}
                    required
                  />
                </label>
              ) : null}
            </fieldset>
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <h3>Recurring lesson</h3>
              {previewLoading && !preview ? <p className="muted">Calculating lessons…</p> : null}
              {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
              {preview ? (
                <>
                  <p>
                    <strong>
                      {preview.subjectName ?? "Lesson"}
                      {preview.className ? ` — ${preview.className}` : ""}
                    </strong>
                  </p>
                  <p className="muted">
                    Every {DAYS[preview.weekday - 1]}
                    {preview.startsAt && preview.endsAt ? ` · ${hhmm(preview.startsAt)}–${hhmm(preview.endsAt)}` : ""}
                  </p>
                  {preview.teacherNames.length > 0 ? <p>Teacher: {preview.teacherNames.join(", ")}</p> : null}
                  {preview.roomName ? <p>Room: {preview.roomName}</p> : null}
                  <p>Starts: {formatUkCalendarDate(preview.effectiveFrom)}</p>
                  <p>Repeats until: {preview.repeatUntilLabel}</p>
                  <p>
                    Estimated lessons: <strong>{preview.occurrenceCount}</strong>
                  </p>
                  {preview.occurrenceCount > 0 ? (
                    <p>
                      <button type="button" className="ghost" onClick={() => setShowDates((value) => !value)}>
                        {showDates ? "Hide dates" : "View dates"}
                      </button>
                    </p>
                  ) : null}
                  {showDates ? (
                    <ul className="muted">
                      {preview.dates.map((date) => (
                        <li key={date}>{formatUkCalendarDate(date)}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : !previewError ? (
                <p className="muted">Choose the lesson details to see how many times this will repeat.</p>
              ) : null}
            </div>
            <div>
              <button type="submit" disabled={saving || Boolean(previewError)}>
                {saving ? "Saving…" : "Save lesson"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">School-wide timetable changes are managed by school administration.</p>
      )}
      <h2>Recurring lesson rules</h2>
      <p className="muted">
        Recurring lesson rules generate the weekly timetable automatically. Scheduled means it has not started yet,
        Active means it is generating lessons now, and Ended means it has stopped. Past lessons stay in the timetable.
      </p>
      {entries.length > 0 ? (
        <DataTable
          headers={
            <>
              <th>Day</th>
              <th>Time</th>
              <th>Class</th>
              <th>Subject</th>
              <th>Period</th>
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
                {entry.effectiveFrom ? formatDate(entry.effectiveFrom) : "—"}
                {entry.effectiveUntil ? ` · ${recurrenceEndsLabel(entry.effectiveUntil)}` : ""}
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
      ) : (
        <p className="muted">No recurring lesson rules match the current filters.</p>
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
            : "This recurrence already has timetable history. Notes can be changed here. Structural changes must apply from a date so past lessons stay as they were."
        }
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <>
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
            {editing.lifecycleStatus === "active" ? (
              <form className="academic-create-form is-dialog" onSubmit={applyStructuralChange}>
                <h3>Apply change from</h3>
                <p className="muted">
                  The current rule will stop the day before this date. A replacement rule starts here. Past timetable,
                  attendance, cover and learning history stay attached to the original rule.
                </p>
                <FormField label="Apply change from">
                  <Input type="date" value={applyFrom} min={today} onChange={(event) => setApplyFrom(event.target.value)} required />
                </FormField>
                <div className="academic-create-fields is-three">
                  <FormField label="Weekday">
                    <select name="replaceWeekday" defaultValue={editing.weekday}>
                      {DAYS.map((day, index) => (
                        <option key={day} value={index + 1}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Class">
                    <select name="replaceClassId" defaultValue={editing.classId}>
                      {classes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Subject">
                    <select name="replaceSubjectId" defaultValue={editing.subjectId ?? ""}>
                      <option value="">None</option>
                      {subjects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Room">
                    <select name="replaceRoomId" defaultValue={editing.roomId ?? ""}>
                      <option value="">No room</option>
                      {rooms.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Teacher">
                    <select name="replaceStaffProfileId" defaultValue={editing.teachers?.[0]?.staffProfileId} required>
                      {teachers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fullName ?? item.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
                <div className="dialog-actions">
                  <Button type="submit" disabled={replacing}>
                    {replacing ? "Applying…" : "Apply change from this date"}
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(ending)}
        title="End recurring lesson"
        description="Stop generating this lesson from a chosen date. Past timetable, attendance, cover and learning history will be kept."
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
            <FormField label="Stop generating this lesson from">
              <Input
                type="date"
                value={ending.stopFrom}
                min={today}
                onChange={(event) => void updateEndPreview(event.target.value)}
                required
              />
            </FormField>
            <p>
              Last scheduled lesson:{" "}
              <strong>
                {ending.lastScheduledLesson ? formatUkCalendarDate(ending.lastScheduledLesson) : "None before this date"}
              </strong>
            </p>
            <p className="muted">Past timetable, attendance, cover and learning history will be kept.</p>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEnding(null)}>
                {ending.lifecycle.canEnd ? "Cancel" : "Close"}
              </Button>
              {ending.lifecycle.canEnd ? <Button type="submit">End recurring lesson</Button> : null}
            </div>
          </form>
        ) : null}
      </Dialog>
      <ConfirmationDialog
        open={Boolean(deleting)}
        title={deleting?.lifecycle.canDelete ? "Delete unused recurring lesson?" : "This recurring lesson cannot be deleted"}
        description={
          deleting?.lifecycle.canDelete
            ? "This recurring lesson has not started and has no timetable history. It will be removed."
            : deleting?.lifecycle.message ||
              "This recurring lesson already has timetable history and cannot be deleted. End the recurrence instead."
        }
        confirmLabel={deleting?.lifecycle.canDelete ? "Delete" : "Close"}
        danger={Boolean(deleting?.lifecycle.canDelete)}
        secondaryLabel={deleting && !deleting.lifecycle.canDelete && deleting.lifecycle.canEnd ? "End recurrence" : undefined}
        onSecondary={
          deleting && !deleting.lifecycle.canDelete && deleting.lifecycle.canEnd
            ? () => {
                const entry = deleting.entry;
                setDeleting(null);
                void openLifecycle(entry, "end");
              }
            : undefined
        }
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
