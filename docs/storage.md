# Object storage, documents, and uploads

Phase 13 stores real file bytes for Schoolapp workflows that already had document metadata. This is not a generic Drive product.

See [ADR 0022](./adr/0022-phase13-object-storage.md) for the decision record.

## Architecture

- Port: `packages/storage` (`ObjectStoragePort`)
- Metadata: `stored_objects` (FORCE RLS) linked from existing domain tables
- Upload: authorised client → Schoolapp multipart → validate → put object → activate row
- Download: `GET /api/v1/files/:storedObjectId` after live permission checks, then proxy stream
- Objects are private. Do not store public bucket URLs on business records.

Postgres and the object store are not one transaction. Failed writes delete the blob when possible and mark the row `rejected` (public admissions also soft-delete the document metadata). Authenticated uploads also delete the blob if the surrounding database transaction is about to roll back. `pnpm storage:cleanup` removes expired pending objects and old rejected/deleted bytes. It never auto-deletes safeguarding objects. A process crash after the bytes are written but before the database commit can leave an unreferenced object; that remains a known compensation gap.

Public admissions file fields must reference a document id issued for that draft. A guessed UUID or filename-only metadata cannot mark an application complete.

## Local development / demo

`pnpm demo:setup` defaults to the filesystem driver. No cloud account is required.

```bash
OBJECT_STORAGE_DRIVER=filesystem
OBJECT_STORAGE_FS_ROOT=.data/object-storage
FILE_SCANNER_DRIVER=noop
```

That relative root is for development only. Production cannot use it.

The demo scanner records `unscanned`. It does not claim files are malware-clean.

Maintenance:

```bash
pnpm storage:cleanup
pnpm storage:cleanup -- --dry-run
```

## Production (S3-compatible)

Works with AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, and other S3 APIs.

```bash
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_S3_ENDPOINT=https://s3.eu-west-2.amazonaws.com
OBJECT_STORAGE_S3_REGION=eu-west-2
OBJECT_STORAGE_S3_BUCKET=your-private-bucket
OBJECT_STORAGE_S3_ACCESS_KEY=
OBJECT_STORAGE_S3_SECRET_KEY=
OBJECT_STORAGE_S3_FORCE_PATH_STYLE=false
OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS=60
```

Keep the bucket private. Schoolapp uploads go through the API, so you do not need wildcard browser-to-bucket CORS for this phase. If you later enable direct presigned browser uploads, restrict CORS to the school origin and the methods you actually use.

Never commit credentials. Never log access keys, secret keys, or object payloads.

Diagnostic: `GET /api/v1/health/storage` returns `{ configured, driver, writable }` with no secrets.

## Size limits (defaults)

| Profile | Default |
| --- | --- |
| Admissions (public and staff) | 8 MiB |
| Pupil documents | 10 MiB |
| Learning resources | 20 MiB |
| Learning submissions | 20 MiB |
| Pastoral | 10 MiB |
| Safeguarding | 15 MiB |
| Activity documents | 10 MiB |
| Profile photos | 2 MiB |

Override with `OBJECT_STORAGE_MAX_BYTES_*` (profile photos: `OBJECT_STORAGE_MAX_BYTES_PROFILE_PHOTO`). Oversized uploads return a user-facing “file too large” error, not a provider stack.

## Accepted types

Validated from extension, declared MIME type, and magic bytes. Executables, HTML, JavaScript, and SVG are blocked.

| Area | Allowed |
| --- | --- |
| Admissions | PDF, JPEG, PNG, WebP, DOCX |
| Pupil documents | PDF, JPEG, PNG, WebP, DOC/DOCX, XLS/XLSX, text |
| Learning | PDF, JPEG, PNG, WebP, DOCX, XLSX, text |
| Pastoral / safeguarding | PDF, JPEG, PNG, WebP, DOCX |
| Activity documents | PDF, JPEG, PNG, WebP, DOCX, XLSX, text |
| Message attachments | PDF, JPEG, PNG, WebP, DOCX, text |
| Profile photos | JPEG, PNG, WebP only; 32×32–4096×4096 pixels |

Original filenames are sanitised for display. They are never used as filesystem paths or object keys.

## Profile photos

One current photo per person-in-school. Metadata: `organisation_memberships.profile_photo_stored_object_id` → `stored_objects` (`domain = profile_photo`, `owner_record_id` = user id). Key path: `org/{organisationId}/profiles/photos/{userId}/{objectId}`.

Downloads use the same authorised proxy as other files (`GET /api/v1/files/:storedObjectId`). There is no public profile-photo URL. Public admissions and branding endpoints cannot serve user photos. Replacing a photo points the membership at the new object and retires the previous one.

### Filesystem / Plesk persistence

The filesystem adapter writes under `OBJECT_STORAGE_FS_ROOT`.

**Development / test:** a relative root such as `.data/object-storage` is fine. If the variable is unset, the adapter uses a local temp directory for convenience. That default is **not** used in production.

**Production (`NODE_ENV=production`) + `OBJECT_STORAGE_DRIVER=filesystem`:**

- `OBJECT_STORAGE_FS_ROOT` must be set to an **absolute** persistent path.
- The process refuses to start (clear configuration error, no secrets) if the root is missing, blank, relative, under `/tmp` / `/var/tmp` / the OS temp directory, or inside the application/deploy working directory (including the monorepo root found by walking up from `cwd`).
- Do not point it at `.next`, `public`, or any directory replaced by Git deployment.

On the current Plesk server, choose a persistent location **outside**:

`/var/www/vhosts/app.luvlearn.co.uk/httpdocs`

Plesk Git deployment replaces that `httpdocs` tree. Application code does not hardcode the production path; set `OBJECT_STORAGE_FS_ROOT` on the host.

This phase does **not** require AWS/S3. If production already uses the S3 adapter, profile photos use that same private bucket.

## Download authorisation

Re-checked on every download:

- Tenant + active membership
- Domain capability (documents, admissions, LMS, pastoral, safeguarding)
- Teacher assigned-only student access where that is the existing rule
- Parent: guardianship + `portal_access` + parent-visible flag
- Student: current enrolment + Student Portal policy + self-visible flag
- Activity files: staff assignment or school-wide activity read; parent/student visibility flags; eligible child/self only
- Profile photos: same organisation + live person permission (self; staff directory for staff photos; existing pupil-profile rules for students; guardian-manage/member-read for parent photos). Unauthenticated and cross-tenant requests get `404`
- Safeguarding: safeguarding capabilities only. Ordinary Teacher, Parent, Student, and unaffiliated Platform Admin get `404`. Object id or key is never enough.

Sensitive responses use `Cache-Control: private, no-store`. HTML/JS/SVG are not served inline. Safeguarding downloads are attachments.

## Known limitations

- Signed URLs, if issued later, cannot be revoked before expiry. Prefer proxy downloads for safeguarding.
- Noop scanner: files are `unscanned`, not `clean`.
- No legal retention engine. Submitted admissions, pupil, pastoral, and safeguarding records are kept; only abandoned pending/rejected/deleted non-safeguarding objects are cleaned.
- Teacher feedback attachments, communications binaries, OCR, previews, thumbnails, AI extraction, e-signatures, and quotas/billing are deferred.
- Cross-tenant content-addressed deduplication is intentionally not implemented.

## Test uploads in the demo

Use small synthetic PDFs/images, not real personal documents.

- Public Greenwood application form → file field → submit → School Admin application detail → Download
- School Admin → pupil record → Documents
- Teaching → assignment → Upload file → publish → student downloads and attaches work
- Pastoral / Safeguarding concern → Upload attachment (authorised staff only)
- Activities → activity detail → Attach document (parent-visible trip letter vs staff-only risk assessment) → Parent/Student download only when visibility allows
