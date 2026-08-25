# Local demo (manual testing)

This is a **local-only** staging setup so you can click through Schoolapp in a browser. It does **not** configure production DNS, TLS, Plesk, or a live domain.

Demo seed will refuse to run in production, against a remote database, or when `PLATFORM_DOMAIN` is not `localhost`.

## What you need

- Node.js 22
- [pnpm 9](https://pnpm.io/installation)
- PostgreSQL 16, either:
  - Docker Desktop (recommended — you do **not** need a local PostgreSQL install or `pg_isready` on the host), or
  - Postgres installed on your computer

You do not need to edit configuration files for the default local demo.

### Windows

1. Install [Git for Windows](https://git-scm.com/) so **Git Bash** is available.
2. Start **Docker Desktop** and wait until it is running (`docker ps` should work).
3. From the Schoolapp folder, run `pnpm install` then `pnpm demo:setup`.

The demo scripts are Bash. In **Git Bash**, `pnpm demo:setup` runs them directly. From **PowerShell** or Command Prompt, the same `pnpm demo:setup` command launches Git Bash automatically when `bash.exe` is in the usual Git for Windows location (or on PATH). If you see a message that Bash is missing, install Git for Windows or open Git Bash and run the command there.

You do not need to install PostgreSQL itself on Windows. Setup checks `pg_isready` on the host when it exists, and otherwise runs `pg_isready` / `psql` with `docker exec` inside the Compose container (not `docker compose exec ... psql -d`, which Compose treats as `--detach`).

You do not need a cloud object-storage account. Demo storage defaults to a local filesystem directory (`.data/object-storage`).

## 1. Install

In a terminal, from the Schoolapp folder:

```bash
pnpm install
```

## 2. Prepare demo data

```bash
pnpm demo:setup
```

That single command:

- writes a local `.env` (and `apps/web/.env.local`) with **demo** values, not production secrets
- starts PostgreSQL if Docker is available and nothing is already listening on port 5432
- creates the local databases (including after a Compose volume wipe; you do not create `schoolapp_test` by hand)

To throw away the Docker Postgres volume this script uses (project name `infra`):

```bash
docker compose --project-directory infra -p infra -f infra/docker-compose.yml down -v
```

`docker compose -f infra/docker-compose.yml down -v` from the repo root uses a **different** project name (the folder you are in) and will not remove `infra-postgres-1`.
- runs migrations
- loads two demo schools and labelled test logins

To wipe the local `schoolapp` database and load the demo again:

```bash
pnpm demo:reset
```

`demo:reset` does not drop the automated test databases.

## 3. Start the app

```bash
pnpm demo:start
```

Leave this terminal open. Open a browser when it says it is ready.

## 4. URLs to open

| What | URL |
| --- | --- |
| Platform / root | http://localhost:3000 |
| Platform sign in | http://localhost:3000/login |
| Greenwood Academy | http://greenwood.localhost:3000 |
| Greenwood sign in | http://greenwood.localhost:3000/login |
| Greenwood public enquiry | http://greenwood.localhost:3000/admissions/enquiry/year-3-enquiry |
| Greenwood public application | http://greenwood.localhost:3000/admissions/apply/year-3-application |
| Greenwood enquiry embed | http://greenwood.localhost:3000/admissions/embed/enquiry/year-3-enquiry |
| Oak public enquiry | http://oakacademy.localhost:3000/admissions/enquiry/oak-enquiry |
| Oak public application | http://oakacademy.localhost:3000/admissions/apply/oak-application |
| Oak Academy | http://oakacademy.localhost:3000 |
| Oak Academy sign in | http://oakacademy.localhost:3000/login |

Use the **school** URL for school staff, parents, and students. On a school host choose **Staff**, **Parent** or **Student**. Staff are routed by their actual membership after sign-in — they do not choose School Admin versus Teacher. Use **localhost** for the Platform Admin.

Modern browsers treat `*.localhost` as your own computer. If a school URL will not open, add this line to your hosts file and retry:

```text
127.0.0.1 greenwood.localhost oakacademy.localhost
```

On Windows that file is `C:\Windows\System32\drivers\etc\hosts` (open Notepad as Administrator to edit it).

## 5. Demo logins

All passwords are obviously labelled demo values. Do not use them anywhere live.

| Role | School | How to sign in | Password |
| --- | --- | --- | --- |
| Platform Admin | Platform | Email `demo.platform@schoolapp.test` at http://localhost:3000/login | `DemoPass-Platform-1` |
| Greenwood School Admin | Greenwood Academy | Email `demo.admin@greenwood.test` at http://greenwood.localhost:3000/login | `DemoPass-GreenwoodAdmin-1` |
| Headteacher | Greenwood Academy | Email `demo.head@greenwood.test` | `DemoPass-Headteacher-1` |
| Teacher | Greenwood Academy | Email `demo.teacher@greenwood.test` | `DemoPass-Teacher-1` |
| Parent | Greenwood Academy | Email `demo.parent@greenwood.test` | `DemoPass-Parent-1` |
| Student | Greenwood Academy | Choose **Student**, username `amelia.khan` | `DemoPass-Student-1` |
| Oak Academy School Admin | Oak Academy | Email `demo.admin@oakacademy.test` at http://oakacademy.localhost:3000/login | `DemoPass-OakAdmin-1` |

Also created for isolation checks (optional):

| Role | How to sign in | Password |
| --- | --- | --- |
| Oak teacher | `demo.teacher@oakacademy.test` | `DemoPass-OakTeacher-1` |
| Oak parent | `demo.parent@oakacademy.test` | `DemoPass-OakParent-1` |
| Oak student | username `niamh.okonkwo` at Oak Academy | `DemoPass-OakStudent-1` |

## 6. What to click through

Sign in as **Greenwood School Admin** at http://greenwood.localhost:3000/login, then open:

- School Admin dashboard (`/school`)
- Teaching & Learning (`/school/teaching`) — assignments, submissions, marking
- Assessment & Progress (`/school/assessment`) — formal assessments, result entry, reports
- Communications (`/school/communications`) — announcements and calendar
- Timetable (`/school/timetable`) — school day, rooms, class/teacher views, cover/changes
- Activities (`/school/activities`) — trips, clubs, consent responses, waiting list
- Finance / Payments (`/school/finance`) — charges, outstanding, offline payment, waiver, refund
- Messages (`/school/messages`) — parent–teacher and school-office threads; not announcements
- Pastoral & Behaviour (`/school/pastoral`) — incidents, achievements, pastoral concerns
- Safeguarding (`/school/safeguarding`) — restricted; Headteacher and School Admin only in the demo
- Students (open Amelia Khan — attendance, Learning history, Academic / Results, and behaviour summary)
- Attendance → My registers (Hannah Cole’s 3A) or School attendance
- Student portal (year-group enable/disable; Reception can be turned on)
- Staff / Teachers
- Parents / Guardians
- Admissions → Forms, Sources / Campaigns, Enquiries, Applications

Sign in as the Greenwood **teacher** and open Teaching & Learning. You should see Year 3 work for 3A (and 3B subject work), with unsubmitted, submitted, marked, and resubmission-requested examples. Attendance → My registers should still show 3A, not the whole school. Communications should let the teacher create a class notice for 3A, not a whole-school broadcast. **Messages** should show Amelia Khan’s maths homework thread with Aisha Khan, not Yusuf’s office thread unless Hannah is a participant, and never Oak’s Niamh thread. **My Timetable** should show Hannah Cole’s 3A lessons (week of 7 September 2026 if today is before term) with Take attendance. **Activities** should show trips/clubs Hannah is assigned to (museum visit, chess club, football fixture), not school-wide management of every activity.

Sign in as the Greenwood **parent** and open the parent portal (`/parent`). You should see Amelia Khan and Yusuf Khan, attendance, Learning (assignments/due/status; marks only when released to parents), released formal results, published reports, Notices, Calendar, **Messages** (Amelia maths homework with an unread teacher reply, school-office holiday club, closed Yusuf lost-jumper thread; no other parent or Oak threads), **Activities** (Science Museum consent for Amelia, Chess Club waiting list for Amelia / confirmed for Yusuf, football fixture, cancelled pottery workshop), **Payments** (Amelia museum trip outstanding, Amelia replacement reading book, Yusuf chess club paid with receipt; no Oak charges), and notifications. Unreleased results, the draft spring report, and the staff-only briefing must not appear. Family calendar rows should name which child/class they relate to. Each child has a **Timetable** page; Amelia (3A) and Yusuf (5A Friday Maths) differ. On an outstanding charge, **Pay** opens the local demo checkout (success/fail/cancel). Success returns as pending until the signed fake-provider event settles the charge; a receipt then appears.

Sign in as the Greenwood **student** (Student tab, username `amelia.khan`) and open My Learning (`/student/learning`) plus Results (`/student/results`), Notices, and **Activities**. You should see assigned work, student-released formal results, the whole-school welcome, and the Year 3 swimming notice. Parent-only English reading, unreleased science, parents' evening booking copy, and staff-only notices must not appear. **My Timetable** should show only Amelia’s 3A lessons. Coding club taster allows student self-sign-up; the museum trip does not.

Sign in as **Oak Academy School Admin** at http://oakacademy.localhost:3000/login. You should see Oak pupils such as Niamh Okonkwo and Oak comprehension work, **not** Greenwood’s Amelia Khan or Year 3 Fractions.

Sign in as **Platform Admin** at http://localhost:3000/login. You should land on `/platform` and see both schools listed. Platform Admin does not browse pupil records from here.

## 7. Limitations

- This is local demo data only. Names, emails, and passwords are fake and clearly labelled.
- AI learning, PDF report cards, and mobile apps are **not built yet**. Formal assessments/results/reports are in Phase 8. Public admissions forms are in Phase 9. Announcements and the school calendar are in Phase 10. The school timetable is in Phase 12. Trips, clubs, and parent consent are in Phase 14. School charges and parent payments are in Phase 15 (local fake provider; no Stripe credentials required). Parent–teacher messaging is in Phase 16 (in-app only; no email/SMS). Phase 17 restyles the authenticated product; it does not add new workflows. Phase 13 object storage is available for pupil, learning, pastoral, safeguarding, admissions, activity, and message files.
- Seeded activity document *titles* (for example the Science Museum trip letter) have no stored bytes until a School Admin attaches a PDF on the activity page. Use a small synthetic PDF, not a real pupil letter.
- Learning resources that are URL-only still exist alongside optional file uploads on assignments.
- Demo attendance is seeded from 1 September 2026 (the 2026/27 year). If “today” is before term, registers default to the year start.
- There is no production wildcard DNS, TLS, or Plesk setup in this path.
- Each school host has its own browser session. Sign in again when you switch from `localhost` to `greenwood.localhost` or `oakacademy.localhost`.
- Public school self-signup is disabled on purpose.
- `pnpm demo:setup` will not run if `NODE_ENV=production`, if `PLATFORM_DOMAIN` is not `localhost`, or if the database is not on this computer.
