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
POST /api/v1/invitations/{token}/accept

GET  /api/v1/me
GET  /api/v1/me/memberships
PATCH /api/v1/me
POST /api/v1/me/devices          # reserve for Expo push tokens; stub later

GET  /api/v1/public/tenant       # Host-based platform vs school identity (public name/slug only)
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
POST /api/v1/platform/organisations/{id}/slug
POST /api/v1/platform/organisations/{id}/suspend
POST /api/v1/platform/organisation-hostnames/{id}/verify
POST /api/v1/platform/organisation-hostnames/{id}/activate
```

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
GET /api/v1/parent/children/{studentId}/assignments
GET /api/v1/parent/children/{studentId}/results
GET /api/v1/parent/children/{studentId}/feedback
GET /api/v1/parent/children/{studentId}/reports
GET /api/v1/parent/children/{studentId}/achievements
GET /api/v1/parent/announcements
```

Phase 3 implements dashboard, children list, and child overview (profile + school/year/form + viewer guardianship). Phase 6 implements child attendance (parent-visible notes only). Later child modules remain unimplemented. Responses never include `restricted_contact`, admin notes, billing, or other organisations' children.

## Student portal

```http
GET  /api/v1/student/me
GET  /api/v1/student/dashboard
GET  /api/v1/student/attendance
GET  /api/v1/student/assignments
POST /api/v1/student/assignments/{id}/submissions
GET  /api/v1/student/resources
GET  /api/v1/student/activities
POST /api/v1/student/activities/{id}/attempts
GET  /api/v1/student/progress
```

Phase 3 implements `me` and `dashboard` for the authenticated student's own profile in the current organisation. Phase 6 adds `GET /api/v1/student/attendance` (own marks, parent-visible notes only) when the effective student-portal policy allows access. Spoofing `X-Organisation-Id` for a school the pupil does not belong to returns `org_membership_required`. Login aliases remain organisation-scoped. A disabled student portal refuses alias login even if an alias/password exists.

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

A future public school-website enquiry form should POST the same enquiry fields; the public unauthenticated endpoint is not implemented in Phase 4.

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
