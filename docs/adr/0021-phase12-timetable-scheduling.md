# ADR 0021 — Recurring timetable definitions and date-specific exceptions

**Status:** Accepted  
**Date:** 2026-08-24

## Context

Schoolapp needs a timetable that works for nursery/reception class-teacher days and for subject-specialist teaching. Attendance, LMS assignments, and Phase 10 calendar events already exist. Eagerly inserting one physical row per lesson occurrence would explode storage and make mid-year teacher changes destructive.

## Decision

Store **recurring timetable definitions** plus **date-specific exceptions and cover**.

- `school_day_profiles` + `school_day_periods` describe a school's own period structure, including different weekday profiles (for example Friday early finish). Weekdays are ISO 1–7 so weekend teaching is possible later.
- `rooms` is an organisation catalogue. Room is optional on a lesson.
- `timetable_entries` are the canonical recurring slots (academic year, optional term, weekday, snapshotted times, class, optional subject/room, effective dates).
- `timetable_entry_teachers` records participation (teacher, co-teacher, TA). Participation is not an RBAC grant.
- `timetable_exceptions` record one date: cancelled, room changed, replacement, school closure, special activity.
- `timetable_covers` assign a substitute for one entry and date. Cover does not rewrite the permanent row.

Occurrences are resolved at query time: weekday + effective dates + term windows, minus published `school_holiday` / `inset_day` calendar events and explicit school-closure exceptions.

Attendance continues to use Phase 6 session types (typically AM/PM). Taking attendance from a lesson identifies the existing register idempotently; it does not create a second attendance architecture.

Calendar events remain Phase 10 school events. Timetable occurrences are returned as a separate `lessons` collection with `source: "timetable"`. Recurring lessons are never copied into `school_events`.

## Consequences

- Historical attendance and past occurrences keep the definition that applied on that date.
- Conflict checks use actual start/end times and overlapping effective windows, enforced by database triggers as well as the API.
- Cover grants class access only on the cover date, via the existing assigned-class helpers.
- A full government holiday engine is out of scope; term dates plus holiday/INSET events are the minimum closure mechanism.
