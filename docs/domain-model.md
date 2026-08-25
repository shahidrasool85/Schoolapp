# Domain model (initial)

This is the **logical** model for review. Physical SQL for the foundation is in [schema/001_foundation.sql](./schema/001_foundation.sql). Later modules add tables in their own phases; names are reserved here so we do not paint ourselves into a corner. Placeholders: [placeholders.md](./placeholders.md).

Convention: UUIDs as primary keys; `organisation_id` on tenant data; `created_at` / `updated_at`; `created_by` where a person initiated the row. **A student is never permanently assigned to one class.**

## Platform

### Organisation

A subscribing school.

- `id`, `slug` (unique, URL-safe SaaS routing identity; reserved names blocked), `name`, `legal_name`
- `country_code` default `GB`, `timezone` default `Europe/London`
- `status`: `provisioning | active | suspended | closed`

### Organisation hostnames (custom domains)

Optional extra hostnames such as `portal.greenwoodacademy.org.uk`. Stored with organisation ownership, uniqueness for verified-and-active rows, verification status, and activation. **Unverified or inactive hostnames never resolve.** Platform verify is a manual operator attestation until DNS automation exists; activate requires a verified row. Infrastructure names (`localhost`, `*.local`, …) cannot be registered. DNS/TLS automation is later.

### Organisation slug history

Former slugs remain reserved so another school cannot take over a bookmarked subdomain.

### Organisation identifiers (placeholder)

- `system` + `identifier` (DfE URN, establishment number, Companies House, …)
- No validation product in this phase

### Organisation settings (placeholder)

- `academic_year_start_month`, `locale`, **`max_year_group_code`** (default `8`, covering 11+ prep through Year 8)
- Typed calendar/locale fields plus `extras` jsonb
- Distinct from feature flags

### Organisation feature flags (placeholder)

- `flag_key`, `enabled`, `config`
- Defaults remain high-privacy (leaderboards off, AI auto-publish off)

### User

A human identity, global.

- `id` (aligned with auth provider subject)
- `email` (citext, unique, **nullable** for pupils)
- `full_name`, `preferred_name`
- `user_kind`: `platform_admin | staff | parent | student` (primary; a person can still hold mixed memberships)
- `status`: `active | disabled`
- `date_of_birth` only where needed (pupils); treat as personal data
- Optional org-scoped `user_login_aliases` for pupil usernames (not a second identity provider)

### Organisation membership

- `(organisation_id, user_id)` unique
- `status`: `invited | active | suspended`
- `ended_at` for leavers (keep history)
- Revalidated from the database on every school-scoped request

### RBAC

- `permissions.key` — dotted string, immutable once shipped
- `roles` — `organisation_id` null means system role template; non-null means school custom role
- `role_permissions`
- `membership_roles`
- `platform_admins` — separate table for Super Admins (not an organisation role)

### Invitation

- email or existing user id, organisation, intended roles, expiry, inviter
- Student invites may be username-based, sent to a parent instead

### Formal audit event (not application logging)

- `organisation_id` nullable (platform actions)
- `actor_user_id`, `actor_membership_id`, `occurred_at`, `request_id`
- `action`, `entity_type`, `entity_id`
- `before_data` / `after_data` jsonb (meaningful snapshots; no secrets/passwords)
- Optional `prev_hash` / `row_hash` for later tamper evidence
- Append-only for the runtime role (`INSERT`/`SELECT` only)

Application logs (stdout) are a different stream: diagnostics, not evidence.

### External identifier

- `system` e.g. `upn`, `arbor`, `sims`, `admissions_ref`
- Unique per `(organisation_id, system, identifier)`
- UPN reads require a dedicated permission

### Billing (placeholder)

- `billing_accounts` — who pays (platform-level)
- `organisation_subscriptions` — plan, status, licensed seats
- No payment processor in this phase; pupil tenancy remains `organisation_id`

## People

### Staff profile

- Per organisation: job title, employee number, start date
- Linked to `user_id`
- Teaching duties are **class_staff_assignments**, not a field on the staff row

### Student profile

- Per organisation: admission number, enrolment status (`prospective | admitted | enrolled | left | alumni`)
- Linked to `user_id` once provisioned
- **No `class_id`. No permanent year-group FK.** Current year group is derived from `student_enrolments` for the current academic year
- **Do not** store SEN, FSM, ethnicity, medical in v1

### Student enrolment (historical)

- One row per student per academic year (default unique)
- `year_group_id`, optional `house_id`, `status`, `started_on`, `ended_on`
- Last year’s Year 3 remains queryable after they become Year 4

### Guardianship

- `guardian_user_id` → `student_profile_id` at an organisation
- `relationship` (mother, father, carer, other)
- `has_parental_responsibility`
- `is_emergency_contact`, `lives_with_student`
- `restricted_contact` (placeholder flag; no court-order workflow yet)
- `portal_access` (a guardian might be listed but not log in)
- `priority` (primary contact)
- Optional `started_on` / `ended_on`

A parent’s children **in the current organisation** = guardianships for `guardian_user_id` with `portal_access`, not ended, and an appropriate student status.

## Academic structure

UK-oriented, not US “grades”. See [ADR 0009](./adr/0009-academic-year-scoped-enrolments.md).

- **Academic year** — e.g. 2026/27, starts ~1 September
- **Term** — autumn, spring, summer (schools may customise keys)
- **Half-term** — subdivision of a term (optional to populate; model supports it)
- **Year group** — catalogue `N, R, 1…8` plus display name; `key_stage` 0–3
- **House** — optional; used later for house competitions
- **Class** — belongs to **one academic year**; `class_type` `form | teaching`. Not an eternal room
- **Class membership** — dated student↔class link; history retained when `ended_on` is set; a pupil may be in a form class and several teaching groups
- **Class staff assignment** — dated staff↔class link (`form_tutor`, `co_tutor`, `subject_teacher`, …)
- **Class subject** — what the class teaches
- **Subject** — school catalogue (`mathematics`, `english`, `science`, `physics`, …)

Registers, homework, and reports must use membership **as of a date** (or year/term), not “the student’s class column”.

Timetable (Phase 12): recurring `timetable_entries` plus date-specific `timetable_exceptions` and `timetable_covers`. School-day profiles/periods and rooms are organisation catalogues. Occurrences are resolved at query time; see [ADR 0021](./adr/0021-phase12-timetable-scheduling.md).

## Admissions (Phase 4)

State machine, all org-scoped. See [ADR 0013](./adr/0013-admissions-conversion.md).

```text
Enquiry → Application → Assessment? → Waitlist? → Offer → Accepted/Declined/Expired
Accepted → enrol_admitted_applicant → User + Student profile + membership + optional explicit guardianship
```

Entities: `admissions_enquiries`, `admissions_applications`, `admissions_application_contacts`, `admissions_application_status_history`, `admissions_assessments`, `admissions_waiting_list_entries`, `admissions_offers`, `admissions_documents` (object-storage metadata only).

Application statuses: `enquiry | draft | submitted | under_review | information_required | assessment_pending | assessment_completed | waiting_list | offer_pending | offer_made | accepted | deferred | rejected | withdrawn | enrolled`.

Keep prospective people **out of** `class_memberships` and current `student_enrolments` until conversion. Application contacts are not guardianships; `portal_access` is granted only when conversion lists a contact with `portalAccess: true`.

The original application remains after enrolment and records `converted_student_profile_id`. The student profile records `admitted_from_application_id`.

## Public admissions forms (Phase 9)

See [ADR 0018](./adr/0018-phase9-public-admissions-forms.md).

Entities: `admissions_forms`, `admissions_form_sections`, `admissions_form_fields`, `admissions_form_submissions`, `admissions_form_documents`, `admissions_campaigns`, `student_additional_needs`.

Form types are extensible (`enquiry`, `application`, plus reserved `open_day`, `waiting_list`, `scholarship`, `sixth_form`, `nursery`). Status: `draft | published | unpublished`. Completeness (`draft | submitted | missing_documents | complete`) is stored on the submission and must not be treated as an admissions decision.

Canonical answers map into enquiry/application/contact columns. Custom questions stay on the submission. Conversion copies identity, address, guardians, and additional needs only.

## Operations (Phase 6)

- `attendance_session_types` — organisation-configurable sessions (default AM/PM)
- `attendance_codes` — category model (`present`, `late`, `authorised_absence`, `unauthorised_absence`, `not_required`)
- `attendance_marks` — one row per organisation + pupil + date + session; class/year-group are context, not identity
- `attendance_mark_revisions` — previous values when a mark is corrected
- `student_portal_policies` and year-group/class/pupil override tables
- `student_documents` — metadata + storage key only (no file bytes in PostgreSQL)
- Announcements remain later work; progress reports are Phase 8 (`academic_reports`)
- Attendance and document mutations are formally audited

## LMS (Phase 7)

Canonical learning work is **not** a single class-scoped homework row. See [ADR 0016](./adr/0016-phase7-learning-lms.md).

- `learning_work_types` — organisation catalogue (`homework`, `classwork`, `revision`, `project`, `reading`, `practice`, `assessment_preparation`)
- `learning_assignments` — title, instructions, subject, academic year, optional intended year group, due/available-from, estimated duration, maximum marks, submission-required flag, teacher-private notes, status `draft | published | closed | archived`. **No `class_id`.** Lifecycle (edit/publish/close/archive/resources) is school-wide `lms.assignments.manage` or the creating actor.
- `learning_assignment_targets` — targeting intent: class, year group, and/or selected pupil (multiple rows per assignment)
- `learning_assignment_recipients` — frozen pupil list at publish (and when a published target is added). Class/year moves later keep the original relationship
- `learning_assignment_status_history` — publication/close/archive audit
- `learning_resources` + `learning_assignment_resources` — PDF/worksheet/image/URL/video/document metadata; http(s) URL now; storage-key port for later binaries
- `learning_submissions` — one logical pupil submission per assignment; status `not_started | in_progress | submitted | returned | resubmission_requested | completed`
- `learning_submission_revisions` — append-only text/comment versions
- `learning_submission_attachments` — attachment metadata/port only (no bytes in PostgreSQL)
- `learning_marks` — LMS/work-specific score, written feedback, release-to-pupil, release-to-parent, resubmission flag. **Not** Phase 8 formal assessment/results

Timetables, rubrics, AI-generated activities, and PDF report cards remain later work. Future AI worksheets should reuse `learning_resources`. Formal exam/assessment results live in the Phase 8 tables below — never in `learning_marks`.

## Formal assessment, results, and reports (Phase 8)

See [ADR 0017](./adr/0017-phase8-assessment-results.md). This domain is **not** LMS marking and **not** admissions interviews.

| Concept | Table | Meaning |
| --- | --- | --- |
| LMS assignment mark | `learning_marks` | Homework/classwork feedback for one submission |
| Formal assessment | `academic_assessments` | Scheduled academic assessment (test, teacher assessment, mock, …) |
| Formal result | `academic_results` | One pupil’s score/grade/judgement for one assessment |
| Teacher judgement | `academic_results.teacher_judgement` + scheme level | Professional assessment against a school-defined scheme |
| Target | `academic_targets` | School-defined expected attainment for a pupil/subject/year |
| Report | `academic_reports` + `academic_report_publications` | Progress report; published payload is frozen |

- `academic_assessment_types` — organisation catalogue (`class_test`, `end_of_unit`, `mock_exam`, `eleven_plus_practice`, `spelling_test`, `reading_assessment`, `teacher_assessment`, `practical_assessment`, `baseline_assessment`) plus custom keys
- `academic_grade_schemes` / `academic_grade_scheme_levels` — percentage, letter, numeric, teacher judgement, age-related, or school-defined. Default age-related labels are seed data, not the only model
- `academic_reporting_periods` — belong to an academic year; optional term link; any number of periods
- `academic_assessments` — year, subject, year group, type, date, optional max marks/weighting/scheme, status `draft \| open \| completed \| reviewed \| published \| archived`, optional `source_learning_assignment_id` for future LMS evidence (no auto-conversion)
- `academic_assessment_classes` + `academic_assessment_inclusions` — class intent and pupil snapshot
- `academic_results` — raw score, generated percentage, scheme level, judgement, comment, review status, independent release flags; actor/timestamps from session
- `academic_result_revisions` — previous values on meaningful amendments
- `academic_targets` — one target per pupil + year + subject
- `academic_reports` / `academic_report_sections` — working copy; published/archived content is locked
- `academic_report_publications` — immutable JSON snapshot shown to parents/pupils

Progress is latest vs previous comparable result (percentage, else scheme `numeric_value`). Mixed/non-numeric schemes do not invent an average.

## Communications and school calendar (Phase 10)

- `announcements` — title, body, priority, controlled status, publish/expiry, pin, acknowledgement required, session-stamped creator/publisher
- `announcement_targets` — whole school / staff / parents / students / year group / class / selected pupil / selected staff (no single `class_id`)
- `announcement_recipients` — one row per announcement + user with delivered/read/acknowledged timestamps
- `announcement_recipient_subjects` — which child/class/year a parent or student row relates to (historical snapshot)
- `school_event_types` — extensible catalogue (holiday, INSET, parents’ evening, trip, exam, …)
- `school_events` — start/end, all-day, location, status, optional generic `related_kind`/`related_id`
- `school_event_targets` / `school_event_audience` — same targeting and snapshot rules as announcements

Parent and student visibility uses the snapshot plus current portal/enrolment rules. Expired notices leave active lists. Staff-only targets never leak to portals.

## School activities, trips, clubs, and consents (Phase 14)

Canonical activity records, not a second events table. See [ADR 0023](./adr/0023-phase14-activities-consents.md).

- `school_activity_types` — organisation catalogue (`trip`, `club`, `sports_fixture`, …) plus custom keys
- `school_activities` — title, type, controlled status, dates, location, optional capacity/deadline, consent/sign-up flags, recurrence, parent vs staff notes, session-stamped actors
- `school_activity_targets` — whole school / year group / class / selected pupil / selected staff
- `school_activity_eligible_pupils` — publish-time eligibility snapshot (historical class/year)
- `school_activity_staff` — activity-scoped lead/accompanying staff, not school-wide RBAC
- `school_activity_consent_clauses` — current wording; responses store a version snapshot
- `school_activity_responses` — one effective decision per pupil; history retained; channels `parent_portal` / `student_portal` / `staff_offline`
- `school_activity_participants` — registration, waiting list, activity attendance (not statutory attendance)
- `school_activity_documents` — Phase 13 files; visibility is explicit
- `school_activity_updates` — parent-safe notices using existing notification patterns

Calendar list APIs include `activities` with `source: "activity"`. Medical/emergency information is live and limited. Payments are not modelled.

## Behaviour, pastoral and safeguarding (Phase 11)

These are related staff workflows but **not** the same data category. Safeguarding never appears on ordinary student-record payloads or parent/student APIs.

- `behaviour_incident_categories` / `behaviour_action_categories` / `positive_behaviour_categories` / `behaviour_locations` — school-configurable catalogues
- `behaviour_incidents` — pupil, occurred_at, category, location, optional class, description, severity, action taken, follow-up, status, conservative visibility flags; `recorded_by` / `recorded_at` are session-stamped
- `behaviour_incident_related_pupils` / `behaviour_incident_witnesses` / `behaviour_incident_revisions`
- `behaviour_actions` — configurable consequences (including suspension/exclusion placeholders, not a statutory workflow)
- `positive_behaviour_records` — praise/merits/achievements, compatible with later rewards without XP
- `pastoral_concerns` / `pastoral_interventions` — distinct from incidents; optional attendance date-range reference (does not duplicate marks)
- `safeguarding_concerns` / `safeguarding_chronology_entries` / `safeguarding_attachments` — separate architecture; chronology is append-only (amendments supersede, they do not overwrite)

## AI learning and gamification (Phase 12–13)

- `learning_activities` — type (quiz, flashcards, timed challenge, puzzle, …), year group, subject, difficulty, `status`
- `activity_items` — questions/cards; versioned so attempts stay consistent
- `activity_reviews` — reviewer, decision, comments
- `activity_attempts` — student, scores, timestamps (feeds personalisation later)
- `competitions` — scope `students | classes | houses | school` (school-vs-school **not** implemented; see governance placeholders)
- `points_ledger` / `xp_ledger` — append-only; never “set points =”
- `badge_definitions` + `badge_awards`
- `streaks` — per student per activity type
- Leaderboards: **computed views** from ledgers, filtered by organisation and feature flags (`show_names`, `opt_in`, `disabled`)

## Notification inbox (Phase 3)

Per-recipient, organisation-scoped in-app messages. See [ADR 0012](./adr/0012-in-app-notifications.md).

- `organisation_id`, `recipient_user_id`
- `type` / `category` (homework, results, announcement, …)
- `title`, `body` (minimised; no restricted-contact or admin-only data)
- `read_at`, `created_at`, optional `action_target`

Delivery preferences stay on the placeholder `notification_preferences` table. Email/push workers are later.

## Notification preferences (placeholder)

- Per user, organisation, channel (`email | push | in_app`), category
- No delivery worker in this phase

## Inter-school competition governance (placeholder)

- Networks and member organisations, data-sharing acceptance timestamp
- **Must not** join pupil, attempt, or leaderboard rows across `organisation_id`

## Relationships that must not be violated

1. A teacher JWT cannot read another organisation’s rows.
2. A parent can only read student profiles they have a guardianship for **in the current organisation**.
3. A student can only read/write their own submissions and attempts.
4. Platform Super Admin does not use a “default school” silently; platform routes are separate.
5. Published learning activities are visible to pupils only if `status = published` and year/subject rules match.
6. Client organisation headers and JWT org claims are never sufficient for tenant access.

## Identifier strategy

- Internal PK: UUID
- Human-facing: admission number, invite codes
- DfE UPN: external identifier, optional, restricted
- School URN: organisation identifier, placeholder
- Never use email as PK (pupils may not have one; parents change emails)
