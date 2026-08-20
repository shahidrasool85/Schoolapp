# Architecture Decision Records

ADRs capture *why* we chose an approach. The narrative proposal is in [ARCHITECTURE.md](../ARCHITECTURE.md).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-modular-monolith-api-first.md) | Modular monolith, API-first, TypeScript monorepo | Proposed |
| [0002](./0002-shared-schema-rls-tenancy.md) | Shared-schema multi-tenancy with RLS | Proposed |
| [0003](./0003-global-identity-org-memberships.md) | Global identity with per-organisation memberships | Proposed |
| [0004](./0004-rbac-permission-catalogue.md) | RBAC with an extensible permission catalogue | Proposed |
| [0005](./0005-auth-and-supabase-as-adapter.md) | Auth via adapter; Supabase/GoTrue optional | Proposed |
| [0006](./0006-postgres-drizzle-s3.md) | PostgreSQL + Drizzle + S3-compatible files | Proposed |
| [0007](./0007-ai-provider-port.md) | AI provider port and human approval | Proposed |
| [0008](./0008-self-host-and-no-edge-lockin.md) | Self-hostable Linux deployment; avoid Edge lock-in | Proposed |

Convention: one decision per file. If a decision is reversed, mark it **Superseded** and add a new ADR — do not silently edit history.
