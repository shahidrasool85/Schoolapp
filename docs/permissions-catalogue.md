# Permission catalogue (seed)

Authorisation is by **permission key**, not by role name. System roles receive the grants below in a data migration. Schools may clone roles later.

Legend: **F** = full, **R** = read, **—** = none.

School Admin and Headteacher are **separate** roles. School Admin is operational (configuration, users, processes). Headteacher is educational oversight/reporting and does **not** automatically receive system-administration permissions.

Teachers do **not** receive school-wide pupil visibility. Assigned pupil access is `*.read_assigned` / `*.manage_assigned` and is enforced against class/subject assignments when that data exists.

Platform Super Admin does **not** silently receive pupil read. Tenant data requires break-glass support access.

| Permission | Super Admin | School Admin | Head | Teacher | Admissions | Other staff | Parent | Student |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `platform.organisations.manage` | F | — | — | — | — | — | — | — |
| `platform.support_access.manage` | F | — | — | — | — | — | — | — |
| `org.settings.read` | — | F | F | R | R | R | — | — |
| `org.settings.manage` | — | F | — | — | — | — | — | — |
| `org.members.read` | — | F | F | — | R | — | — | — |
| `org.members.manage` | — | F | — | — | — | — | — | — |
| `org.roles.manage` | — | F | — | — | — | — | — | — |
| `org.support_access.read` | — | F | F | — | — | — | — | — |
| `org.billing.read` | — | F | — | — | — | — | — | — |
| `academic.structure.manage` | — | F | F | R | R | — | — | — |
| `admissions.read` | — | F | F | — | F | — | — | — |
| `admissions.enquiries.manage` | — | F | — | — | F | — | — | — |
| `admissions.applications.manage` | — | F | — | — | F | — | — | — |
| `admissions.offers.manage` | — | F | F | — | F | — | — | — |
| `admissions.decide` | — | F | F | — | F | — | — | — |
| `admissions.convert` | — | F | — | — | F | — | — | — |
| `students.profiles.read` | — | F | F | — | R | — | — | — |
| `students.profiles.read_assigned` | — | — | — | F | — | — | — | — |
| `students.profiles.manage` | — | F | — | — | F (pre-enrol) | — | — | — |
| `students.profiles.read_own_children` | — | — | — | — | — | — | F | — |
| `students.profiles.read_self` | — | — | — | — | — | — | — | F |
| `students.restricted_contact.read` | — | F | — | — | — | — | — | — |
| `guardianships.manage` | — | F | R | — | F | — | — | — |
| `attendance.record.read` | — | F | F | — | — | — | — | — |
| `attendance.record.manage` | — | F | F | — | — | — | — | — |
| `attendance.record.correct` | — | F | F | — | — | — | — | — |
| `attendance.record.manage_assigned` | — | — | — | F | — | — | — | — |
| `attendance.record.read_own_children` | — | — | — | — | — | — | F | — |
| `attendance.record.read_self` | — | — | — | — | — | — | — | F |
| `attendance.config.manage` | — | F | — | — | — | — | — | — |
| `students.portal_access.manage` | — | F | — | — | — | — | — | — |
| `students.documents.read` | — | F | F | — | — | — | — | — |
| `students.documents.manage` | — | F | — | — | — | — | — | — |
| `students.documents.read_own_children` | — | — | — | — | — | — | F | — |
| `students.documents.read_self` | — | — | — | — | — | — | — | F |
| `lms.assignments.manage` | — | — | F | — | — | — | — | — |
| `lms.assignments.manage_assigned` | — | — | — | F | — | — | — | — |
| `lms.submissions.submit` | — | — | — | — | — | — | — | F |
| `lms.resources.read` | — | R | F | F | — | R | R (child) | F |
| `learning.activities.generate` | — | — | F | F | — | — | — | — |
| `learning.activities.publish` | — | — | F | — | — | — | — | — |
| `learning.activities.attempt` | — | — | — | — | — | — | — | F |
| `gamification.leaderboards.configure` | — | — | F | — | — | — | — | — |
| `audit.read` | F | F | F | — | — | — | — | — |
| `notifications.inbox.read` | — | F | F | F | F | F | F | F |
| `external_identifiers.upn.read` | — | F | F | — | R | — | — | — |

`students.documents.read_self` is seeded on the Student role for a later pupil-visible documents API. No current route checks that permission, so it does not grant access by itself.

`admissions.convert` is the only path that creates the canonical student/enrolment from an accepted application. Teachers do not receive admissions keys. Parents and students never receive School Admin admissions access.

`students.restricted_contact.read` is **not** granted to Teacher, Parent, or Student. No Phase 1–4 API exposes the column to those roles.

`notifications.inbox.read` is own-inbox only. RLS still requires `organisation_id` plus `recipient_user_id = current user`.

Assigned permissions (`*_assigned`) deny access when the teacher has no matching class/subject assignment. Headteacher uses the non-assigned (school-wide) educational keys instead.

School Admin receives school-wide attendance **in addition to** Headteacher so operational staff can run registers and corrections. Ordinary `school.staff` does not. Attendance percentage treats late as present and excludes `not_required` sessions; the formula lives in domain/core code, not the UI.

Student portal access is school default → year-group override → class override → pupil override. There is no age-based prohibition on Reception / Year 1 / Year 2. Class and pupil override APIs exist in Phase 6; School Admin UI covers school default and year group.

Parent/student document visibility is explicit. Staff-only metadata is never listed on parent/student endpoints.

Unused module keys are seeded so later phases do not hardcode role names; those modules are not implemented in Phase 1.
