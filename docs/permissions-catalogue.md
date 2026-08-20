# Permission catalogue (seed)

Authorisation is by **permission key**, not by role name. System roles receive the grants below in a Phase 1 data migration. Schools may clone roles later.

Legend: **F** = full, **R** = read, **—** = none. Parent/student columns are for those roles in an organisation context.

| Permission | Super Admin* | School Admin | Head | Teacher | Admissions | Other staff | Parent | Student |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `platform.organisations.manage` | F | — | — | — | — | — | — | — |
| `org.settings.read` | F | F | F | R | R | R | — | — |
| `org.settings.manage` | F | F | — | — | — | — | — | — |
| `org.members.manage` | F | F | R | — | — | — | — | — |
| `org.roles.manage` | F | F | — | — | — | — | — | — |
| `academic.structure.manage` | — | F | F | R | R | R | — | — |
| `admissions.enquiries.manage` | — | F | R | — | F | — | — | — |
| `admissions.applications.manage` | — | F | R | — | F | — | — | — |
| `admissions.offers.manage` | — | F | F | — | F | — | — | — |
| `students.profiles.read` | — | F | F | F** | R | R | — | — |
| `students.profiles.manage` | — | F | F | — | F (pre-enrol) | — | — | — |
| `students.profiles.read_own_children` | — | — | — | — | — | — | F | — |
| `students.profiles.read_self` | — | — | — | — | — | — | — | F |
| `guardianships.manage` | — | F | R | — | F | — | — | — |
| `attendance.record.manage` | — | F | F | F** | — | — | — | — |
| `attendance.record.read_own_children` | — | — | — | — | — | — | F | — |
| `lms.assignments.manage` | — | F | F | F** | — | — | — | — |
| `lms.submissions.submit` | — | — | — | — | — | — | — | F |
| `lms.resources.read` | — | F | F | F | — | R | R (child) | F |
| `learning.activities.generate` | — | F | F | F | — | — | — | — |
| `learning.activities.publish` | — | F | F | F*** | — | — | — | — |
| `learning.activities.attempt` | — | — | — | — | — | — | — | F |
| `gamification.leaderboards.configure` | — | F | F | — | — | — | — | — |
| `audit.read` | F | F | F | — | — | — | — | — |
| `external_identifiers.upn.read` | — | F | F | — | R | — | — | — |

\* Super Admin acts on **platform** routes. They do not silently receive pupil read in a school unless a future break-glass flow is used and audited.

\*\* Teachers: further restricted by class assignment in application code (and later RLS).

\*\*\* Schools may require a designated publisher role; default can be teacher.

This matrix is a **starting proposal**. Phase 1 should store it as data (`role_permissions`), not as a spreadsheet in application if-statements.

Additional keys will be registered when modules land (notifications, documents, reports, competitions). Unused keys must not be granted to parent/student by default.
