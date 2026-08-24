# ADR 0022: Production object storage for Schoolapp documents

**Status:** Accepted  
**Date:** 2026-08-24

## Context

Phases 6–11 modelled document metadata (admissions files, pupil records, LMS resources, submission attachments, pastoral and safeguarding attachments) behind `@schoolapp/storage`, but the only adapter was `UnconfiguredObjectStorage`. Schools could record filenames, not store or download bytes.

ADR 0006 already chose PostgreSQL as the system of record and an S3-compatible file port. This ADR records the Phase 13 implementation choices: a single shared storage architecture, local filesystem development, authorised proxy downloads, and a scanning extension point.

## Decision

### One storage system

All Schoolapp files use one port (`ObjectStoragePort`) and one metadata table (`stored_objects`). Domain tables keep their existing rows and gain a `stored_object_id` link. There is no per-module bucket/SDK.

### Adapters

| Driver | Use |
| --- | --- |
| `filesystem` | Local demo and development. Root directory from `OBJECT_STORAGE_FS_ROOT`. Default for `pnpm demo:setup`. |
| `s3` | Production. Any S3-compatible API (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, and similar) via endpoint, region, bucket, keys, and optional path-style. |
| `unconfigured` | Explicit fallback that refuses writes. |

Application code never calls the AWS SDK. Provider logic stays in `packages/storage`.

### Private objects and proxy downloads

Objects are private. Business records store object ids and keys, not public bucket URLs.

Upload is **authorised server multipart**: the client sends bytes to Schoolapp; Schoolapp validates tenant, capability, owner record, type, and size; then writes to storage and activates metadata.

Download is **application-authorised proxy streaming** (`GET /api/v1/files/:storedObjectId`). Schoolapp re-checks tenant, membership, domain permission, guardianship/`portal_access`, student-portal policy, and safeguarding capabilities on every request, then streams bytes. Unauthorised callers receive a non-enumerating `404`.

The S3 adapter can mint short-lived signed GET/PUT URLs for tests and future direct-to-bucket flows. Schoolapp does not use browser-to-S3 uploads in this phase, so production CORS for PUT is not required. Filesystem has no signed URLs.

Safeguarding (and other highly sensitive) files are always proxied, never handed out as long-lived public URLs. Signed URL sharing, if used later, cannot be revoked before expiry; keep TTL short (default 60s) and re-check authorisation before issuing.

### Object keys

Keys are tenant-aware UUIDs:

`org/{organisationId}/{domain-path}/{ownerId}/{objectId}`

Original filenames are metadata only. Keys must not contain pupil names, medical/safeguarding text, emails, or other PII.

### Lifecycle

`pending` → `active` | `rejected`. Soft-delete sets `deleted`. Postgres and object storage are not one transaction: a failed provider write deletes the blob when possible and leaves the row `rejected` (public admissions also soft-deletes the document row) so `pnpm storage:cleanup` can finish later. Authenticated uploads also delete the blob if the surrounding tenant transaction is about to roll back. A process crash after the bytes are written but before commit can leave an unreferenced object. It **never** auto-hard-deletes safeguarding objects.

Public application file answers are bound at submit time: a client-supplied `documentId` must belong to the current draft, match the file field, and point at an active stored object. Filename-only metadata does not count as an uploaded document.

Retention policy engines, legal holds, and billing quotas are out of scope. `organisation_storage_usage` exists for future school-level totals.

### Scanning

`FileScanner` is a port. `NoopFileScanner` is the demo default and records `scan_status = unscanned`. It must not claim files are malware-clean. A future ClamAV/managed adapter can mark `clean` or `rejected`.

### Sensitivity

`standard` | `confidential` | `safeguarding`. Safeguarding and pastoral files remain distinguishable from ordinary learning documents. Classification is not shown to unauthorised users.

### What this phase does not add

Teacher feedback/annotation files, communications/academic-report binaries, OCR, AI extraction, e-signatures, a generic Drive clone, antivirus in production, or a professional UI redesign.

## Consequences

- Local demo needs no cloud account.
- CI tests the S3 adapter with an in-process double, not live AWS.
- Download authorisation is an application concern; S3/RLS cannot see Schoolapp RBAC.
- Existing metadata-only JSON creates remain for backward compatibility; multipart uploads store real bytes.
