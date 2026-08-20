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
GET  /api/v1/notifications
PATCH /api/v1/notifications/{notificationId}
```

Student login (optional per year group) uses the same `POST /api/v1/auth/login` contract with `organisationSlug` + `username` instead of email. Alias login returns `organisationId` for the school that authenticated the username so clients do not have to guess context. Parent and student users share this identity model; there is no second auth stack.

## Parent portal (web now, Expo later)

All routes require an active organisation membership, `students.profiles.read_own_children`, and an active guardianship with `portal_access = true` in the current organisation. Knowing a child id is not sufficient. Cross-org and unlinked ids return **404**.

```http
GET /api/v1/parent/dashboard
GET /api/v1/parent/children
GET /api/v1/parent/children/{studentId}
GET /api/v1/parent/children/{studentId}/attendance
GET /api/v1/parent/children/{studentId}/assignments
GET /api/v1/parent/children/{studentId}/results
GET /api/v1/parent/children/{studentId}/feedback
GET /api/v1/parent/children/{studentId}/reports
GET /api/v1/parent/children/{studentId}/achievements
GET /api/v1/parent/announcements
```

Phase 3 implements dashboard, children list, and child overview (profile + school/year/form + viewer guardianship). Later child modules remain unimplemented. Responses never include `restricted_contact`, admin notes, billing, or other organisations' children.

## Student portal

```http
GET  /api/v1/student/me
GET  /api/v1/student/dashboard
GET  /api/v1/student/assignments
POST /api/v1/student/assignments/{id}/submissions
GET  /api/v1/student/resources
GET  /api/v1/student/activities
POST /api/v1/student/activities/{id}/attempts
GET  /api/v1/student/progress
```

Phase 3 implements `me` and `dashboard` for the authenticated student's own profile in the current organisation. Spoofing `X-Organisation-Id` for a school the pupil does not belong to returns `org_membership_required`. Login aliases remain organisation-scoped.

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

`POST .../enrol` body may include `academicYearId`, `yearGroupId`, `classId`, `admissionNumber`, `existingStudentProfileId`, and `guardianLinks: [{ contactId, portalAccess }]`. Retrying returns the same student. The application record is not deleted.

A future public school-website enquiry form should POST the same enquiry fields; the public unauthenticated endpoint is not implemented in Phase 4.

## Staff / LMS

Same resources the web SIS uses, e.g. `/api/v1/assignments`. A future teacher app reuses them unchanged.

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
