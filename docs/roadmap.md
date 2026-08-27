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
- Enquiries (staff API; public website form delivered in Phase 9)
- Applications with stable references, contacts, status history, and extensible `extra_fields`
- Controlled status machine (including deferred); `enrolled` only via conversion
- Assessments/interviews (not an exam engine)
- Waiting list without automatic ranking
- Offers (no payments/deposits)
- `POST /api/v1/admissions/applications/{id}/enrol` — idempotent conversion
- Permissions: `admissions.read`, `admissions.enquiries.manage`, `admissions.applications.manage`, `admissions.offers.manage`, `admissions.decide`, `admissions.convert`
- In-app notifications for a few events when the contact already has a user identity

**Not in Phase 4:** attendance, LMS, results, AI, payments, document binaries, ranking algorithms, email/SMS/push. Public website forms are Phase 9.

## Phase 5 — SaaS tenant routing, school subdomains, and onboarding foundation (implemented)

**Outcome:** the same application can serve the platform apex and per-school subdomains without weakening Phase 1–4 isolation.

- Unique DNS-safe organisation slugs; reserved platform names blocked
- Central hostname → organisation resolver; header mismatch fails closed
- Root/platform host does not auto-select a school
- Internal transactional onboarding (`provision_organisation`); public signup disabled
- School-aware login branding (display only, not authority)
- Local development via `*.localhost` and `PLATFORM_DOMAIN`
- Custom-domain data model with verification/activation; unverified hostnames never resolve

**Not in Phase 5:** production wildcard DNS/TLS, automated certificate provisioning, public self-service signup, billing collection.

## Phase 6 — Attendance and student record (implemented)

**Outcome:** a school can take AM/PM (configurable) registers, correct marks with an audit trail, view pupil attendance history with a defined percentage, and configure student-portal access without treating the student record as a login account.

- Configurable attendance sessions (default AM/PM) and attendance codes (`present`, `late`, `authorised`, `unauthorised`, `not_required`, plus extra codes later)
- One mark per organisation + pupil + date + session; revisions + `audit_events` on change
- Teacher register: assigned classes only; Mark all present + exceptions; idempotent PUT
- School Admin / Headteacher school-wide view, filter, and permission-controlled correction
- Parent/student attendance visibility on existing portal APIs (no internal notes)
- Student record profile: identity, current year/class (derived), enrolment/class history, guardians, attendance summary/history, portal status
- Student portal policy: school default + year-group overrides in School Admin; class/pupil override schema/API reserved
- Document **metadata** + storage port; no binaries in PostgreSQL; parent visibility explicit
- Navigation: Attendance section; parent-section vs active-child styling

**Not in Phase 6:** DfE census rules, binary document upload/S3 adapter choice, class/pupil portal override UI, announcements product, younger-child QR/PIN/games, UI design system.

## Phase 7 — LMS core (implemented)

**Outcome:** a teacher can create, target, publish, and mark learning work; pupils and authorised parents see the appropriate status and released feedback.

- Canonical `learning_assignments` with work types (not homework-only) and no single `class_id`
- Targets (class / year-group / selected pupils) plus a recipient snapshot that survives later class moves
- Teacher UI: My Teaching, Assignments, Submissions / Marking; assigned-only for Teacher
- Student My Learning (assigned, due, submitted, feedback) on the Phase 6 school-scoped student login
- Parent child Learning (status + released marks only; no submit)
- Student Record Learning history for authorised staff
- In-app notifications (`learning_assigned`, `learning_due`, `learning_feedback`, `learning_resubmission`) with idempotency keys
- Resource URL metadata + storage-port key builders; binary upload deferred

**Not in Phase 7:** formal assessment/report cards, rubrics, AI generation, games/XP, chat, video, S3 binary adapter, UI redesign.

## Phase 8 — Assessments, results, progress & reports (implemented)

**Outcome:** a school can define formal assessments, enter and review results, set modest academic targets, and publish progress reports. Parents and pupils see only released/published items.

- Formal `academic_assessments` (not LMS marks, not admissions interviews) with an extensible type catalogue
- Class/year inclusions snapshot; teacher assigned-only result entry
- Configurable grade/attainment schemes (percentage, letter, numeric, judgements, school-defined)
- Reporting periods per academic year (not assumed to be three terms)
- Result history/revisions; independent `released_to_student` / `released_to_parent`
- Lightweight review (`entered` / `reviewed` / `approved`) and assessment lifecycle `draft → open → completed → reviewed → published → archived` (review can be skipped)
- Student progress as latest vs previous comparable result — no opaque AI score
- Progress reports with subject sections, optional approval, and frozen publication snapshots
- Parent/student portal visibility and Student Record academic history

**Not in Phase 8:** AI report drafting/grading, PDF export, DfE census, behaviour, competitions, professional UI redesign.

## Phase 9 — Admissions forms, public applications & embeds (implemented)

**Outcome:** a School Admin configures public enquiry/application forms, shares or embeds them, and parent submissions enter the existing admissions workflow.

- Controlled form builder (sections, canonical fields, custom questions)
- Public hostname-bound URLs and secure iframe embeds
- QR codes encoding only the public URL
- Source/campaign tracking and simple counts
- Completeness status separate from admissions decisions
- Declaration snapshots; medical/additional needs with stricter permissions
- Document metadata via the existing storage port (binaries deferred)
- Rate limiting + captcha port (default `none`)

**Not in Phase 9:** application fees, CRM/email marketing, social-network APIs, AI scoring, JS embed SDK, production object storage.

## Phase 10 — Communications, announcements, and school calendar (implemented)

**Outcome:** staff can publish targeted announcements and calendar events; parents and students see only authorised items; read/acknowledgement state is per recipient.

- Canonical announcements (`draft / scheduled / published / expired / archived`) with priority, pin, expiry, optional acknowledgement
- Target model (whole school, staff, parents, students, year groups, classes, selected pupils/staff) plus publish-time recipient snapshot
- School event catalogue and calendar with the same targeting/visibility rules
- Parent Notices + family calendar; student Notices + own calendar
- In-app notifications (`announcement_published`, `announcement_important`, `announcement_acknowledgement`, `calendar_upcoming`) with idempotency
- Request-time activation for scheduled rows (no job queue)

**Not in Phase 10:** live chat, private messaging, email/SMS/push, WhatsApp, marketing automation, video calls, binary object storage.

## Phase 11 — Behaviour, pastoral and safeguarding foundation (implemented)

**Outcome:** staff can record behaviour incidents and achievements, raise pastoral concerns with interventions, and record safeguarding concerns with a chronology. Safeguarding is a separate, stricter permission set and never appears on ordinary student-record or parent/student APIs.

- Controlled catalogues for incident, action, positive, pastoral, and safeguarding categories
- Behaviour incidents with related pupils, witnesses, actions/consequences, revisions, and conservative parent/student visibility flags
- Positive behaviour / achievements kept separate from incidents (no XP/leaderboards)
- Pastoral concerns distinct from behaviour, with interventions and optional attendance references (no duplicated marks)
- Safeguarding concerns + append-only chronology + restricted attachment metadata
- Capability-based access; teachers remain assigned-only for behaviour; no automatic pastoral/safeguarding for teachers
- Staff UI: Pastoral & Behaviour, plus a separate Safeguarding area
- In-app assignment/follow-up notifications without sensitive narrative

**Not in Phase 11:** AI risk scoring, external safeguarding-agency integrations, statutory exclusion workflow, behaviour gamification, parent-teacher chat, email/SMS/push.

## Phase 12 — Timetable, lessons, rooms, and school-day scheduling (implemented)

**Outcome:** a school can configure its school day and rooms, schedule recurring class/subject lessons, resolve occurrences from definitions plus exceptions, and show authorised staff, pupils, and parents the right timetable. Attendance and calendar are integrated without being duplicated.

- School-day profiles and configurable periods (teaching, registration, break, lunch, assembly, other), including different weekday structures
- Organisation room/location catalogue (room optional on a slot)
- Recurring `timetable_entries` with effective dates, optional term, multiple participating teachers
- Date-specific exceptions and teacher cover that do not rewrite permanent history
- Conflict detection (teacher / class / room) using actual times, enforced in the database
- Teacher My Timetable + dashboard lessons; Take attendance identifies the existing Phase 6 register
- Student and parent timetable views scoped to enrolment / guardianship + `portal_access`
- Calendar views may list lessons separately (`source: timetable`); lessons are not copied into `school_events`

**Not in Phase 12:** AI timetable generation, drag-and-drop optimiser, government holiday engine, payroll, professional UI redesign.

## Phase 13 — Production file storage, documents, and uploads (implemented)

**Outcome:** existing Schoolapp document workflows store and retrieve real file bytes through one private object-storage layer.

- Filesystem adapter for local/demo; S3-compatible adapter for production
- Authorised server upload + application-authorised proxy download
- Admissions, pupil documents, LMS resources, submission attachments, pastoral and safeguarding files
- Size/type validation, filename sanitisation, checksums, scanning port (`unscanned` unless a scanner is configured)
- Orphan cleanup command; no legal retention engine in this phase

**Not in Phase 13:** OCR, AI extraction, e-signatures, Drive clone, teacher annotation editor, professional UI redesign.

## Phase 14 — Trips, clubs, consents, and parent responses (implemented)

**Outcome:** a reusable school-activities workflow that connects existing portals, calendar, notifications, and Phase 13 files.

- Canonical `school_activities` (not a second `school_events` table)
- Targeting vs eligibility snapshot vs participants
- Explicit parent consent with wording/version snapshot; staff-offline consent cannot spoof a guardian
- Optional capacity, waiting list, and transaction-safe last-place allocation
- Assigned activity staff; limited live medical/emergency summary (no stored snapshot, no safeguarding)
- Parent and student Activities areas; calendar `source: activity`
- Recurring clubs via weekday + until date; no payment processing

**Not in Phase 14:** Stripe/fees, SMS/email delivery, timetable auto-exceptions, statutory attendance mapping, full risk-assessment product, professional UI redesign.

## Phase 15 — Payments, fees, and parent payment foundation (implemented)

**Outcome:** a school can issue pupil charges, parents can pay through a provider-neutral checkout, and staff can reconcile outstanding/paid/refunded items without a general ledger.

- Integer minor-unit money + ISO currency; charge vs transaction vs receipt vs refund kept separate
- Organisation charge catalogue; individual and idempotent bulk pupil charges
- Activity payment fields and `charge_policy` (default: charge on confirmed place; waitlist not charged)
- `PaymentProvider` port, fake/demo provider, optional Stripe Checkout adapter
- Signed webhook authority, replay-safe event ids, tenant resolved from stored provider references
- Parent Payments area, HTML receipts, offline staff-recorded payments, waivers/refunds
- Capability RBAC (`finance.*`); teachers see operational payment status only; students do not pay

**Not in Phase 15:** accounting ledger, VAT, payroll, Stripe Connect, instalment plans, meal ordering, admissions fees, SMS/email delivery, professional UI redesign.

## Phase 16 — Messaging and parent–teacher communication (implemented)

**Outcome:** staff and parents can hold authorised, pupil-scoped conversations in-app without duplicating announcements or opening a social graph.

- Conversation + explicit participant model (`parent_teacher`, `parent_school`, `admissions`, `staff_internal`)
- Teacher assigned-only initiation; parent contact points (class teacher, school office, admissions)
- Read/unread pointers, close/archive, moderation redaction, Phase 13 attachments
- Parent Portal and staff Messages inboxes (functional UI)
- In-app notifications only; no email/SMS/push, no student messaging, no WebSockets

**Not in Phase 16:** WhatsApp/SMS/email delivery, live chat, typing indicators, student–teacher chat, AI moderation, bulk export, professional UI redesign.

## Phase 17 — Professional UI design system and role-based dashboards (implemented)

**Outcome:** Schoolapp looks and behaves like a professional school MIS/LMS while preserving Phase 1–16 business logic, RBAC, routing, and tenant isolation.

- Design tokens and shared primitives (AppShell, PageHeader, cards, tables, filters, badges, empty/loading/error states, confirmation dialogs)
- Staff, parent, and student shells with grouped, permission-filtered navigation and a responsive drawer
- Role-aware dashboards composed from existing APIs (operational vs assigned-only teacher)
- Visual polish for high-traffic admissions, attendance, timetable, LMS, finance, messaging, and portal pages
- No database migration (`0032_phase16_messaging.sql` remains latest)

**Not in Phase 17:** dark mode, drag-and-drop timetable, new business workflows, AI, gamification, SMS/email/push, native apps.

## Phase 18 — UK statutory data, School Census readiness and data exports (implemented)

**Outcome:** School Admin can maintain statutory school/pupil fields, see data-quality issues on canonical records, snapshot a census date, validate, and export census-ready files. Schoolapp is **not** a DfE COLLECT submission product.

- School statutory profile (`/school/settings/statutory`) and pupil statutory section (permission-gated)
- Versioned platform code sets (ethnicity, language, enrolment, SEND provision, leaving reason, school phase/type/status)
- Data-quality centre and census workspace with draft → validating → ready → exported / superseded / archived
- Immutable, versioned snapshots of census-relevant values (not medical/safeguarding/messaging)
- Shared on-roll helpers; attendance summaries reuse Phase 6 marks and `statutory_category`
- Pupil roll, attendance, admissions, SEND, and census CSV/XML preview exports with injection protection and audit
- Capability keys: `statutory.*`, `reports.pupils.read`, `reports.attendance.read`, `reports.admissions.read`, `reports.send.read`, `reports.exports.create`, `pupils.statutory.*`

**Not in Phase 18:** live DfE submission, COLLECT credentials, certification claims, payroll/HR returns, funding engine, LA integrations, meal/library/transport, AI census corrections, arbitrary report builders.

## Phase 19 — Student engagement, rewards, competitions, and early learning (implemented)

**Outcome:** schools can recognise pupils, run house/class competitions with privacy controls, and assign deterministic early-learning / practice activities. This is not a social network and does not generate questions with AI.

- Organisation engagement settings plus year-group overlays; Student Portal on/off stays Phase 6 policy
- Reward catalogue and teacher/admin awarding (assigned-only for teachers); revoke/correct rather than silent delete
- XP ledger separate from reward points; idempotent grants; no shop
- Achievement definitions with controlled criteria; unique awards unless the definition allows repeats
- Competitions with targeting, scoring models, and frozen results on complete
- Leaderboards default off; house/class preferred; individual names follow display-name policy
- Early-learning activity catalogue (counting, letters, phonics, addition, spelling, challenges) with server scoring
- Parent-assisted channel when year-group policy allows; parent does not impersonate the student
- Staff `/school/engagement`, student Play & learn / Rewards / Competitions, parent child Rewards
- Capability keys: `engagement.settings.*`, `rewards.*`, `achievements.*`, `competitions.*`, `learning.practice.*`

**Not in Phase 19:** AI tutoring or question generation, essay grading, student-to-student chat, virtual currency, loot boxes, public worldwide leaderboards, live multiplayer, sockets, native apps.

## Pupil medication and dietary requirements (implemented)

**Outcome:** School Admin maintains structured medication and dietary records on the canonical pupil record. Teachers see operational fields for assigned pupils. Parents may read parent-visible records for authorised children. Student Portal does not automatically show medication administration. See [ADR 0029](./adr/0029-pupil-medication-dietary.md).

- Multiple `student_medications` / `student_dietary_requirements` rows per pupil
- Stop/change preserves history via status + `ended_on` + revision snapshots
- Pupil Record **Medication & dietary** tab (hashes `#health`, `#medication`, `#dietary`); Parent Portal parent-visible lists
- Live activity/trip safety summaries reuse active canonical rows
- FORCE RLS, actor stamps, guardianship + `portal_access` recheck, no clinical text in audit payloads
- Capability keys: existing `students.additional_needs.*` plus `students.medications.read_operational`, `students.dietary.read_operational`, `students.medications.read_own_children`, `students.dietary.read_own_children`

**Not in this work:** safeguarding mixing, student self-service medication administration, stored trip medical snapshots, parent write-back.

## Phase 12.5 — AI learning (future)

- `packages/ai` port + one provider
- Activity drafts into the Phase 19 item schema, moderation hook, teacher approval workflow
- Generation audit (no PII in prompts)
- Always start as `draft`; no auto-publish

## Phase 13 — Remaining gamification (future)

- Optional non-punitive streaks
- Richer badge artwork
- Inter-school competitions remain unimplemented (network tables are governance placeholders)

## Phase 14 — Mobile clients

(Product numbering in this later-vision list is independent of the implemented Phase 14 activities/consent work above.)

- Expo app: **parent** first (read-mostly)
- Then **student** (attempts, homework submit if API already exists)
- Optional **teacher** (registers, marking) only after staff API is stable
- PKCE auth, secure token storage, `X-Organisation-Id`, push tokens

No second backend.

## Phase 17 — Integrations and hardening

(Product numbering in this later-vision list is independent of the implemented Phase 17 UI design-system work above.)

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
