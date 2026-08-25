# ADR 0026 — Phase 17 professional UI design system

**Status:** Accepted  
**Date:** 2026-08-25

## Context

Phases 1–16 delivered a complete school MIS/LMS with permission-aware routing, but the authenticated product still used a thin functional stylesheet and raw page markup. Login had already been redesigned with navy branding, white cards, and role-aware personas. Staff, parent, student, and platform surfaces needed to inherit that language without changing business rules, schema, or tenant isolation.

## Decision

1. **Tokens first.** Shared CSS variables define colour, spacing, type, radius, and elevation. Pages consume those tokens rather than scattered hex values.
2. **Shared primitives, not per-module widgets.** AppShell, PageHeader, StatCard, FilterBar, StatusBadge, EmptyState, and ConfirmationDialog live in `apps/web/components` and are adopted incrementally.
3. **Permission-driven shells.** Sidebar grouping is presentation. Item visibility still uses the same permission keys as before; hiding a link is not authorisation.
4. **Role dashboards compose existing APIs.** Admin/Headteacher see an operational command centre; teachers with assigned-only pupil access see a teaching dashboard. Failed or forbidden metric calls are omitted, never faked.
5. **No schema change.** Phase 16’s `0032_phase16_messaging.sql` remains the latest migration.

## Consequences

- Existing pages pick up table, form, button, and heading styles immediately via `globals.css`.
- Deep module pages can keep current workflows while adopting PageHeader/FilterBar over time.
- Print and login layouts are isolated so global styles do not restyle receipts or the public login card into the staff shell.
