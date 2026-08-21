# Phased development roadmap

Do **not** implement the whole product in one operation. Each phase has an exit criterion. Architecture (Phase 0) is this documentation set.

## Phase 0 — Architecture (accepted)

**Deliverable:** this `docs/` tree, ADRs, proposed schema, API conventions.  
**Exit:** product-owner decisions recorded in [ADR 0011](./adr/0011-product-owner-phase-1-decisions.md).

## Phase 1 — Platform foundation (implemented)

**Outcome:** a school can be provisioned; a user can log in; tenancy is enforced.

- Monorepo (pnpm, Turborepo, TypeScript, ESLint, Prettier)
- `apps/web` with login shell and platform/school route groups
- Postgres + Drizzle; apply foundation schema
- `set_tenant_context` (transaction-local); FORCE RLS on suitable tables
- **Mandatory automated cross-tenant security tests** (HTTP + pooling/GUC leak + audit privileges) as a merge gate
- Auth adapter (GoTrue/Supabase) with web cookies
- Permission seed + Actor; memberships revalidated from DB every school-scoped request
- `GET /api/v1/me`, `GET /api/v1/me/memberships`
- Platform Super Admin: create organisation, invite School Admin
- Formal `audit_events` writer (append-only); application logs remain stdout
- Docker Compose for local Postgres (and optional Supabase local). Object storage via configured S3-compatible endpoint; MinIO not required

**Not in Phase 1:** admissions, LMS, AI, parent portal content, mobile, billing collection, notification delivery, inter-school competitions.

## Phase 2 — People and academic structure (implemented)

**Outcome:** a school can manage staff, students, parents/guardians, academic years, year groups, classes, subjects, teacher assignments, and historical enrolments.

- Staff profiles; School Admin invites teachers and other staff (same identity/auth as Phase 1)
- Student profiles with **no `class_id`**; current year group/class derived from the current academic year
- Historical `student_enrolments` (primary + optional secondary/exceptional) and dated `class_memberships`
- Guardianships with parental-responsibility fields; parent identity remains global
- Academic years, terms, year groups (Reception through the school's configured maximum year), houses, subjects
- Classes per academic year; `class_staff_assignments`; `class_subjects`
- Optional org-scoped student login aliases (same `/api/v1` auth as future mobile apps)
- School Admin web screens: dashboard, Students, Staff, Parents, Academic Years, Year Groups, Classes, Subjects
- Mandatory tests: tenant isolation, parent-child scoping, teacher assigned access, enrolment/class history

**Not in Phase 2:** parent/student portal UI, attendance, LMS, results, AI, competitions, Expo apps.

## Phase 3 — Parent and student web portals (implemented)

**Outcome:** a parent can sign in and see only children they are authorised to access; a student can sign in and see only their own record. The same `/api/v1` contract is ready for Expo.

- Parent portal: dashboard, my children, child overview, notifications, account/school switcher
- Student portal: home, my learning placeholder, notifications, profile
- `GET /api/v1/parent/dashboard`, `GET /api/v1/parent/children`, `GET /api/v1/parent/children/{studentId}`
- `GET /api/v1/student/me`, `GET /api/v1/student/dashboard`
- In-app notification inbox table + `GET/PATCH /api/v1/notifications` (no email/SMS/push)
- Mandatory tests: parent-child scoping, `portal_access`, student self-only, alias org-scoping, notification isolation, sensitive-field exclusion

**Not in Phase 3:** attendance, LMS, results, AI, competitions, Expo apps, push/email delivery.

## Phase 4 — Admissions (implemented)

**Outcome:** a school can manage enquiries, applications, lightweight assessments/interviews, waiting lists, offers, and a controlled conversion of an accepted applicant into the canonical student/enrolment model.

- Admissions dashboard (counts + filtered-list links)
- Enquiries (staff API designed for a future public website form; public form not built)
- Applications with stable references, contacts, status history, and extensible `extra_fields`
- Controlled status machine (including deferred); `enrolled` only via conversion
- Assessments/interviews (not an exam engine)
- Waiting list without automatic ranking
- Offers (no payments/deposits)
- `POST /api/v1/admissions/applications/{id}/enrol` — idempotent conversion
- Permissions: `admissions.read`, `admissions.enquiries.manage`, `admissions.applications.manage`, `admissions.offers.manage`, `admissions.decide`, `admissions.convert`
- In-app notifications for a few events when the contact already has a user identity

**Not in Phase 4:** attendance, LMS, results, AI, payments, document binaries, public website form, ranking algorithms, email/SMS/push.

## Phase 5 — SaaS tenant routing, school subdomains, and onboarding foundation (implemented)

**Outcome:** the same application can serve the platform apex and per-school subdomains without weakening Phase 1–4 isolation.

- Unique DNS-safe organisation slugs; reserved platform names blocked
- Central hostname → organisation resolver; header mismatch fails closed
- Root/platform host does not auto-select a school
- Internal transactional onboarding (`provision_organisation`); public signup disabled
- School-aware login branding (display only, not authority)
- Local development via `*.localhost` and `PLATFORM_DOMAIN`
- Custom-domain data model with verification/activation; unverified hostnames never resolve

**Not in Phase 5:** production wildcard DNS/TLS, automated certificate provisioning, public self-service signup, billing collection, attendance.

## Phase 6 — Attendance, documents, announcements

- Registers and UK-style codes (configurable)
- Document metadata + signed uploads
- School announcements by audience

## Phase 7 — LMS core

- Assignments, targeting (class/year/student)
- Submissions and teacher marking/feedback
- Learning resources
- Homework lists on parent and student APIs

## Phase 8 — Results and progress reports

- Assessments/results model
- Teacher feedback records
- Simple progress report artefact (PDF later)

## Phase 9 — AI learning

- `packages/ai` port + one provider
- Activity drafts, moderation hook, teacher approval workflow
- Student attempts API
- Year-group and subject targeting
- Generation audit (no PII in prompts)

## Phase 10 — Gamification

- Points/XP ledgers, badges, streaks
- Competitions: student, class, house (not school-vs-school; network tables remain governance placeholders)
- Leaderboards honouring school flags and Children’s Code defaults (off)

## Phase 11 — Mobile clients

- Expo app: **parent** first (read-mostly)
- Then **student** (attempts, homework submit if API already exists)
- Optional **teacher** (registers, marking) only after staff API is stable
- PKCE auth, secure token storage, `X-Organisation-Id`, push tokens

No second backend.

## Phase 12 — Integrations and hardening

- MIS identifiers, CTF/census experiments
- SSO (Microsoft 365 / Google Workspace) if schools demand it
- Pen test, DPIA refresh, retention jobs, backup drills
- Optional extract of Route Handlers to `apps/api`

## Suggested sequencing rationale

Parents will not pay for AI quizzes if they cannot see **their child and homework**. Schools will not trust AI if **tenancy and admissions conversion** are weak. Mobile will fail if the web portals used Server Actions only. Therefore: **identity → people → portals/API → operations/LMS → AI → games → mobile**.

## Definition of done (every phase)

- OpenAPI updated for any parent/student/staff capability
- New tenant tables have `organisation_id`, ENABLE + FORCE RLS, and cross-tenant tests
- Formal audit events for sensitive mutations (before/after), not only application logs
- Permissions added to the catalogue with default role grants
- No special-category fields unless explicitly in scope
- Feature flagged per organisation where behaviour varies
- Client org headers never treated as tenant authority
