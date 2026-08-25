# Architecture Decision Records

ADRs capture *why* we chose an approach. The narrative proposal is in [ARCHITECTURE.md](../ARCHITECTURE.md).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-modular-monolith-api-first.md) | Modular monolith, API-first, TypeScript monorepo | Accepted |
| [0002](./0002-shared-schema-rls-tenancy.md) | Shared-schema multi-tenancy with RLS (transaction-local context, FORCE RLS, mandatory tests) | Accepted (amended) |
| [0003](./0003-global-identity-org-memberships.md) | Global identity with per-organisation memberships | Accepted |
| [0004](./0004-rbac-permission-catalogue.md) | RBAC with an extensible permission catalogue | Accepted |
| [0005](./0005-auth-and-supabase-as-adapter.md) | Auth via adapter; Supabase/GoTrue optional | Accepted |
| [0006](./0006-postgres-drizzle-s3.md) | PostgreSQL + Drizzle + S3-compatible files (MinIO not required) | Accepted (amended) |
| [0007](./0007-ai-provider-port.md) | AI provider port and human approval | Accepted |
| [0008](./0008-self-host-and-no-edge-lockin.md) | Self-hostable Linux deployment; avoid Edge lock-in | Accepted (amended) |
| [0009](./0009-academic-year-scoped-enrolments.md) | Academic year–scoped enrolments and class memberships | Accepted |
| [0010](./0010-formal-audit-vs-application-logging.md) | Formal audit history vs application logging | Accepted |
| [0011](./0011-product-owner-phase-1-decisions.md) | Product-owner Phase 1 decisions | Accepted |
| [0012](./0012-in-app-notifications.md) | In-app notifications are per-recipient and organisation-scoped | Accepted |
| [0013](./0013-admissions-conversion.md) | Admissions workflow and applicant-to-student conversion | Accepted |
| [0014](./0014-saas-hostname-tenancy.md) | SaaS hostname tenancy, school slugs, and custom-domain foundation | Accepted |
| [0015](./0015-attendance-student-portal-documents.md) | Attendance marks, student portal policy, and document metadata | Accepted |
| [0016](./0016-phase7-learning-lms.md) | Teaching & Learning / LMS core (assignments, targets, submissions, marks) | Accepted |
| [0017](./0017-phase8-assessment-results.md) | Formal assessments, results, reporting periods, and progress reports | Accepted |
| [0018](./0018-phase9-public-admissions-forms.md) | Public admissions forms, embeds, and draft tokens | Accepted |
| [0019](./0019-phase10-communications-calendar.md) | Announcements, targeting, and school calendar | Accepted |
| [0020](./0020-phase11-behaviour-pastoral-safeguarding.md) | Behaviour, pastoral, and safeguarding foundation | Accepted |
| [0021](./0021-phase12-timetable-scheduling.md) | Recurring timetable definitions and date-specific exceptions | Accepted |
| [0022](./0022-phase13-object-storage.md) | Production object storage, private files, and authorised downloads | Accepted |
| [0023](./0023-phase14-activities-consents.md) | School activities, consents, and parent responses | Accepted |
| [0024](./0024-phase15-payments.md) | School charges, provider-neutral payments, and webhook authority | Accepted |
| [0025](./0025-phase16-messaging.md) | School messaging vs announcements, explicit participants, current-access rules | Accepted |
| [0026](./0026-phase17-ui.md) | Professional UI design system and role-based dashboards | Accepted |
| [0027](./0027-phase18-statutory-census.md) | Live canonical records vs census snapshots, versioned code sets, census-ready exports | Accepted |
| [0028](./0028-phase19-engagement.md) | Rewards vs behaviour, XP vs points, leaderboard privacy, practice vs assessment, parent-assisted learning, server scoring | Accepted |

Convention: one decision per file. If a decision is reversed, mark it **Superseded** and add a new ADR — do not silently edit history.
