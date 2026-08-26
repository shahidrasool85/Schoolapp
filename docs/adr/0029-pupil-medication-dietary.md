# ADR 0029 — Structured pupil medication and dietary requirements

**Status:** Accepted  
**Date:** 2026-08-26

## Context

Phase 9 stored a single free-text `student_additional_needs` row per pupil (allergies, conditions, medication, dietary, SEND notes) at admissions conversion. That is not enough for school operations: pupils have multiple medicines and dietary requirements, records must be stopped without losing history, teachers need an operational subset, parents may see parent-visible records for authorised children, and trip safety summaries must not invent a second copy of the data.

Safeguarding remains a separate capability and must not mix with operational medical/dietary records.

## Decision

1. **Canonical structured rows, not duplicated notes.** `student_medications` and `student_dietary_requirements` are the live source for medication and dietary facts. Free-text columns on `student_additional_needs` remain admissions provenance / fallback only. Activity/trip medical summaries read **active** structured rows and fall back to the legacy text only when no structured row exists.
2. **Multiple records and preserved history.** A pupil may have many medication and dietary rows. Stopping or changing a row does not delete it. `status` (`active`/`stopped` for medication, `active`/`inactive` for dietary) plus `ended_on` keep the current fact. Append-only `*_revisions` tables snapshot previous values (including internal notes) for authorised staff.
3. **Authorised staff manage; teachers see operational fields.** `students.additional_needs.manage` (School Admin, Admissions) creates/edits/stops. `students.additional_needs.read` (Admin, Headteacher, Admissions) is the full staff view, including internal notes. Teachers receive `students.medications.read_operational` and `students.dietary.read_operational` for **assigned** pupils only: name, dosage, route, schedule, PRN, instructions, administration responsibility, consent status, and dietary safety fields. They do not receive internal notes, parent-visibility flags, or manage rights.
4. **Parent Portal is opt-in per record and rechecked.** `students.medications.read_own_children` / `students.dietary.read_own_children` plus live `guardianship` + `portal_access` (not ended) are required. Only `parent_visible` rows are returned. Knowing a child id is not enough. Ended or portal-off guardianships 404.
5. **Student Portal does not automatically expose medication administration.** No student medication/dietary routes. `/student/me` and the student dashboard do not include dosage, schedule, or administration details.
6. **Tenant isolation, FORCE RLS, actor stamps.** New tables have `organisation_id`, ENABLE + FORCE RLS, same-org student checks, and `created_by` / `updated_by` from `app_current_user_id()`. App role has SELECT/INSERT/UPDATE, not DELETE.
7. **No sensitive text in generic audit or notifications.** Formal audit stores ids, status, PRN/type, and parent-visible flags only — never medication names, dosages, dietary wording, or internal notes. This work does not send inbox notifications for medication/dietary changes.
8. **Not safeguarding and not census SEND.** These tables are operational health/catering records. They do not grant `safeguarding.*`. SEND notes stay on `student_additional_needs.send_notes` and statutory SEND stays on `student_statutory_profiles`.

## Consequences

- Pupil Record shows Medication and Dietary sections for staff who can read them.
- Parent child overview may list parent-visible records.
- Trip safety summaries stay live (no stored snapshot) and reuse the canonical rows.
- Admissions conversion still writes legacy text and, when present, seeds one structured medication/dietary row from that text.

## Rejected alternatives

- Editing the free-text blob in place — no history, no multiple records, no field-level teacher/parent projection.
- Granting teachers `students.additional_needs.read` — would expose SEND notes and internal clinical notes.
- Auto-publishing medication administration to the Student Portal — unnecessary and sensitive.
- Storing trip medical snapshots on activity rows — duplicates canonical data; ADR 0023 already chose live reads.
- Mixing this model with safeguarding chronology — different permission, audit, and disclosure rules.
