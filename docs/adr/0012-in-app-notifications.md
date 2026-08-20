# ADR 0012: In-app notifications are per-recipient and organisation-scoped

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Phase 3 needs a parent/student notification inbox that future Expo apps will call through `/api/v1`. Later phases will create events such as homework assigned, results published, and school announcements. Email, SMS, and push delivery are out of scope.

The inbox must not leak across users in the same school or across organisations. A parent with children at two schools must see only the selected school's inbox.

## Decision

- Store **one row per recipient per organisation** in `notifications`.
- Required fields: `organisation_id`, `recipient_user_id`, `type`, `category`, `title`, `body`, `created_at`, `read_at`.
- Optional `action_target` jsonb is a future client-agnostic link (`resourceType` / `resourceId`), not a web-only URL.
- **FORCE RLS** with combined tenant **and** recipient policies. Do not stack a second PERMISSIVE tenant-only policy (Postgres ORs permissive policies).
- Recipients may `SELECT` their rows and `UPDATE (read_at)` only. The app role cannot `INSERT` or `DELETE`. Future producers (LMS, announcements, worker) will insert as owner or via a SECURITY DEFINER function.
- `GET /api/v1/notifications` and `PATCH /api/v1/notifications/{id}` revalidate organisation membership. Cross-user and cross-tenant ids return **404**.
- Notification bodies must not include restricted-contact flags, admin notes, or other children's data. Producers are responsible for minimising content.

`notification_preferences` remains a delivery-channel placeholder. It is not the inbox.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Broadcast row + receipts table | Better for school-wide announcements at scale, but the Phase 3 contract is a per-user inbox with read state. Fan-out can be added later without changing the API. |
| Tenant isolation only | Same-school parents would see each other's inbox. |
| Web-only Server Actions | Would not be reusable by Expo. |

## Consequences

- Announcements to many parents will insert many rows until a fan-out/receipts model is added.
- Marking read cannot change title, body, type, or recipient.
- Delivery workers must not read this table as a substitute for preferences.
