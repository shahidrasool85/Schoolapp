# Architectural placeholders (not implemented)

The in-app `notifications` inbox is implemented in Phase 3. `notification_preferences` remains the delivery-channel placeholder only.

| Placeholder | Purpose | What is deferred |
| --- | --- | --- |
| `organisation_hostnames` | Future custom school domains (verification token + activation) | Automated DNS/TXT checks, certificate provisioning |
| `organisation_identifiers` | School URN, DfE number, Companies House, admissions codes | Platform-wide uniqueness and MIS sync. Phase 18 stores tenant-scoped census identifiers on `organisation_statutory_profiles` (synthetic demo values only). |
| `organisation_settings` | Typed school settings (timezone, locale, contact, branding colours, logo/hero object ids) | Production mail delivery adapters beyond the inspectable outbox; custom-domain TLS. Login, staff, parent and student shells consume display-only branding from `GET /api/v1/public/tenant` with professional fallbacks. |
| `organisation_feature_flags` | Per-school flags (leaderboards, AI, student login, auto-publish) | Flag admin UX; evaluation lives in core once modules exist |
| `terms` / `half_terms` | UK academic calendar | Calendar admin UI; attendance already records against academic year dates |
| `notification_preferences` | Per-user, per-org, per-channel, per-category opt-in/out | Email/push workers, templates, Children’s Code marketing rules enforcement in code |
| `guardianships` extras | Parental responsibility, emergency contact, restricted-contact flag | Court-order workflows, pickup permissions, multi-household rules beyond the columns |
| `billing_accounts` / `organisation_subscriptions` | SaaS commercial boundary (who pays Schoolapp, plan, status, licensed seats) | Platform invoices, dunning, usage metering. Distinct from Phase 15 school-to-parent charges. |
| `inter_school_competition_networks` (+ members) | Future governance for school-vs-school competitions | Any cross-tenant pupil data path, scoring, leaderboards across schools |

**Hard rule:** placeholder tables must not be used to JOIN pupil or learning data across `organisation_id`. Inter-school competition rows are governance metadata only until a dedicated ADR and DPIA land.

See [schema/001_foundation.sql](./schema/001_foundation.sql) for column-level comments.
