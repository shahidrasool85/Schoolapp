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
| Tenant | `X-Organisation-Id: <uuid>` **requests** context on school-scoped routes. It is **not** authority. The server revalidates active membership in Postgres, then sets transaction-local RLS context. JWT org claims are likewise non-authoritative |
| Idempotency | `Idempotency-Key` on POSTs that create submissions, attendance, payments (later) |
| Pagination | `?cursor=` or `?page=&pageSize=` — pick cursor for large lists in implementation |
| Errors | `{ "error": { "code": "forbidden", "message": "...", "details": {} } }` |
| Cross-tenant | **404** not 403 when the UUID belongs to another school or is unknown |
| Trace | `X-Request-Id` echoed |

Unauthenticated routes: health, login, invite accept, password reset.

## Error codes (stable)

`unauthenticated`, `org_context_required`, `org_membership_required`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `rate_limited`.

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
```

`GET /api/v1/me` returns the user and does **not** require `X-Organisation-Id`.

`GET /api/v1/me/memberships` returns schools the user may enter (`organisationId`, `name`, `roles[]`, `kind`). It runs **without** tenant GUCs (security-definer listing). Spoofing an org id that is not in this list must not set tenant context.

School-scoped example:

```http
GET /api/v1/students/{studentId}
X-Organisation-Id: 0c1e…
Authorization: Bearer …
```

If the header is missing, `org_context_required`. If the membership is missing, suspended, or ended, `org_membership_required`. If the student is in another org, `not_found`.

## Platform Super Admin

Prefix `/api/v1/platform/...` — no school header.

```http
GET  /api/v1/platform/organisations
POST /api/v1/platform/organisations
POST /api/v1/platform/organisations/{id}/suspend
```

## School administration (Phase 1–2)

```http
GET  /api/v1/organisation
PATCH /api/v1/organisation/settings
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
GET  /api/v1/parent/children
GET  /api/v1/parent/children/{studentId}
```

Student login (optional per year group) uses the same `POST /api/v1/auth/login` contract with `organisationSlug` + `username` instead of email. Parent and student users share this identity model; there is no second auth stack.

## Parent portal (web now, Expo later)

All routes check `school.parent` + guardianship.

```http
GET /api/v1/parent/children
GET /api/v1/parent/children/{studentId}
GET /api/v1/parent/children/{studentId}/attendance
GET /api/v1/parent/children/{studentId}/assignments
GET /api/v1/parent/children/{studentId}/results
GET /api/v1/parent/children/{studentId}/feedback
GET /api/v1/parent/children/{studentId}/reports
GET /api/v1/parent/children/{studentId}/achievements
GET /api/v1/parent/announcements
GET /api/v1/parent/notifications
```

Only `/parent/children` is in scope near-term; the rest must exist as API routes **when** those modules are built — not as Next.js-only pages.

## Student portal

```http
GET  /api/v1/student/home
GET  /api/v1/student/assignments
POST /api/v1/student/assignments/{id}/submissions
GET  /api/v1/student/resources
GET  /api/v1/student/activities
POST /api/v1/student/activities/{id}/attempts
GET  /api/v1/student/progress
```

## Staff / LMS / admissions

Same resources the web SIS uses, e.g. `/api/v1/admissions/applications`, `/api/v1/assignments`. A future teacher app reuses them unchanged.

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
