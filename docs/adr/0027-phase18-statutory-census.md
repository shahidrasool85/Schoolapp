# ADR 0027 — Live canonical records vs census snapshots

**Status:** Accepted  
**Date:** 2026-08-25

## Context

England schools need census-ready statutory pupil data, data-quality checks, and reproducible exports. Schoolapp is not a DfE COLLECT submission product and must not claim certification. Operational pupil, enrolment, attendance, SEND/additional-needs, and class records already exist from Phases 1–17. A second “census correction” pupil database would drift from live MIS data and create privacy risk.

Census extracts are taken on a census date. Live records continue to change afterwards. Re-querying today’s live rows when opening an old census would silently rewrite history.

Official classifications (ethnicity, language, enrolment status, SEND provision, and similar) change between academic years. Hard-coded frontend constants cannot version that.

## Decision

1. **Canonical live records stay canonical.** Identity, enrolment, attendance marks, and additional-needs notes remain on existing tables. `student_statutory_profiles` and `student_fsm_periods` extend the pupil; they do not replace `student_profiles` / `student_enrolments`.
2. **Census snapshots are immutable copies of census-relevant values.** Creating a snapshot stores school identifiers plus pupil statutory fields, on-roll flag, FSM eligibility as-at the census date, and a versioned payload of enrolment/FSM periods. It does not copy medical narrative, safeguarding, messages, homework, passwords, or storage keys.
3. **Version, do not overwrite.** Regenerating a draft snapshot inserts `current_snapshot_version + 1`. Exported, superseded, archived, and finalised (`ready`) snapshots cannot be rewritten. Snapshot tables are INSERT-only for the app role. Revalidation is refused once a census is `ready`; the database also rejects rolling those statuses back to `draft`/`validating`.
4. **One validation engine.** `validateStatutory` runs against live loaders and snapshot loaders and returns structured `{ ruleKey, severity, entityType, entityId, field, message, metadata }`. UI is not the source of rules.
5. **Versioned platform code sets.** `statutory_code_sets` / `statutory_codes` are platform-owned (currently `2025-2026`). Schools cannot redefine official codes. Operational labels may exist elsewhere.
6. **Shared on-roll logic.** Census, attendance summaries, and pupil-roll reports call the same helpers. Admission date is inclusive; leaving date is the last day on roll. Marks before admission or after leaving are excluded from statutory attendance.
7. **Exports are server-side, tenant-scoped, and audited.** CSV is UTF-8 with BOM, stable headers, and formula-injection prefixing. XML is labelled a census-ready **preview**, not a DfE-approved COLLECT file. Audit events store action, actor, IDs, version/status, and counts — not full pupil snapshots.
8. **No live DfE submission.** No COLLECT credentials, no “DfE approved” copy, no claim of specification certification.

## Consequences

- School Admin fixes data-quality issues on the live pupil record, then snapshots.
- Historical census exports remain reproducible even if the pupil later changes UPN or class.
- Religion, nationality, country of birth, ULN, and staff statutory IDs are out of Phase 18 unless a later census year requires them.
- Platform Super Admin does not receive school statutory browse by default.
- Teachers, parents, and students do not receive school-wide census/statutory capabilities.

## Rejected alternatives

- Querying live rows whenever an old census is opened — silently wrong after operational edits.
- A parallel census pupil database — duplication and drift.
- School-editable DfE code lists — unofficial codes would enter exports.
- Shipping “DfE Census XML” as if certified — product and compliance risk.
