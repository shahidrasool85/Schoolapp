# ADR 0020 — Behaviour, pastoral, and safeguarding foundation

## Status

Accepted

## Context

Schools need a staff-facing record of behaviour incidents, positive achievements, pastoral concerns, and safeguarding concerns. These workflows are related but are not the same data category. Safeguarding information is especially sensitive and must not appear merely because a user can open a student record.

## Decision

- Keep behaviour, pastoral, and safeguarding as separate tables, APIs, and staff navigation.
- Authorise by permission keys (`behaviour.*`, `pastoral.*`, `safeguarding.*`), never role-name checks.
- Teachers receive assigned-only behaviour record/read by default. They do not receive pastoral or safeguarding keys.
- Safeguarding APIs return 404 without a safeguarding capability. Safeguarding tables also require that capability at RLS.
- Formal audit for safeguarding stores IDs, status, and assignment metadata — not concern narrative.
- Parent and student APIs stay conservative in this phase. Visibility flags exist for later publication but do not open portal routes yet.
- Chronology is append-only. Corrections create amendment entries rather than overwriting history.

## Consequences

Staff can run a practical teacher and pastoral workflow without mixing safeguarding into generic behaviour screens. Later phases can add rewards, statutory exclusion, or agency integrations without rewriting the access model.
