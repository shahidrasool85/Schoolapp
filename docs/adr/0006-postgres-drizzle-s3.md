# ADR 0006: PostgreSQL + Drizzle + S3-compatible file storage

**Status:** Proposed  
**Date:** 2026-08-20

## Context

The system of record must be portable to managed Postgres (including Supabase) and to a VM. File uploads (admissions documents, homework) must work in both environments.

## Decision

- **PostgreSQL 16+** is the only system of record.
- **Drizzle ORM** plus versioned SQL for RLS, functions, and indexes (SQL-first where it is clearer).
- Files stored in **S3-compatible** object storage via `packages/storage`. Local/MinIO for self-host; any S3 in cloud.
- Metadata (owner, organisation, virus-scan status, retention) stays in Postgres.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Prisma as the abstraction | Weaker RLS/migration story for policies; more magic; Accelerate would lock hosting |
| MongoDB | Poor fit for relational school data and RLS isolation |
| Supabase Storage SDK in feature code | Ties modules to one vendor |
| Files on the Plesk filesystem only | Breaks multiple app instances and backups |

## Consequences

- Developers need Docker or a local Postgres; schema is reviewed as SQL.
- Large files never live in Postgres; signed upload/download URLs are issued by the API.
