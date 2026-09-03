# HTTP API (`/api/v1`) — mobile-ready contract

The web app and future Expo apps are **clients of this API**. OpenAPI YAML will live in `packages/api-contract` during Phase 1. This document is the design, not a generated spec.

## Conventions

| Topic | Rule |
| --- | --- |
| Version | URL prefix `/api/v1`. Breaking changes require `/api/v2` |
| Format | `application/json; charset=utf-8` |
| Time | ISO-8601 UTC in JSON; UI converts to school timezone |
| IDs | UUID strings |
| Auth (web) | HTTP-only cookie session |
| Auth (mobile) | `Authorization: Bearer <access_token>` |
| Tenant | `X-Organisation-Id: <uuid>` **requests** context on school-scoped routes. It is **not** authority. On a school hostname the server resolves the organisation from `Host` (see [ADR 0014](../adr/0014-saas-hostname-tenancy.md)); a mismatched header is `org_host_mismatch`. On the platform host the server revalidates active membership in Postgres, then sets transaction-local RLS context. JWT org claims are likewise non-authoritative |
| Idempotency | `Idempotency-Key` on POSTs that create submissions, attendance, payments (later) |
| Pagination | `?cursor=` or `?page=&pageSize=` — pick cursor for large lists in implementation |
| Errors | `{ "error": { "code": "forbidden", "message": "...", "details": {} } }` |
| Cross-tenant | **404** not 403 when the UUID belongs to another school or is unknown |
| Trace | `X-Request-Id` echoed |

Unauthenticated routes: health, login, invite accept, password reset, `GET /api/v1/public/tenant`.

## Error codes (stable)

`unauthenticated`, `org_context_required`, `org_membership_required`, `org_host_mismatch`, `tenant_not_found`, `reserved_slug`, `onboarding_public_disabled`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `rate_limited`.

## Identity and context

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
POST /api/v1/auth/activate
POST /api/v1/invitations/accept

GET  /api/v1/me
GET  /api/v1/me/memberships
PATCH /api/v1/me
POST /api/v1/me/devices          # reserve for Expo push tokens; stub later

GET  /api/v1/public/tenant       # Host-based platform vs school identity; school hosts include display-only branding (no storage keys)
GET  /api/v1/public/branding/logo
GET  /api/v1/public/branding/hero
POST /api/v1/public/signup       # disabled; returns onboarding_public_disabled
```

`GET /api/v1/me` returns the user and does **not** require `X-Organisation-Id`.

`GET /api/v1/me/memberships` returns schools the user may enter (`organisationId`, `name`, `roles[]`, `kind`). It runs **without** tenant GUCs (security-definer listing). Spoofing an org id that is not in this list must not set tenant context.

School-scoped example:

```http
GET /api/v1/students/{studentId}
X-Organisation-Id: 0c1e…
Authorization: Bearer …
```

If the header is missing on the **platform** host, `org_context_required`. On a **school** host the organisation is taken from the hostname (the header is optional and must match). If the membership is missing, suspended, or ended, `org_membership_required`. If the student is in another org, `not_found`.

## Platform Super Admin

Prefix `/api/v1/platform/...` — no school header.

```http
GET  /api/v1/platform/organisations
POST /api/v1/platform/organisations
POST /api/v1/platform/organisations/{id}/school-admin-invitation/reissue
POST /api/v1/platform/organisations/{id}/slug
POST /api/v1/platform/organisations/{id}/suspend
POST /api/v1/platform/organisation-hostnames/{id}/verify
POST /api/v1/platform/organisation-hostnames/{id}/activate
```

`GET /platform/organisations` includes `schoolAdmin` state (`invitationStatus`, `canReissue`, invited email/name, membership status). It never returns token hashes or reconstructs old tokens.

`POST .../school-admin-invitation/reissue` is Platform Admin + platform host only. It revokes the outstanding School Admin invitation, issues a new hashed token, and returns the one-time `invitationToken` and school-host `invitationUrl` once. Accepted invitations cannot be reissued (`409 conflict`).

## School administration (Phase 1–2)

```http
GET  /api/v1/organisation
PATCH /api/v1/organisation/settings
PATCH /api/v1/organisation/slug
GET  /api/v1/organisation/hostnames
POST /api/v1/organisation/hostnames
GET  /api/v1/dashboard
GET  /api/v1/members
POST /api/v1/invitations
GET  /api/v1/roles
GET  /api/v1/academic-years
POST /api/v1/academic-years
PATCH /api/v1/academic-years/{id}
GET  /api/v1/year-groups
POST /api/v1/year-groups
POST /api/v1/year-groups/seed
GET  /api/v1/subjects
POST /api/v1/subjects
GET  /api/v1/classes
POST /api/v1/classes
GET  /api/v1/classes/{id}
POST /api/v1/classes/{id}/staff
POST /api/v1/classes/{id}/subjects
GET  /api/v1/staff
POST /api/v1/staff
GET  /api/v1/students
POST /api/v1/students
GET  /api/v1/students/{id}
POST /api/v1/students/{id}/enrolments
POST /api/v1/students/{id}/class-memberships
POST /api/v1/students/{id}/guardians
GET  /api/v1/students/{id}/medications
POST /api/v1/students/{id}/medications
PATCH /api/v1/students/{id}/medications/{medicationId}
POST /api/v1/students/{id}/medications/{medicationId}/stop
GET  /api/v1/students/{id}/dietary-requirements
POST /api/v1/students/{id}/dietary-requirements
PATCH /api/v1/students/{id}/dietary-requirements/{dietaryId}
POST /api/v1/students/{id}/dietary-requirements/{dietaryId}/stop
GET  /api/v1/guardians
GET  /api/v1/parent/dashboard
GET  /api/v1/parent/children
GET  /api/v1/parent/children/{studentId}
GET  /api/v1/student/me
GET  /api/v1/student/dashboard
GET  /api/v1/student/attendance
GET  /api/v1/notifications
PATCH /api/v1/notifications/{notificationId}
```

Student login uses the same `POST /api/v1/auth/login` contract with `organisationSlug` + `username` instead of email. Alias login returns `organisationId` for the school that authenticated the username so clients do not have to guess context. Email/password login does not authenticate `user_kind = student`, including on the platform host; that route remains for staff and parents. Parent and student users share this identity model; there is no second auth stack.

## Parent portal (web now, Expo later)

All routes require an active organisation membership, `students.profiles.read_own_children`, and an active guardianship with `portal_access = true` in the current organisation. Knowing a child id is not sufficient. Cross-org and unlinked ids return **404**.

```http
GET /api/v1/parent/dashboard
GET /api/v1/parent/children
GET /api/v1/parent/children/{studentId}
GET /api/v1/parent/children/{studentId}/attendance
GET /api/v1/parent/children/{studentId}/documents
GET /api/v1/parent/children/{studentId}/medications
GET /api/v1/parent/children/{studentId}/dietary-requirements
GET /api/v1/parent/children/{studentId}/assignments
GET /api/v1/parent/children/{studentId}/results
GET /api/v1/parent/children/{studentId}/progress
GET /api/v1/parent/children/{studentId}/feedback
GET /api/v1/parent/children/{studentId}/reports
GET /api/v1/parent/children/{studentId}/reports/{reportId}
GET /api/v1/parent/children/{studentId}/achievements
GET /api/v1/parent/announcements
GET /api/v1/parent/announcements/{id}
POST /api/v1/parent/announcements/{id}/read
POST /api/v1/parent/announcements/{id}/acknowledge
GET  /api/v1/parent/calendar/events
GET  /api/v1/parent/calendar/events/{id}
GET  /api/v1/parent/activities
GET  /api/v1/parent/children/{studentId}/activities
GET  /api/v1/parent/children/{studentId}/activities/{activityId}
POST /api/v1/parent/children/{studentId}/activities/{activityId}/respond
```

Phase 3 implements dashboard, children list, and child overview (profile + school/year/form + viewer guardianship). Phase 6 implements child attendance (parent-visible notes only). Phase 8 implements released formal results, subject progress, and published report snapshots. Phase 10 implements family notices and calendar (authorised children only; no staff-only rows; no actor/storage-key fields). Parent-visible medication and dietary records require live guardianship + `portal_access` and the matching `*.read_own_children` keys; internal notes are omitted. Creates fail closed (`parentVisible` omitted or non-true stores false; staff must explicitly opt in). Responses never include `restricted_contact`, admin notes, billing, moderation notes, or other organisations' children.

## Student portal

```http
GET  /api/v1/student/me
GET  /api/v1/student/dashboard
GET  /api/v1/student/attendance
GET  /api/v1/student/assignments
POST /api/v1/student/assignments/{id}/submissions
GET  /api/v1/student/resources
GET  /api/v1/student/activities
GET  /api/v1/student/activities/{activityId}
POST /api/v1/student/activities/{activityId}/signup
POST /api/v1/student/activities/{activityId}/withdraw
GET  /api/v1/student/results
GET  /api/v1/student/progress
GET  /api/v1/student/reports
GET  /api/v1/student/reports/{reportId}
GET  /api/v1/student/announcements
GET  /api/v1/student/announcements/{id}
POST /api/v1/student/announcements/{id}/read
POST /api/v1/student/announcements/{id}/acknowledge
GET  /api/v1/student/calendar/events
GET  /api/v1/student/calendar/events/{id}
```

Phase 3 implements `me` and `dashboard` for the authenticated student's own profile in the current organisation. Phase 6 adds `GET /api/v1/student/attendance` (own marks, parent-visible notes only) when the effective student-portal policy allows access. Spoofing `X-Organisation-Id` for a school the pupil does not belong to returns `org_membership_required`. Login aliases remain organisation-scoped. A disabled student portal refuses alias login even if an alias/password exists. Student routes do **not** automatically expose medication administration details (dosage, schedule, who administers).

## Attendance (Phase 6)

Staff APIs. Teachers require an assignment to the class (or pupil) for the register date. School-wide list/correct requires `attendance.record.read` / `attendance.record.manage` / `attendance.record.correct`. Cross-tenant class/year/student/session IDs return **404**. Duplicate active marks for the same pupil/date/session are upserted (idempotent). Clients cannot set `recordedBy` or correction fields.

```http
GET    /api/v1/attendance/session-types
POST   /api/v1/attendance/session-types
PATCH  /api/v1/attendance/session-types/{id}
GET    /api/v1/attendance/codes
POST   /api/v1/attendance/codes
GET    /api/v1/attendance/my-classes
GET    /api/v1/attendance/registers?classId&date&sessionTypeId
PUT    /api/v1/attendance/registers
GET    /api/v1/attendance/marks
GET    /api/v1/attendance/marks/{id}
PATCH  /api/v1/attendance/marks/{id}
GET    /api/v1/attendance/marks/{id}/revisions
GET    /api/v1/attendance/students/{studentId}
GET    /api/v1/attendance/students/{studentId}/summary
```

`PUT /attendance/registers` body: `{ classId, date, sessionTypeId, markAllPresent?, marks: [{ studentProfileId, codeId|code, lateMinutes?, reason?, note?, parentVisibleNote? }] }`. `markAllPresent: true` fills unmarked roster pupils as present, then applies `marks` as exceptions.

Attendance percentage = (present + late) / (all marks except `not_required`). Returned as `sessionsPossible`, `sessionsPresent`, `authorisedAbsence`, `unauthorisedAbsence`, `late`, `notRequired`, `attendancePercentage`.

Parent: `GET /api/v1/parent/children/{studentId}/attendance` (active guardianship + `portal_access`). Student: `GET /api/v1/student/attendance`. Neither includes internal `note` or recorder identity.

## Student portal policy (Phase 6)

```http
GET   /api/v1/student-portal-policy
PATCH /api/v1/student-portal-policy
PUT   /api/v1/student-portal-policy/year-groups/{yearGroupId}
PUT   /api/v1/student-portal-policy/classes/{classId}
PUT   /api/v1/student-portal-policy/students/{studentId}
```

Override body `{ "enabled": true | false | null }`. `null` deletes the override (inherit). Effective order: pupil → class → year group → school default. School Admin UI in this phase covers school default and year groups. Class/pupil APIs are implemented for the next phase.

`GET /api/v1/students/{id}` includes `attendanceSummary` and `portalAccess` for authorised staff. Current class/year remain derived from enrolment/membership history.

## Student document metadata (Phase 6)

```http
GET  /api/v1/students/{id}/documents
POST /api/v1/students/{id}/documents
GET  /api/v1/parent/children/{studentId}/documents
```

Metadata only (`storageBackend: unconfigured` until an S3-compatible adapter is configured). No file bytes in PostgreSQL. Parent lists omit staff-only rows and strip `storageKey`.

## Notifications (in-app inbox)

```http
GET   /api/v1/notifications
GET   /api/v1/notifications?unreadOnly=true
PATCH /api/v1/notifications/{notificationId}
```

`PATCH` body: `{ "read": true }`. Rows are organisation-owned and recipient-specific. Cross-user or cross-tenant ids return **404**. Email, SMS, and push are not implemented.

## Admissions (Phase 4)

School-scoped staff APIs. Require `admissions.read` (or a more specific admissions manage/decide/convert key). Teachers, parents, and students receive **403**. Cross-tenant ids return **404**. `enrolled` cannot be set via the status endpoint.

```http
GET    /api/v1/admissions/dashboard
GET    /api/v1/admissions/enquiries
POST   /api/v1/admissions/enquiries
GET    /api/v1/admissions/enquiries/{id}
PATCH  /api/v1/admissions/enquiries/{id}
POST   /api/v1/admissions/enquiries/{id}/convert
GET    /api/v1/admissions/applications
POST   /api/v1/admissions/applications
GET    /api/v1/admissions/applications/{id}
PATCH  /api/v1/admissions/applications/{id}
POST   /api/v1/admissions/applications/{id}/status
POST   /api/v1/admissions/applications/{id}/contacts
GET    /api/v1/admissions/assessments
POST   /api/v1/admissions/applications/{id}/assessments
PATCH  /api/v1/admissions/assessments/{id}
GET    /api/v1/admissions/waiting-list
POST   /api/v1/admissions/applications/{id}/waiting-list
PATCH  /api/v1/admissions/waiting-list/{id}
GET    /api/v1/admissions/offers
POST   /api/v1/admissions/applications/{id}/offers
PATCH  /api/v1/admissions/offers/{id}
POST   /api/v1/admissions/applications/{id}/enrol
```

Dashboard counts match their list filters (`awaitingReview` is `under_review` only; `offersMade` is offer status `made` only). `PATCH /admissions/offers/{id}` accepts, declines, expires, or withdraws only from `made`; repeating a terminal status is a no-op and does not re-notify. Expire/withdraw is rejected after the application is accepted or enrolled.

`POST .../enrol` body may include `academicYearId`, `yearGroupId`, `classId`, `admissionNumber`, `existingStudentProfileId`, and `guardianLinks: [{ contactId, portalAccess }]`. Retrying returns the same student and does not re-notify. The application record is not deleted.

Public forms (unauthenticated, school host only; ignore `X-Organisation-Id` as tenant authority):

```http
GET    /api/v1/public/admissions/forms/{formType}/{slug}
GET    /api/v1/public/admissions/forms/{formType}/{slug}/draft?token=
POST   /api/v1/public/admissions/forms/{formType}/{slug}/submissions
POST   /api/v1/public/admissions/forms/{formType}/{slug}/documents
```

Staff form administration:

```http
GET    /api/v1/admissions/forms
POST   /api/v1/admissions/forms
GET    /api/v1/admissions/forms/{id}
PATCH  /api/v1/admissions/forms/{id}
PUT    /api/v1/admissions/forms/{id}/definition
POST   /api/v1/admissions/forms/{id}/publish
POST   /api/v1/admissions/forms/{id}/unpublish
POST   /api/v1/admissions/forms/{id}/duplicate
GET    /api/v1/admissions/forms/{id}/share
GET    /api/v1/admissions/forms/{id}/submissions
GET    /api/v1/admissions/form-submissions/{id}
GET    /api/v1/admissions/campaigns
POST   /api/v1/admissions/campaigns
PATCH  /api/v1/admissions/campaigns/{id}
GET    /api/v1/admissions/sources
```

Public submissions resolve the organisation from `Host`. A mismatched `X-Organisation-Id` returns `403 org_host_mismatch`. Unknown, unpublished, and expired forms return `404`. Oversized bodies return `413 payload_too_large`. Enquiry submissions create `admissions_enquiries`; application submissions create `admissions_applications` with contacts. Completeness is independent of decision status.

See [public form security](../security/public-admissions-forms.md) and [embed instructions](../embed-admissions-forms.md).

## Staff / LMS

Same `/api/v1` resources the web SIS uses. A future teacher/parent/student app reuses them unchanged. Cross-tenant and unauthorised IDs return **404**. Teacher-private notes are omitted from parent/student payloads. Marks/feedback are omitted until the matching release flag is set. Clients cannot set `markedBy` / `markedAt` / `submittedBy`.

```http
GET    /api/v1/learning/work-types
GET    /api/v1/learning/context
GET    /api/v1/learning/dashboard
GET    /api/v1/learning/assignments
POST   /api/v1/learning/assignments
GET    /api/v1/learning/assignments/{id}
PATCH  /api/v1/learning/assignments/{id}
POST   /api/v1/learning/assignments/{id}/publish
POST   /api/v1/learning/assignments/{id}/close
POST   /api/v1/learning/assignments/{id}/archive
POST   /api/v1/learning/assignments/{id}/targets
POST   /api/v1/learning/assignments/{id}/resources
GET    /api/v1/learning/assignments/{id}/progress
GET    /api/v1/learning/assignments/{id}/submissions
GET    /api/v1/learning/submissions
GET    /api/v1/learning/submissions/{id}
POST   /api/v1/learning/submissions/{id}/marks
GET    /api/v1/students/{id}/learning

GET    /api/v1/student/assignments
GET    /api/v1/student/assignments/{id}
POST   /api/v1/student/assignments/{id}/submissions

GET    /api/v1/parent/children/{studentId}/assignments
GET    /api/v1/parent/children/{studentId}/assignments/{assignmentId}
```

`POST /learning/assignments` always creates `draft`. Publish snapshots recipients from current targets. PATCH/publish/close/archive/resources require school-wide `lms.assignments.manage` or `created_by` of the assignment. Teachers with only `manage_assigned` cannot take over another staff member’s work merely because they share a pupil. Assignment list/dashboard filters: `status`, `classId`, `subjectId`, `dueFrom`, `dueTo`. Student list filter: `bucket` (`assigned`, `due_soon`, `overdue`, `due`, `submitted`, `returned`, `completed`). Parent endpoints never accept a submission body.

Binary file upload is not implemented. Resource rows currently require a validated `http(s)` URL. Storage-port key builders exist for a later S3-compatible adapter.

## Formal assessments, results, and reports (Phase 8)

Distinct from `/learning/*/marks` and `/admissions/assessments`. Clients cannot set actor or timestamp fields. Cross-tenant IDs return **404**. Portal payloads omit internal notes and unreleased/unpublished items.

```http
GET    /api/v1/assessments/types
GET    /api/v1/assessments/grade-schemes
POST   /api/v1/assessments/grade-schemes
GET    /api/v1/assessments/reporting-periods
POST   /api/v1/assessments/reporting-periods
PATCH  /api/v1/assessments/reporting-periods/{id}
GET    /api/v1/assessments/context
GET    /api/v1/assessments
POST   /api/v1/assessments
GET    /api/v1/assessments/{id}
PATCH  /api/v1/assessments/{id}
POST   /api/v1/assessments/{id}/open
POST   /api/v1/assessments/{id}/complete
POST   /api/v1/assessments/{id}/review
POST   /api/v1/assessments/{id}/publish
POST   /api/v1/assessments/{id}/archive
GET    /api/v1/assessments/{id}/results
PUT    /api/v1/assessments/{id}/results
POST   /api/v1/assessments/{id}/results/{studentId}/review
GET    /api/v1/assessments/{id}/summary
GET    /api/v1/students/{studentId}/academic
GET    /api/v1/students/{studentId}/targets
POST   /api/v1/students/{studentId}/targets
PATCH  /api/v1/academic-targets/{id}
GET    /api/v1/reports
POST   /api/v1/reports
GET    /api/v1/reports/{id}
PATCH  /api/v1/reports/{id}
POST   /api/v1/reports/{id}/sections
PATCH  /api/v1/reports/{id}/sections/{sectionId}
POST   /api/v1/reports/{id}/submit
POST   /api/v1/reports/{id}/approve
POST   /api/v1/reports/{id}/publish
POST   /api/v1/reports/{id}/archive
```

`PUT /assessments/{id}/results` accepts a class grid `{ results: [{ studentProfileId, rawScore, gradeSchemeLevelId, teacherJudgement, comment, releasedToStudent, releasedToParent }] }`.

## Communications and calendar (Phase 10)

Staff APIs. Teachers require assigned class/pupil access for create/target. School-wide audiences require `announcements.broadcast` / `calendar.manage_school`. Cross-tenant target IDs return **404**. Clients cannot set `createdBy` / `publishedBy` or another user’s read/ack timestamps.

```http
GET    /api/v1/announcements
POST   /api/v1/announcements
GET    /api/v1/announcements/{id}
PATCH  /api/v1/announcements/{id}
POST   /api/v1/announcements/{id}/publish
POST   /api/v1/announcements/{id}/archive
GET    /api/v1/announcements/{id}/receipts
POST   /api/v1/announcements/{id}/read
POST   /api/v1/announcements/{id}/acknowledge
GET    /api/v1/calendar/event-types
GET    /api/v1/calendar/events
POST   /api/v1/calendar/events
GET    /api/v1/calendar/events/{id}
PATCH  /api/v1/calendar/events/{id}
POST   /api/v1/calendar/events/{id}/publish
POST   /api/v1/calendar/events/{id}/archive
```

Scheduled rows activate on authorised list/read. Resource payloads expose URL metadata only (`storageKey` omitted). Email/SMS/push are not implemented.

## Behaviour, pastoral and safeguarding (Phase 11)

Staff APIs. Teachers are assigned-only for behaviour. Pastoral and safeguarding require their own capabilities. Missing safeguarding permission returns **404**. Clients cannot set `recordedBy`, `raisedBy`, or chronology `actorUserId`. Safeguarding audit payloads store IDs/status only. Parent/student routes do not expose these records in Phase 11.

```http
GET    /api/v1/behaviour/categories
GET    /api/v1/behaviour/incidents
POST   /api/v1/behaviour/incidents
GET    /api/v1/behaviour/incidents/{id}
PATCH  /api/v1/behaviour/incidents/{id}
GET    /api/v1/behaviour/incidents/{id}/history
POST   /api/v1/behaviour/incidents/{id}/parent-contact
GET    /api/v1/behaviour/positives
POST   /api/v1/behaviour/positives
GET    /api/v1/behaviour/positives/{id}
GET    /api/v1/behaviour/actions
POST   /api/v1/behaviour/actions
PATCH  /api/v1/behaviour/actions/{id}
GET    /api/v1/behaviour/summary
GET    /api/v1/students/{studentId}/behaviour
GET    /api/v1/pastoral/categories
GET    /api/v1/pastoral/concerns
POST   /api/v1/pastoral/concerns
GET    /api/v1/pastoral/concerns/{id}
PATCH  /api/v1/pastoral/concerns/{id}
POST   /api/v1/pastoral/concerns/{id}/interventions
POST   /api/v1/pastoral/concerns/{id}/parent-contact
PATCH  /api/v1/pastoral/interventions/{id}
GET    /api/v1/pastoral/summary
GET    /api/v1/students/{studentId}/pastoral
GET    /api/v1/safeguarding/categories
GET    /api/v1/safeguarding/concerns
POST   /api/v1/safeguarding/concerns
GET    /api/v1/safeguarding/concerns/{id}
PATCH  /api/v1/safeguarding/concerns/{id}
POST   /api/v1/safeguarding/concerns/{id}/assign
POST   /api/v1/safeguarding/concerns/{id}/chronology
POST   /api/v1/safeguarding/concerns/{id}/attachments
GET    /api/v1/safeguarding/summary
GET    /api/v1/students/{studentId}/safeguarding
```

`GET /students/{id}` may include `behaviourSummary` / `pastoralSummary` when the actor has those permissions. It never includes safeguarding narrative or keys.

## Timetable (Phase 12)

Recurring definitions plus date-specific exceptions. Occurrences are resolved at query time. Lessons are **not** inserted into `school_events`. Parent/student payloads omit staff notes and cover reasons.

```http
GET    /api/v1/timetable/overview
GET    /api/v1/timetable/school-day-profiles
POST   /api/v1/timetable/school-day-profiles
PATCH  /api/v1/timetable/school-day-profiles/{id}
POST   /api/v1/timetable/school-day-profiles/{id}/periods
PATCH  /api/v1/timetable/periods/{id}
GET    /api/v1/timetable/rooms
POST   /api/v1/timetable/rooms
PATCH  /api/v1/timetable/rooms/{id}
GET    /api/v1/timetable/entries
POST   /api/v1/timetable/entries
GET    /api/v1/timetable/entries/{id}
PATCH  /api/v1/timetable/entries/{id}
GET    /api/v1/timetable/occurrences
GET    /api/v1/timetable/my-day
POST   /api/v1/timetable/occurrences/attendance-register
GET    /api/v1/timetable/exceptions
POST   /api/v1/timetable/exceptions
GET    /api/v1/timetable/covers
POST   /api/v1/timetable/covers
GET    /api/v1/dashboard/timetable
GET    /api/v1/student/timetable
GET    /api/v1/parent/children/{studentId}/timetable
```

`POST /timetable/occurrences/attendance-register` identifies the existing Phase 6 register for that class/date/session and does not create marks. Conflicts return `409` with `details.conflicts`.

## Activities, trips, clubs, and consents (Phase 14)

Canonical activity records. Calendar list endpoints also return `activities` with `source: "activity"`; they are not copied into `school_events`. Parent and student calendars do not apply the timetable 14-day default to activities unless `from`/`to` are passed. Clients cannot set `createdBy` / `publishedBy` / guardian identity. Consent requires `confirm: true`. Offline consent is stored as `staff_offline` with guardian columns forced null. Safety summaries never return `restricted_contact` or `send_notes`.

```http
GET    /api/v1/activities/types
GET    /api/v1/activities/context
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/{id}
PATCH  /api/v1/activities/{id}
POST   /api/v1/activities/{id}/publish
POST   /api/v1/activities/{id}/close
POST   /api/v1/activities/{id}/complete
POST   /api/v1/activities/{id}/cancel
POST   /api/v1/activities/{id}/archive
GET    /api/v1/activities/{id}/eligible
GET    /api/v1/activities/{id}/participants
GET    /api/v1/activities/{id}/participants.csv
POST   /api/v1/activities/{id}/participants
POST   /api/v1/activities/{id}/participants/{studentId}/offline-response
POST   /api/v1/activities/{id}/participants/{studentId}/promote
POST   /api/v1/activities/{id}/participants/{studentId}/withdraw
PATCH  /api/v1/activities/{id}/participants/{studentId}
GET    /api/v1/activities/{id}/responses
GET    /api/v1/activities/{id}/safety-summary
POST   /api/v1/activities/{id}/documents
POST   /api/v1/activities/{id}/documents/{documentId}/delete
POST   /api/v1/activities/{id}/updates
GET    /api/v1/parent/activities
GET    /api/v1/parent/children/{studentId}/activities
GET    /api/v1/parent/children/{studentId}/activities/{activityId}
POST   /api/v1/parent/children/{studentId}/activities/{activityId}/respond
GET    /api/v1/student/activities
GET    /api/v1/student/activities/{activityId}
POST   /api/v1/student/activities/{activityId}/signup
POST   /api/v1/student/activities/{activityId}/withdraw
```

User-facing errors include `response_deadline_passed`, `activity_full`, `no_longer_eligible`, `activity_cancelled`. CSV export omits medical fields. Safety summary is live pupil data, permission-gated, and never includes safeguarding.

## School charges and payments (Phase 15)

Charges belong to a pupil. Parents pay after guardianship + `portal_access` on every request. Provider webhooks are authoritative; they never trust `X-Organisation-Id`, Host, or a client-selected tenant. Redirect `?status=` is not treated as success. Local/CI uses `PAYMENT_PROVIDER=fake` when a school has no Stripe configuration. Each school stores its own encrypted Stripe credentials. Global `STRIPE_SECRET_KEY` is not used for school payments.

```http
GET    /api/v1/finance/overview
GET    /api/v1/finance/categories
GET    /api/v1/finance/charges
POST   /api/v1/finance/charges
POST   /api/v1/finance/charges/bulk
GET    /api/v1/finance/charges/export
GET    /api/v1/finance/charges/{id}
POST   /api/v1/finance/charges/{id}/issue
POST   /api/v1/finance/charges/{id}/cancel
POST   /api/v1/finance/charges/{id}/adjust
POST   /api/v1/finance/charges/{id}/offline-payment
POST   /api/v1/finance/charges/{id}/refund
GET    /api/v1/finance/outstanding
GET    /api/v1/finance/transactions
GET    /api/v1/finance/refunds
GET    /api/v1/parent/payments
GET    /api/v1/parent/children/{studentId}/payments
GET    /api/v1/parent/payments/{chargeId}
POST   /api/v1/parent/payments/{chargeId}/checkout
GET    /api/v1/finance/payment-provider
PUT    /api/v1/finance/payment-provider
POST   /api/v1/finance/payment-provider/test
POST   /api/v1/finance/payment-provider/enable
POST   /api/v1/finance/payment-provider/disable
POST   /api/v1/webhooks/payments/stripe/{endpointId}
POST   /api/v1/webhooks/payments/{provider}
GET    /api/v1/payments/demo/checkout/{sessionId}
POST   /api/v1/payments/demo/checkout/{sessionId}/complete
```

User-facing errors include `charge_already_paid`, `no_amount_outstanding`, `payment_unavailable`, `payment_failed`, `refund_failed`, `invalid_amount`, `overpayment`, `forbidden`. CSV export omits card data, provider secrets, and unnecessary guardian PII. Activity participant lists may include operational `paymentStatus` (`paid` / `outstanding` / `not_required`) without amounts unless the actor has finance permissions.

## School messaging (Phase 16)

Conversations are participant-based. Unauthorised or cross-tenant IDs return **404**. Message bodies are plain text (sanitised; max 8000). Notifications do not include message text. Email/SMS/push are not sent.

```http
GET    /api/v1/messages/unread-count
GET    /api/v1/messages/conversations
POST   /api/v1/messages/conversations
GET    /api/v1/messages/conversations/{id}
GET    /api/v1/messages/conversations/{id}/messages
POST   /api/v1/messages/conversations/{id}/messages
POST   /api/v1/messages/conversations/{id}/read
POST   /api/v1/messages/conversations/{id}/close
POST   /api/v1/messages/conversations/{id}/reopen
POST   /api/v1/messages/conversations/{id}/archive
POST   /api/v1/messages/conversations/{id}/messages/{messageId}/redact
POST   /api/v1/messages/conversations/{id}/messages/{messageId}/attachments
GET    /api/v1/messages/pupils/{studentId}/recipients
GET    /api/v1/students/{studentId}/contact-history
GET    /api/v1/parent/messages
GET    /api/v1/parent/messages/contacts?studentId=
POST   /api/v1/parent/messages
GET    /api/v1/parent/messages/{id}
GET    /api/v1/parent/messages/{id}/messages
POST   /api/v1/parent/messages/{id}/messages
POST   /api/v1/parent/messages/{id}/read
POST   /api/v1/parent/messages/{id}/archive
POST   /api/v1/parent/messages/{id}/messages/{messageId}/attachments
```

List APIs are cursor-paginated (`cursor` / `before`, `limit`). Parent contact points are `class_teacher`, `school_office`, and `admissions`. Arbitrary staff user IDs are rejected. Attachment download uses `GET /api/v1/files/{storedObjectId}` after a live conversation-access check.

User-facing errors include `conversation_closed`, `recipient_unavailable`, `rate_limited`, `validation_failed`.

## Statutory data, census snapshots, and reports (Phase 18)

School-scoped. Every route re-checks organisation membership and capability keys. These APIs are **census-ready / preview**, not DfE COLLECT submission.

```http
GET    /api/v1/statutory/codes
GET    /api/v1/statutory/overview
GET    /api/v1/statutory/profile
PATCH  /api/v1/statutory/profile
GET    /api/v1/statutory/data-quality
POST   /api/v1/statutory/validate
GET    /api/v1/students/{id}/statutory
PATCH  /api/v1/students/{id}/statutory
POST   /api/v1/students/{id}/statutory/fsm

GET    /api/v1/statutory/census
POST   /api/v1/statutory/census
GET    /api/v1/statutory/census/{id}
POST   /api/v1/statutory/census/{id}/snapshot
POST   /api/v1/statutory/census/{id}/validate
POST   /api/v1/statutory/census/{id}/finalise
POST   /api/v1/statutory/census/{id}/export?format=csv|xml
POST   /api/v1/statutory/census/{id}/supersede
POST   /api/v1/statutory/census/{id}/archive

GET    /api/v1/reports/pupils
GET    /api/v1/reports/attendance
GET    /api/v1/reports/admissions
GET    /api/v1/reports/send
GET    /api/v1/reports/exports
```

Report routes accept `?format=csv` where the actor also has `reports.exports.create`. Census XML is labelled a preview and is not a certified COLLECT file. Cross-school census IDs return `not_found`. Teachers, parents, students, and Platform Admin without school membership cannot browse statutory pupil data.

## Engagement, rewards, competitions, and early learning (Phase 19)

School-scoped. Student Portal enablement stays on Phase 6 policy. Clients submit answers only; the server decides score, XP, achievements, and leaderboard contribution. `xpAwarded` / `rewardPoints` / `achievementIds` in a body are ignored.

```http
GET    /api/v1/engagement/settings
PATCH  /api/v1/engagement/settings
PUT    /api/v1/engagement/year-groups/{yearGroupId}
GET    /api/v1/engagement/overview

GET    /api/v1/reward-categories
POST   /api/v1/reward-categories
GET    /api/v1/rewards
POST   /api/v1/rewards
POST   /api/v1/rewards/bulk
POST   /api/v1/rewards/{id}/revoke

GET    /api/v1/achievements/definitions
POST   /api/v1/achievements/definitions
POST   /api/v1/achievements/award
GET    /api/v1/achievements?studentId=

GET    /api/v1/competitions
POST   /api/v1/competitions
GET    /api/v1/competitions/{id}
POST   /api/v1/competitions/{id}/publish
POST   /api/v1/competitions/{id}/complete
POST   /api/v1/competitions/{id}/scores
GET    /api/v1/competitions/{id}/leaderboard

GET    /api/v1/learning-activities
POST   /api/v1/learning-activities
GET    /api/v1/learning-activities/{id}
POST   /api/v1/learning-activities/{id}/publish
POST   /api/v1/learning-practice/assignments
POST   /api/v1/learning-practice/assignments/{id}/publish
GET    /api/v1/learning-practice/progress?studentId=

GET    /api/v1/student/engagement
GET    /api/v1/student/rewards
GET    /api/v1/student/achievements
GET    /api/v1/student/competitions
GET    /api/v1/student/competitions/{id}/leaderboard
GET    /api/v1/student/practice
GET    /api/v1/student/practice/{assignmentId}
POST   /api/v1/student/practice/{assignmentId}/start
POST   /api/v1/student/practice/attempts/{attemptId}/submit

GET    /api/v1/parent/children/{studentId}/engagement
GET    /api/v1/parent/children/{studentId}/rewards
GET    /api/v1/parent/children/{studentId}/achievements
GET    /api/v1/parent/children/{studentId}/competitions
GET    /api/v1/parent/children/{studentId}/competitions/{id}/leaderboard
GET    /api/v1/parent/children/{studentId}/practice
GET    /api/v1/parent/children/{studentId}/practice/{assignmentId}
POST   /api/v1/parent/children/{studentId}/practice/{assignmentId}/start
POST   /api/v1/parent/children/{studentId}/practice/attempts/{attemptId}/submit
```

Leaderboard `?scope=` cannot widen visibility. Parent/student practice GET never includes `correctAnswer`. Internal reward notes are omitted from parent/student payloads. Parent list/play/start/submit require year-group `parentAssistedMode` plus live `portal_access`; GET of items is `403` when assisted mode is off. Pupil-facing practice lists only activity types allowed by year-group policy (early-learning types vs `challenge`). Attempts resume only on the same channel (`student` vs `parent_assisted`). Revoking a reward that granted XP inserts an append-only XP reversal. Cross-school IDs return `not_found`. Platform Admin has no school engagement browse. See [ADR 0028](../adr/0028-phase19-engagement.md).

## School onboarding, branding, accounts, and imports

```http
GET    /api/v1/onboarding
PATCH  /api/v1/onboarding/progress
GET    /api/v1/onboarding/profile
PATCH  /api/v1/onboarding/profile
PATCH  /api/v1/onboarding/branding
POST   /api/v1/onboarding/branding/{logo|hero}
GET    /api/v1/onboarding/mail

POST   /api/v1/staff/{id}/invite
POST   /api/v1/staff/{id}/invite/revoke
POST   /api/v1/staff/{id}/suspend
POST   /api/v1/staff/{id}/reactivate
PATCH  /api/v1/staff/{id}/roles

POST   /api/v1/guardianships/{id}/invite
POST   /api/v1/guardianships/{id}/invite/revoke
POST   /api/v1/students/{id}/guardians/link-existing
POST   /api/v1/students/{id}/portal-login
POST   /api/v1/students/{id}/portal-login/reset
POST   /api/v1/students/{id}/portal-login/disable

GET    /api/v1/imports/templates/{staff|pupils|guardians}
POST   /api/v1/imports/{staff|pupils|guardians}
GET    /api/v1/imports/{id}
POST   /api/v1/imports/{id}/confirm
```

Invitation, activation, and password-reset tokens are shown once in the issuing response (or inspectable local mail outbox) and stored hashed. Forgot-password always returns the same copy. `portalAccess` omitted or false never enables Parent Portal. Staff import cannot assign `school.admin`. Public branding endpoints return image bytes only — never storage keys. See [ADR 0030](../adr/0030-phase20-onboarding.md).

## Files

```http
POST /api/v1/files/upload-url    # { contentType, byteSize, purpose }
GET  /api/v1/files/{id}/download-url
```

The client uploads to the signed URL. The API never embeds long-lived storage keys in mobile binaries.

## Why not PostgREST / Supabase client on mobile

Mobile would then need the schema, RLS would be the only gate, and every table change would be a breaking mobile change. Authorisation like “this teacher, these classes” is clearer in use cases. **Supabase stays behind the server adapter.**

## Client package

`packages/api-client` wraps `fetch`, attaches cookies or Bearer tokens, sets `X-Organisation-Id`, and types responses from OpenAPI. Expo will depend on this package (or a generated subset) without importing Next.js.
