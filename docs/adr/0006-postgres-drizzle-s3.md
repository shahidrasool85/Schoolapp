# ADR 0006: PostgreSQL + Drizzle + S3-compatible file storage

**Status:** Accepted (amended 2026-08-20; amended 2026-08-24 by [ADR 0022](./0022-phase13-object-storage.md))  
**Date:** 2026-08-20

## Context

The system of record must be portable to managed Postgres (including Supabase) and to a VM. File uploads (admissions documents, homework) must work with whatever object store the operator provides. Self-hosting must not require a specific storage product.

## Decision

- **PostgreSQL 16+** is the only system of record.
- **Drizzle ORM** plus versioned SQL for RLS, functions, and indexes (SQL-first where it is clearer).
- Files are accessed only through **`packages/storage` (S3-compatible API: bucket, key, signed upload/download)**.
- **MinIO is not required.** The same application must work with:
  - managed S3-compatible storage (Amazon S3, Cloudflare R2, Backblaze B2, GCS S3 interop, Supabase Storage if S3-compatible, and similar)
  - operator-provided self-hosted S3-compatible storage (MinIO is one option, not the architecture)
  - a local/dev adapter for single-node development if desired
- Object keys and metadata (owner, organisation, content type, virus-scan status, retention) stay in Postgres. The app never embeds long-lived storage credentials in web or mobile clients.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Prisma as the abstraction | Weaker RLS/migration story for policies; more magic; Accelerate would lock hosting |
| MongoDB | Poor fit for relational school data and RLS isolation |
| Supabase Storage SDK in feature code | Ties modules to one vendor |
| Files on the Plesk filesystem only | Breaks multiple app instances and backups |
| Require MinIO in Docker Compose for all environments | Forces a self-host component schools/operators may not want |

## Consequences

- Configuration is endpoint, region, bucket, and credentials — not a hard-coded vendor SDK in domain code.
- Reference `docker-compose` may omit object storage entirely and point at a managed bucket.
- Large files never live in Postgres. Phase 13 stores bytes in a filesystem or S3-compatible adapter and serves them through authorised API proxy downloads ([ADR 0022](./0022-phase13-object-storage.md)). The S3 adapter can issue short-lived signed URLs; Schoolapp does not treat public bucket URLs as the access mechanism.
