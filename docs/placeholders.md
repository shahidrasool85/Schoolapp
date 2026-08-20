# Architectural placeholders (not implemented)

These entities are **reserved in the foundation schema** so Phase 1 does not paint us into a corner. **No application behaviour, UI, billing integration, or notification delivery is built in this phase.**

| Placeholder | Purpose | What is deferred |
| --- | --- | --- |
| `organisation_identifiers` | School URN, DfE number, Companies House, admissions codes | Validation, uniqueness across the platform, MIS sync |
| `organisation_settings` | Typed school settings (timezone already on org; calendar, locale, branding later) | Settings UI beyond what Phase 1 needs to provision a school |
| `organisation_feature_flags` | Per-school flags (leaderboards, AI, student login, auto-publish) | Flag admin UX; evaluation lives in core once modules exist |
| `terms` / `half_terms` | UK academic calendar | Calendar admin UI; attendance/LMS will consume them from Phase 5+ |
| `notification_preferences` | Per-user, per-org, per-channel, per-category opt-in/out | Email/push workers, templates, Children’s Code marketing rules enforcement in code |
| `guardianships` extras | Parental responsibility, emergency contact, restricted-contact flag | Court-order workflows, pickup permissions, multi-household rules beyond the columns |
| `billing_accounts` / `organisation_subscriptions` | SaaS commercial boundary (who pays, plan, status, licensed seats) | Payments, invoices, dunning, usage metering |
| `inter_school_competition_networks` (+ members) | Future governance for school-vs-school competitions | Any cross-tenant pupil data path, scoring, leaderboards across schools |

**Hard rule:** placeholder tables must not be used to JOIN pupil or learning data across `organisation_id`. Inter-school competition rows are governance metadata only until a dedicated ADR and DPIA land.

See [schema/001_foundation.sql](./schema/001_foundation.sql) for column-level comments.
