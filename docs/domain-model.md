# Domain model (initial)

This is the **logical** model for review. Physical SQL for the foundation is in [schema/001_foundation.sql](./schema/001_foundation.sql). Later modules add tables in their own phases; names are reserved here so we do not paint ourselves into a corner.

Convention: UUIDs as primary keys; `organisation_id` on tenant data; `created_at` / `updated_at`; `created_by` where a person initiated the row.

## Platform

### Organisation

A subscribing school.

- `id`, `slug` (unique, URL-safe), `name`, `legal_name`
- `country_code` default `GB`, `timezone` default `Europe/London`
- `status`: `provisioning | active | suspended | closed`
- `settings` (typed JSON): feature flags (leaderboards, AI, student login by year group), branding, academic year start month (default September)

### User

A human identity, global.

- `id` (aligned with auth provider subject)
- `email` (citext, unique, **nullable** for pupils)
- `full_name`, `preferred_name`
- `user_kind`: `platform_admin | staff | parent | student` (primary; a person can still hold mixed memberships)
- `status`: `active | disabled`
- `date_of_birth` only where needed (pupils); treat as personal data

### Organisation membership

- `(organisation_id, user_id)` unique
- `status`: `invited | active | suspended`
- `ended_at` for leavers (keep history)

### RBAC

- `permissions.key` — dotted string, immutable once shipped
- `roles` — `organisation_id` null means system role template; non-null means school custom role
- `role_permissions`
- `membership_roles`
- `platform_admins` — separate table for Super Admins (not an organisation role)

### Invitation

- email or existing user id, organisation, intended roles, expiry, inviter
- Student invites may be username-based, sent to a parent instead

### Audit event

- `organisation_id` nullable (platform actions)
- `actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata` (no secrets)
- Append-only

### External identifier

- `system` e.g. `upn`, `arbor`, `sims`, `admissions_ref`
- Unique per `(organisation_id, system, identifier)`
- UPN reads require a dedicated permission

## People

### Staff profile

- Per organisation: job title, employee number, start date
- Linked to `user_id`

### Student profile

- Per organisation: admission number, year group, house, enrolment status (`prospective | admitted | enrolled | left | alumni`)
- Linked to `user_id` once provisioned
- **Do not** store SEN, FSM, ethnicity, medical in v1

### Guardianship

- `guardian_user_id` → `student_profile_id`
- `organisation_id` (school where the relationship applies)
- `relationship` (mother, father, carer, other)
- `has_parental_responsibility` (boolean)
- `portal_access` (boolean; a guardian might be listed but not log in)
- `priority` (who is primary contact)
- Unique `(student_profile_id, guardian_user_id)`

A parent’s children **in the current organisation** = guardianships for `guardian_user_id` with `portal_access` and active student status.

## Academic structure

UK-oriented, not US “grades”.

- **Academic year** — e.g. 2026/27, starts ~1 September
- **Term** — autumn, spring, summer (schools may customise)
- **Year group** — `N, R, 1…8` plus display name; `key_stage` 0–3
- **House** — optional; used later for house competitions
- **Class** — form class or teaching group; `class_type` `form | teaching`
- **Class enrolment** — student + class + academic year
- **Subject** — school catalogue (`mathematics`, `english`, `science`, `physics`, …)
- **Subject offering** — subject + year group + academic year (who is taught what)

Timetable entries belong to a later LMS/operations phase.

## Admissions (Phase 4 — do not implement now)

State machine, all org-scoped:

```text
Enquiry → Application → Assessment? → Waitlist? → Offer → Accepted/Declined/Expired
Accepted + complete checks → provision User + Student profile + membership + optional parent invite
```

Entities: `enquiries`, `applications`, `application_people`, `admissions_assessments`, `waiting_list_entries`, `offers`.

Keep prospective people **out of** `class_enrolments` until admitted.

## Operations (Phase 5+)

- Attendance session (class/date) and marks (present, absent, late, authorised — UK-style codes configurable)
- Documents (metadata + storage key)
- Announcements (audience: school, year, class, parents, students)
- Progress reports and teacher feedback records

## LMS (Phase 6+)

- Assignment (title, due, year/class/student targets, resource links)
- Submission (student, files, timestamps, status)
- Mark / feedback
- Learning resource (file or URL, year/subject tags)

## AI learning and gamification (Phase 8–9)

- `learning_activities` — type (quiz, flashcards, timed challenge, puzzle, …), year group, subject, difficulty, `status`
- `activity_items` — questions/cards; versioned so attempts stay consistent
- `activity_reviews` — reviewer, decision, comments
- `activity_attempts` — student, scores, timestamps (feeds personalisation later)
- `competitions` — scope `students | classes | houses | school` (school-vs-school **not** in v1)
- `points_ledger` / `xp_ledger` — append-only; never “set points =”
- `badge_definitions` + `badge_awards`
- `streaks` — per student per activity type
- Leaderboards: **computed views** from ledgers, filtered by organisation and school settings (`show_names`, `opt_in`, `disabled`)

## Relationships that must not be violated

1. A teacher JWT cannot read another organisation’s rows.
2. A parent can only read student profiles they have a guardianship for **in the current organisation**.
3. A student can only read/write their own submissions and attempts.
4. Platform Super Admin does not use a “default school” silently; platform routes are separate.
5. Published learning activities are visible to pupils only if `status = published` and year/subject rules match.

## Identifier strategy

- Internal PK: UUID
- Human-facing: admission number, invite codes
- DfE UPN: external identifier, optional, restricted
- Never use email as PK (pupils may not have one; parents change emails)
