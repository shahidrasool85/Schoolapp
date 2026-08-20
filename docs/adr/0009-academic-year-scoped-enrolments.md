# ADR 0009: Academic year–scoped enrolments and class memberships

**Status:** Accepted  
**Date:** 2026-08-20

## Context

UK schools operate in academic years, terms, and often half-terms. A pupil is not permanently “in Class 4B” for the lifetime of their student row. They move year group each September, may change form class mid-year, and may belong to several teaching groups. Teachers are assigned to classes for a period. Teaching groups relate to subjects. Historical membership must remain queryable for attendance, results, and reports.

## Decision

- **Academic years**, **terms**, and **half-terms** are first-class entities (half-terms optional per school calendar, but the model supports them).
- A **student profile** is the person-at-this-school record. It does **not** store a permanent `class_id`.
- **Student enrolments** capture *historical* year-group (and optional house) placement per academic year, with start/end dates and status.
- **Classes** belong to an academic year (form or teaching group). They are not eternal rooms that pupils occupy forever.
- **Class memberships** are dated student↔class links for an academic year (and may end mid-year). Current classmates = memberships with no `ended_on` (or `ended_on` in the future) in the relevant year.
- **Class staff assignments** are dated teacher/staff↔class links (form tutor, subject teacher, and similar).
- **Class↔subject** relationships describe what a class teaches; a form class may have none or many, a teaching group typically one or a few.
- “Current class / current year group” is **derived** from the current academic year’s enrolment and memberships, never from a single required FK on `student_profiles`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| `student_profiles.class_id` | Destroys history; blocks mid-year moves and multiple teaching groups |
| Class without `academic_year_id` (“reusable” class) | Year 3 2025/26 and Year 3 2026/26 are different cohorts; history and teacher assignments blur |
| Only current membership rows, overwrite on change | Attendance and reports would lose the class the pupil was in at the time |

## Consequences

- Registers, assignments, and reports must key off membership *as of a date* (or academic year/term), not “the student’s class”.
- Phase 2 implements this model; later LMS/attendance modules must use it.
- Unique constraints allow history: uniqueness of *active* class membership, not uniqueness of all-time pairs without dates.
