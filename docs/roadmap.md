# Phased development roadmap

Do **not** implement the whole product in one operation. Each phase has an exit criterion. Architecture (Phase 0) is this documentation set.

## Phase 0 — Architecture (current)

**Deliverable:** this `docs/` tree, ADRs, proposed schema, API conventions.  
**Exit:** remaining product-owner items in ARCHITECTURE.md §11 are decided or explicitly deferred. No production code required.

## Phase 1 — Platform foundation

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

## Phase 2 — People and academic structure

- Staff profiles, student profiles, guardianships (incl. parental responsibility fields)
- Academic years, **terms, half-terms**, year groups, houses, subjects
- **Historical `student_enrolments`** (year group per academic year)
- Classes per academic year; **dated `class_memberships`**; **`class_staff_assignments`**; **`class_subjects`**
- No `class_id` on the student profile
- School Admin invites teachers and parents
- Student user provisioning (login optional per year group)
- Staff UI: pupil list (org-scoped), using current-year derived class/year group

## Phase 3 — Parent and student web portals (read)

- Parent: my children, basic profile, announcements placeholder
- Student: home shell
- Same `/api/v1/parent/*` and `/api/v1/student/*` that Expo will call later
- Notification inbox table (delivery later)

Proves the API-for-mobile rule **before** any native app.

## Phase 4 — Admissions

- Enquiries, applications, simple assessments, waiting list, offers
- Conversion to active student + parent invite
- Admissions staff role matrix

## Phase 5 — Attendance, documents, announcements

- Registers and UK-style codes (configurable)
- Document metadata + signed uploads
- School announcements by audience

## Phase 6 — LMS core

- Assignments, targeting (class/year/student)
- Submissions and teacher marking/feedback
- Learning resources
- Homework lists on parent and student APIs

## Phase 7 — Results and progress reports

- Assessments/results model
- Teacher feedback records
- Simple progress report artefact (PDF later)

## Phase 8 — AI learning

- `packages/ai` port + one provider
- Activity drafts, moderation hook, teacher approval workflow
- Student attempts API
- Year-group and subject targeting
- Generation audit (no PII in prompts)

## Phase 9 — Gamification

- Points/XP ledgers, badges, streaks
- Competitions: student, class, house (not school-vs-school; network tables remain governance placeholders)
- Leaderboards honouring school flags and Children’s Code defaults (off)

## Phase 10 — Mobile clients

- Expo app: **parent** first (read-mostly)
- Then **student** (attempts, homework submit if API already exists)
- Optional **teacher** (registers, marking) only after staff API is stable
- PKCE auth, secure token storage, `X-Organisation-Id`, push tokens

No second backend.

## Phase 11 — Integrations and hardening

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
