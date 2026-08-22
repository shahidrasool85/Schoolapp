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
| `admissions.forms.read` | — | F | F | — | F | — | — | — |
| `admissions.forms.manage` | — | F | — | — | F | — | — | — |
| `admissions.campaigns.read` | — | F | F | — | F | — | — | — |
| `admissions.campaigns.manage` | — | F | — | — | F | — | — | — |
| `admissions.public_submissions.read` | — | F | F | — | F | — | — | — |
| `students.additional_needs.read` | — | F | F | — | F | — | — | — |
| `students.additional_needs.manage` | — | F | — | — | F | — | — | — |
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
| `lms.assignments.read` | — | F | F | — | — | — | — | — |
| `lms.assignments.read_assigned` | — | — | — | F | — | — | — | — |
| `lms.assignments.manage` | — | F | F | — | — | — | — | — |
| `lms.assignments.manage_assigned` | — | — | — | F | — | — | — | — |
| `lms.assignments.read_own_children` | — | — | — | — | — | — | F | — |
| `lms.assignments.read_self` | — | — | — | — | — | — | — | F |
| `lms.submissions.read` | — | F | F | — | — | — | — | — |
| `lms.submissions.read_assigned` | — | — | — | F | — | — | — | — |
| `lms.submissions.mark` | — | F | F | — | — | — | — | — |
| `lms.submissions.mark_assigned` | — | — | — | F | — | — | — | — |
| `lms.submissions.submit` | — | — | — | — | — | — | — | F |
| `lms.submissions.read_self` | — | — | — | — | — | — | — | F |
| `lms.submissions.read_own_children` | — | — | — | — | — | — | F | — |
| `lms.resources.read` | — | R | F | F | — | R | R (child) | F |
| `lms.resources.manage` | — | F | F | — | — | — | — | — |
| `lms.resources.manage_assigned` | — | — | — | F | — | — | — | — |
| `assessments.read` | — | F | F | — | — | — | — | — |
| `assessments.read_assigned` | — | — | — | F | — | — | — | — |
| `assessments.manage` | — | F | F | — | — | — | — | — |
| `assessments.manage_assigned` | — | — | — | F | — | — | — | — |
| `results.read` | — | F | F | — | — | — | — | — |
| `results.read_assigned` | — | — | — | F | — | — | — | — |
| `results.enter` | — | F | F | — | — | — | — | — |
| `results.enter_assigned` | — | — | — | F | — | — | — | — |
| `results.review` | — | F | F | — | — | — | — | — |
| `results.publish` | — | F | F | — | — | — | — | — |
| `results.read_own_children` | — | — | — | — | — | — | F | — |
| `results.read_self` | — | — | — | — | — | — | — | F |
| `reports.read` | — | F | F | — | — | — | — | — |
| `reports.read_assigned` | — | — | — | F | — | — | — | — |
| `reports.manage` | — | F | F | — | — | — | — | — |
| `reports.manage_assigned` | — | — | — | F | — | — | — | — |
| `reports.review` | — | F | F | — | — | — | — | — |
| `reports.publish` | — | F | F | — | — | — | — | — |
| `reports.read_own_children` | — | — | — | — | — | — | F | — |
| `reports.read_self` | — | — | — | — | — | — | — | F |
| `academic.oversight` | — | F | F | — | — | — | — | — |
| `learning.activities.generate` | — | — | F | F | — | — | — | — |
| `learning.activities.publish` | — | — | F | — | — | — | — | — |
| `learning.activities.attempt` | — | — | — | — | — | — | — | F |
| `gamification.leaderboards.configure` | — | — | F | — | — | — | — | — |
| `audit.read` | F | F | F | — | — | — | — | — |
| `notifications.inbox.read` | — | F | F | F | F | F | F | F |
| `external_identifiers.upn.read` | — | F | F | — | R | — | — | — |

`students.documents.read_self` is seeded on the Student role for a later pupil-visible documents API. No current route checks that permission, so it does not grant access by itself.

`admissions.convert` is the only path that creates the canonical student/enrolment from an accepted application. Teachers do not receive admissions keys. Parents and students never receive School Admin admissions access.

Public form configuration uses `admissions.forms.*` and `admissions.campaigns.*`. Submitted answers (including medical/custom questions) require `admissions.public_submissions.read` or `admissions.read`. `students.additional_needs.*` gates the post-enrolment medical/additional-needs record; it is not granted to teachers, parents, or students.

`students.restricted_contact.read` is **not** granted to Teacher, Parent, or Student. No Phase 1–4 API exposes the column to those roles.

`notifications.inbox.read` is own-inbox only. RLS still requires `organisation_id` plus `recipient_user_id = current user`.

Assigned permissions (`*_assigned`) deny access when the teacher has no matching class/subject assignment. Headteacher uses the non-assigned (school-wide) educational keys instead.

School Admin receives school-wide attendance **in addition to** Headteacher so operational staff can run registers and corrections. Ordinary `school.staff` does not. Attendance percentage treats late as present and excludes `not_required` sessions; the formula lives in domain/core code, not the UI.

Student portal access is school default → year-group override → class override → pupil override. There is no age-based prohibition on Reception / Year 1 / Year 2. Class and pupil override APIs exist in Phase 6; School Admin UI covers school default and year group.

Teacher LMS access is **assigned-only**. `lms.assignments.manage_assigned` / `lms.submissions.mark_assigned` do not grant school-wide work. Year-group targeting and school-wide lists require `lms.assignments.manage` / `lms.assignments.read` (Headteacher and School Admin). Ordinary `school.staff` does not receive those keys.

`lms.assignments.manage_assigned` lets a teacher create work for assigned classes/pupils and then edit/publish/close **their own** rows (`created_by`). Sharing a pupil with another teacher does not let that teacher take over lifecycle of someone else’s assignment. `lms.submissions.mark_assigned` is the key used to mark remaining authorised recipients.

Formal assessment keys follow the same assigned vs school-wide split. `assessments.manage_assigned` / `results.enter_assigned` / `reports.manage_assigned` do not grant school-wide academic access. `results.review` / `results.publish` / `reports.review` / `reports.publish` and `academic.oversight` are Headteacher and School Admin. Teachers cannot publish reports unless they are separately granted `reports.publish`. Parent/student result APIs require the assessment to have been published **and** the matching release flag. Internal notes and moderation notes are omitted from portal payloads.

Parent learning APIs require `portal_access = true` on the guardianship. Teacher-private notes and unreleased marks are omitted from parent and student payloads. `lms.submissions.submit` is student-only; the parent UI has no submit path.

Parent/student document visibility is explicit. Staff-only metadata is never listed on parent/student endpoints.

Unused module keys are seeded so later phases do not hardcode role names; those modules are not implemented in Phase 1.
