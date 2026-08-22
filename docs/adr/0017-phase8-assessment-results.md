# ADR 0017: Formal assessments, results, and progress reports

**Status:** Accepted  
**Date:** 2026-08-22

## Context

Phase 8 adds the first formal academic assessment, results, and reporting foundation. This must stay distinct from:

- Phase 7 `learning_marks` (LMS/work marking and feedback)
- Phase 4 `admissions_assessments` (pre-enrolment interviews/visits)

Two product rules would be expensive to reverse:

1. Treating homework marks as the school’s formal results engine.
2. Hard-coding one UK judgement scale or a three-term-only reporting calendar.

## Decision

### Assessment lifecycle

Statuses are controlled: `draft → open → completed → reviewed → published → archived`.

- `draft`: definition only
- `open`: authorised teachers enter/amend results
- `completed`: entry closed
- `reviewed`: optional moderation (can be skipped: `completed → published`)
- `published`: official; `published_at` gates portal visibility together with per-result release flags
- `archived`: historical lock; previously published items remain visible if they were published

Review is capability-based (`results.review`, `reports.review`). Schools that do not require formal approval can publish from `completed` / `draft` when the actor has publish permission.

### Types and schemes

Assessment types and grade/attainment schemes are organisation catalogues, not hardcoded enums. Defaults include class test, end-of-unit, mock, 11+ practice, spelling, reading, teacher assessment, practical, baseline; and schemes for percentage, letter, numeric 1–9, and age-related labels. Schools may add keys and levels.

A scheme’s `is_numeric` flag decides whether averages are meaningful. Non-numeric schemes never get a silent average.

### Results vs LMS marks

`academic_results` is the formal result. It is never written from `learning_marks`. An optional `source_learning_assignment_id` on the assessment allows a later evidence link; Phase 8 does not convert homework.

Clients cannot set `entered_by`, `amended_by`, `reviewed_by`, or timestamps. Session `app_current_user_id()` wins. Meaningful amendments append `academic_result_revisions`.

`released_to_student` and `released_to_parent` are independent. Portal visibility also requires the assessment to have been published.

### Reporting periods and reports

`academic_reporting_periods` belong to an academic year and may optionally reference a term. A school may have autumn/spring/summer, half terms, end of year, or any other set.

Reports have `draft → submitted_for_review → approved → published → archived`, with `draft → published` when approval is not required. Teachers with `reports.manage_assigned` cannot publish unless they also have `reports.publish`. Publishing writes an immutable `academic_report_publications` snapshot. Later working-copy edits cannot change what a parent already saw.

### Progress

Progress is latest vs previous result on the same subject. Compare percentage when both exist; otherwise compare scheme `numeric_value`. No composite or AI score. Targets are school-defined labels/levels, not computed interventions.

### Access

Teacher access is assigned-only (`*.read_assigned` / `*.enter_assigned` / `*.manage_assigned`) against class assignments and inclusions. School-wide keys and `academic.oversight` are for Headteacher / School Admin. Parents require `portal_access`. Students require current primary enrolment and effective Student Portal policy.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Reuse `learning_marks` for formal results | Mixes homework marking with statutory/reporting results |
| Reuse `admissions_assessments` | Pre-enrolment selection, not enrolled-pupil attainment |
| Hard-code Working Below / Expected only | Blocks other schemes and jurisdictions |
| Assume exactly three terms | Blocks half-term and end-of-year reporting |
| Live class membership as the result identity | Class moves would drop academic history |

## Consequences

- AI report drafting, PDF export, behaviour summaries, DfE census, and complex analytics remain later phases.
- Future progress/evidence features may reference LMS assignments via `source_learning_assignment_id` without converting marks.
