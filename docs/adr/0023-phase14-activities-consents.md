# ADR 0023: School activities, consents, and parent responses

**Status:** Accepted  
**Date:** 2026-08-24

## Context

Schools need a day-to-day workflow for trips, clubs, fixtures, and other activities: target pupils, publish, collect explicit parent consent, manage capacity and waiting lists, and give authorised staff a participant list with a limited safety summary. Phase 10 already has calendar events and announcements. Phase 12 has timetable recurrence helpers. Phase 13 has private object storage. Parent/guardian, student portal, audit, and RLS patterns already exist.

A second events system, a second notification inbox, or a copy of pupil medical data onto the trip row would compete with those modules.

## Decision

### Canonical activity records

`school_activities` is the system of record. Activity types are an organisation catalogue (`trip`, `residential`, `visit`, `club`, `after_school`, `breakfast_club`, `sports_fixture`, `workshop`, `performance`, `extracurricular`, `other`) plus school-defined keys. Statuses are controlled: `draft`, `published`, `closed`, `completed`, `cancelled`, `archived`.

Calendar APIs expose published activities as a distinct `source: "activity"` array. They are not duplicated into `school_events`. Parent and student calendar endpoints keep the existing short timetable window, but list relevant activities independently unless the client passes `from`/`to`.

### Targeting vs participation

Targets (`whole_school`, `year_group`, `class`, `student`, `staff_member`) describe intent. Publishing snapshots eligible pupils into `school_activity_eligible_pupils` (class/year at snapshot time). Participants are a separate row with registration/waiting-list/attendance status. Eligibility history is kept if a pupil later changes class.

### Consent

Consent is explicit. Opening a notice is not consent. One **effective** response exists per pupil/activity; previous rows remain with `is_effective = false`. Online parent consent stores actor user id, guardianship, timestamp, channel `parent_portal`, and a wording/version snapshot. Later clause edits do not rewrite history.

Who may respond: active guardianship, `portal_access = true`, and parental responsibility; if nobody with portal access has parental responsibility, any portal-access guardian may respond. Client-supplied guardian IDs are ignored. Staff offline consent uses channel `staff_offline` and forces guardian identity to null so it cannot spoof a parent login. This is school acknowledgement, not a qualified electronic signature.

Student self-sign-up is a separate flag and is blocked when parent consent is required.

### Capacity and waiting list

Null capacity is unlimited. Confirmed places are allocated inside the tenant transaction with `SELECT … FOR UPDATE` on the activity row. A table trigger rejects a confirmed count above capacity. Overflow goes to a deterministic waiting list (`waiting_list_position`, then `joined_at`). Staff can promote; withdrawal/decline may free a place.

### Medical / emergency summary

**Live authorised pupil data, not a stored trip snapshot.** Activity staff with `activities.medical_summary.read` (or assigned staff inside the operational window, for emergency contacts only) see a deliberately small payload: allergy, medication, dietary requirement, limited medical flag, and emergency/parental-responsibility contacts. `send_notes`, pastoral narrative, and safeguarding never appear. Restricted-contact guardians are excluded by `list_activity_safety_contacts` (SECURITY DEFINER) so the app role never SELECTs `guardianships.restricted_contact`. Access ends for assigned staff after the activity operational window (end time + 24 hours). Guardian telephone is not on the current guardianship row, so the summary uses name, relationship, and email.

A stored snapshot was rejected for this phase: it would copy special-category data onto the activity, create a second retention surface, and go stale. A later residential-only snapshot can be added if schools require a frozen pack for an overnight trip.

### Files, calendar, timetable, attendance, payments

Activity documents use Phase 13 `stored_objects` with domain `activity`. Parent/student visibility is explicit (`staff`, `staff_and_parents`, `staff_parents_and_student`). Calendar views list activities separately. Timetable is not rewritten; a trip may appear alongside lessons. Activity attendance (`expected` / `attended` / `absent` / `withdrawn`) is not statutory school attendance. Payments are out of scope; registration/consent stay separate from any future fee status.

### Recurrence

Clubs use weekday + until-date expansion at query time (Phase 12 date helpers). There is no separate occurrence table in this phase.

## Consequences

- Parent and student portals gain an Activities area.
- Teachers are assigned-only unless they have school-wide `activities.manage`.
- Offline consent is visibly staff-entered.
- Future payments can attach to `school_activities` / participants without redesigning consent.
