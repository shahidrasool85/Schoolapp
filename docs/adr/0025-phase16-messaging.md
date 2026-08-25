# ADR 0025 — School messaging vs announcements, with explicit participants

**Status:** Accepted  
**Date:** 2026-08-25  
**Phase:** 16

## Context

Schoolapp already has Phase 10 **announcements** (one-way, targeted broadcast with a publish-time recipient snapshot) and Phase 3 **in-app notifications** (per-user inbox, no conversation). Staff also record **parent contact** on behaviour/pastoral rows. None of these is a replyable parent–teacher thread.

Phase 16 needs conversational messaging without becoming an open social graph, WhatsApp, or a second announcement product.

## Decision

### Messaging is not announcements

| Announcements (Phase 10) | Messaging (Phase 16) |
| --- | --- |
| Broadcast to a targeted audience | Explicit participants on a thread |
| One author, optional ack | Append-only messages with replies |
| Class/year/whole-school targeting | Pupil-scoped parent conversations |
| Notices / calendar | Inbox for conversational contact |

Announcements remain the channel for class/year/school notices. Messaging is not used for broadcast.

### Explicit participant history vs current access

- **Participant rows** record who was actually added. They are not rewritten when a class assignment or guardianship changes.
- **Current access** is re-evaluated on every request:
  - Active organisation membership is required (`set_tenant_context`). A participant row alone is not enough after a staff member leaves.
  - Parents also need live `portal_access` and an active guardianship for the related pupil.
  - Teachers may **read** threads they already participate in after a class move.
  - Teachers may **start** a new parent thread only with a current teaching relationship (`assignedStudentIds`) or `messaging.create` / `messaging.manage`.
  - School-wide `messaging.read` / `messaging.manage` remains an oversight capability, not a teacher default.
- Unread counts use a per-participant read pointer (`last_read_at`). Oversight readers who are not participants do not receive inflated unread counts and are not added to the thread merely by opening it. Replying still records explicit participation.

### Teacher assigned-only initiation

Teachers do not receive a school-wide parent directory. `GET /messages/pupils/:id/recipients` returns 404 unless the actor may message that pupil. Parent initiation cannot supply an arbitrary staff user id; class-teacher targets are resolved from current class assignments.

### Parent guardianship

Parent identity comes from the authenticated user plus `guardianChildIds` (active guardianship and `portal_access=true`). Client-supplied guardian IDs are not trusted. If portal access is revoked, parent list/detail/reply for that child’s threads fail closed (404). Historic rows remain for authorised staff.

### No student messaging

Students have no `messaging.*` grants. Student ↔ teacher chat is deferred; it would add safeguarding/moderation complexity.

### No external delivery yet

New messages create an idempotent in-app notification (`message:received:{messageId}:{recipientUserId}`) with a safe body such as `You have a new message from Greenwood Academy.` Email, SMS, and push are not sent. The notification architecture can add channels later without copying message text into those payloads.

### Message immutability and moderation

Sent user messages are immutable (`message_immutable` trigger). There is no normal edit window. Authorised `messaging.moderate` (School Admin / Headteacher) may redact: the original body stays in the database; APIs return `Message removed by authorised staff`. Audit stores conversation/message IDs, not bodies. Teachers cannot erase history.

### Safeguarding boundary

Messaging APIs do not query safeguarding tables. A thread is not copied into safeguarding. Staff may open a safeguarding concern separately. Safeguarding notes never appear in Parent Portal messaging.

## Consequences

- Parent Portal and staff Messages are a new inbox, not an extension of Notices.
- Contact-point routing (school office / admissions / class teacher) is category-based, not hard-coded user IDs. Full team inboxes and office-hours automation remain later work.
- Retention, bulk export, realtime/WebSockets, typing indicators, and statutory retention engines are out of scope.
