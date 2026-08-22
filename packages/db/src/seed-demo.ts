import path from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import pg from "pg";
import {
  ALL_DEMO_LOGINS,
  DEMO_ACCOUNTS,
  DEMO_EMAIL_DOMAINS,
  DEMO_EXTRA_ACCOUNTS,
  DEMO_ORGANISATIONS,
  DEMO_SLUGS,
  DEMO_USER_EMAILS,
  formatDemoCredentials,
} from "./demo-accounts.js";
import { assertDemoSeedAllowed } from "./demo-guard.js";

export type DemoSeedOptions = {
  ownerUrl: string;
  env?: NodeJS.ProcessEnv;
};

export type DemoSeedResult = {
  organisations: Array<{ id: string; slug: string; name: string }>;
  accounts: Array<{ key: string; userId: string; email?: string; username?: string }>;
};

type IdRow = { id: string };

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function roleId(client: pg.Client, key: string): Promise<string> {
  const result = await client.query<IdRow>(
    "select id from roles where organisation_id is null and key = $1",
    [key],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Missing system role ${key}`);
  return id;
}

async function insertUser(
  client: pg.Client,
  input: {
    email?: string | null;
    fullName: string;
    preferredName?: string | null;
    kind: "platform_admin" | "staff" | "parent" | "student";
    passwordHash?: string | null;
    dateOfBirth?: string | null;
  },
): Promise<string> {
  let id: string | undefined;
  if (input.email) {
    const existing = await client.query<IdRow>("select id from users where email = $1", [input.email]);
    id = existing.rows[0]?.id;
    if (id) {
      await client.query(
        `update users
         set full_name = $2, preferred_name = $3, user_kind = $4, status = 'active', date_of_birth = $5
         where id = $1`,
        [id, input.fullName, input.preferredName ?? null, input.kind, input.dateOfBirth ?? null],
      );
    }
  }
  if (!id) {
    const inserted = await client.query<IdRow>(
      `insert into users (email, full_name, preferred_name, user_kind, status, date_of_birth)
       values ($1, $2, $3, $4, 'active', $5)
       returning id`,
      [
        input.email ?? null,
        input.fullName,
        input.preferredName ?? null,
        input.kind,
        input.dateOfBirth ?? null,
      ],
    );
    id = inserted.rows[0]!.id;
  }
  if (input.passwordHash) {
    await client.query(
      `insert into user_credentials (user_id, password_hash)
       values ($1, $2)
       on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [id, input.passwordHash],
    );
  }
  return id;
}

async function addMembership(
  client: pg.Client,
  organisationId: string,
  userId: string,
  roleKey: string,
): Promise<void> {
  const membership = await client.query<IdRow>(
    `insert into organisation_memberships (organisation_id, user_id, status)
     values ($1, $2, 'active')
     returning id`,
    [organisationId, userId],
  );
  await client.query(
    "insert into membership_roles (membership_id, role_id) values ($1, $2)",
    [membership.rows[0]!.id, await roleId(client, roleKey)],
  );
}

async function wipeDemoData(client: pg.Client): Promise<void> {
  const orgs = await client.query<IdRow>(
    "select id from organisations where slug = any($1::citext[])",
    [DEMO_SLUGS],
  );
  const orgIds = orgs.rows.map((row) => row.id);

  const memberUsers =
    orgIds.length === 0
      ? { rows: [] as IdRow[] }
      : await client.query<IdRow>(
          "select distinct user_id as id from organisation_memberships where organisation_id = any($1::uuid[])",
          [orgIds],
        );
  const emailUsers = await client.query<IdRow>(
    `select id from users
     where email = any($1::citext[])
        or split_part(email::text, '@', 2) = any($2::text[])`,
    [DEMO_USER_EMAILS, DEMO_EMAIL_DOMAINS],
  );
  const userIds = [...new Set([...memberUsers.rows, ...emailUsers.rows].map((row) => row.id))];

  if (orgIds.length > 0) {
    await client.query(
      "update admissions_enquiries set converted_application_id = null where organisation_id = any($1::uuid[])",
      [orgIds],
    );
    await client.query(
      `update admissions_applications
       set converted_student_profile_id = null, enquiry_id = null
       where organisation_id = any($1::uuid[])`,
      [orgIds],
    );
    await client.query(
      "update student_profiles set admitted_from_application_id = null where organisation_id = any($1::uuid[])",
      [orgIds],
    );

    const tenantDeletes = [
      "attendance_mark_revisions",
      "attendance_marks",
      "attendance_codes",
      "attendance_session_types",
      "student_documents",
      "student_portal_student_overrides",
      "student_portal_class_overrides",
      "student_portal_year_group_overrides",
      "student_portal_policies",
      "notifications",
      "admissions_documents",
      "admissions_offers",
      "admissions_waiting_list_entries",
      "admissions_assessments",
      "admissions_application_status_history",
      "admissions_application_contacts",
      "admissions_applications",
      "admissions_enquiries",
      "admissions_counters",
      "class_subjects",
      "class_staff_assignments",
      "class_memberships",
      "student_enrolments",
      "guardianships",
      "notification_preferences",
      "user_login_aliases",
      "student_profiles",
      "staff_profiles",
      "classes",
      "subjects",
      "houses",
      "half_terms",
      "terms",
      "year_groups",
      "academic_years",
      "invitations",
      "support_access_grants",
      "external_identifiers",
      "organisation_feature_flags",
      "organisation_identifiers",
      "organisation_hostnames",
      "organisation_slug_history",
      "organisation_subscriptions",
    ];
    for (const table of tenantDeletes) {
      await client.query(`delete from ${table} where organisation_id = any($1::uuid[])`, [orgIds]);
    }
    // audit_events is append-only even for schoolapp_owner; detach rather than delete.
    await client.query(
      "update audit_events set organisation_id = null where organisation_id = any($1::uuid[])",
      [orgIds],
    );
    await client.query(
      `delete from membership_roles
       where membership_id in (
         select id from organisation_memberships where organisation_id = any($1::uuid[])
       )`,
      [orgIds],
    );
    await client.query("delete from organisation_memberships where organisation_id = any($1::uuid[])", [
      orgIds,
    ]);
    await client.query("delete from organisation_settings where organisation_id = any($1::uuid[])", [
      orgIds,
    ]);
    await client.query("delete from organisations where id = any($1::uuid[])", [orgIds]);
  }

  if (userIds.length > 0) {
    await client.query("delete from auth_sessions where user_id = any($1::uuid[])", [userIds]);
    await client.query("delete from user_credentials where user_id = any($1::uuid[])", [userIds]);
    await client.query("delete from platform_admins where user_id = any($1::uuid[])", [userIds]);
    await client.query(
      `delete from membership_roles
       where membership_id in (
         select id from organisation_memberships where user_id = any($1::uuid[])
       )`,
      [userIds],
    );
    await client.query("delete from organisation_memberships where user_id = any($1::uuid[])", [userIds]);
    await client.query(
      `delete from users u
       where u.id = any($1::uuid[])
         and not exists (select 1 from audit_events a where a.actor_user_id = u.id)`,
      [userIds],
    );
  }
}

async function createOrganisation(
  client: pg.Client,
  spec: { slug: string; name: string; legalName: string },
): Promise<string> {
  const org = await client.query<IdRow>(
    `insert into organisations (slug, name, legal_name, status)
     values ($1, $2, $3, 'active')
     returning id`,
    [spec.slug, spec.name, spec.legalName],
  );
  const id = org.rows[0]!.id;
  await client.query("insert into organisation_settings (organisation_id) values ($1)", [id]);
  await client.query(
    `insert into organisation_subscriptions (organisation_id, plan_id, status)
     select $1, p.id, 'trial' from plans p where p.key = 'default' limit 1`,
    [id],
  );
  await client.query(
    "insert into organisation_identifiers (organisation_id, system, identifier) values ($1, 'demo', 'local-seed')",
    [id],
  );
  return id;
}

async function seedYearGroups(client: pg.Client, organisationId: string): Promise<Map<string, string>> {
  const codes: Array<{ code: string; name: string }> = [
    { code: "N", name: "Nursery" },
    { code: "R", name: "Reception" },
    { code: "1", name: "Year 1" },
    { code: "2", name: "Year 2" },
    { code: "3", name: "Year 3" },
    { code: "4", name: "Year 4" },
    { code: "5", name: "Year 5" },
    { code: "6", name: "Year 6" },
    { code: "7", name: "Year 7" },
    { code: "8", name: "Year 8" },
  ];
  const map = new Map<string, string>();
  for (const row of codes) {
    const inserted = await client.query<IdRow>(
      `insert into year_groups (organisation_id, code, name)
       values ($1, $2, $3)
       returning id`,
      [organisationId, row.code, row.name],
    );
    map.set(row.code, inserted.rows[0]!.id);
  }
  await client.query(
    `update year_groups
     set student_login_enabled = true
     where organisation_id = $1 and code in ('3','4','5','6','7','8')`,
    [organisationId],
  );
  await client.query(
    `insert into student_portal_year_group_overrides (organisation_id, year_group_id, enabled)
     select organisation_id, id, true
     from year_groups
     where organisation_id = $1 and code in ('3','4','5','6','7','8')
     on conflict (year_group_id) do update set enabled = true`,
    [organisationId],
  );
  return map;
}

async function seedTerms(
  client: pg.Client,
  organisationId: string,
  academicYearId: string,
): Promise<void> {
  const terms = [
    { key: "autumn", name: "Autumn", startsOn: "2026-09-01", endsOn: "2026-12-18", sortOrder: 1 },
    { key: "spring", name: "Spring", startsOn: "2027-01-05", endsOn: "2027-03-26", sortOrder: 2 },
    { key: "summer", name: "Summer", startsOn: "2027-04-12", endsOn: "2027-07-21", sortOrder: 3 },
  ];
  for (const term of terms) {
    await client.query(
      `insert into terms (
         organisation_id, academic_year_id, key, name, starts_on, ends_on, sort_order
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [organisationId, academicYearId, term.key, term.name, term.startsOn, term.endsOn, term.sortOrder],
    );
  }
}

async function seedSubjects(client: pg.Client, organisationId: string): Promise<Map<string, string>> {
  const subjects = [
    ["mathematics", "Mathematics"],
    ["english", "English"],
    ["science", "Science"],
    ["history", "History"],
    ["geography", "Geography"],
    ["art", "Art"],
    ["pe", "Physical Education"],
    ["computing", "Computing"],
    ["french", "French"],
    ["music", "Music"],
  ] as const;
  const map = new Map<string, string>();
  for (const [key, name] of subjects) {
    const inserted = await client.query<IdRow>(
      "insert into subjects (organisation_id, key, name) values ($1, $2, $3) returning id",
      [organisationId, key, name],
    );
    map.set(key, inserted.rows[0]!.id);
  }
  return map;
}

async function seedStaff(
  client: pg.Client,
  input: {
    organisationId: string;
    userId: string;
    jobTitle: string;
    employeeNumber: string;
  },
): Promise<string> {
  const inserted = await client.query<IdRow>(
    `insert into staff_profiles (
       organisation_id, user_id, job_title, employee_number, started_on
     ) values ($1, $2, $3, $4, '2020-09-01')
     returning id`,
    [input.organisationId, input.userId, input.jobTitle, input.employeeNumber],
  );
  return inserted.rows[0]!.id;
}

async function seedStudent(
  client: pg.Client,
  input: {
    organisationId: string;
    academicYearId: string;
    yearGroupId: string;
    classId: string;
    houseId?: string | null;
    legalName: string;
    preferredName?: string;
    admissionNumber: string;
    dateOfBirth: string;
    loginAlias?: string;
    passwordHash?: string;
  },
): Promise<{ profileId: string; userId: string }> {
  const userId = await insertUser(client, {
    fullName: input.legalName,
    preferredName: input.preferredName ?? null,
    kind: "student",
    passwordHash: input.passwordHash ?? null,
    dateOfBirth: input.dateOfBirth,
  });
  await addMembership(client, input.organisationId, userId, "school.student");
  if (input.loginAlias) {
    await client.query(
      "insert into user_login_aliases (organisation_id, user_id, alias) values ($1, $2, $3)",
      [input.organisationId, userId, input.loginAlias],
    );
  }
  const profile = await client.query<IdRow>(
    `insert into student_profiles (
       organisation_id, user_id, admission_number, enrolment_status, legal_name
     ) values ($1, $2, $3, 'enrolled', $4)
     returning id`,
    [input.organisationId, userId, input.admissionNumber, input.legalName],
  );
  const profileId = profile.rows[0]!.id;
  await client.query(
    `insert into student_enrolments (
       organisation_id, student_profile_id, academic_year_id, year_group_id, house_id,
       status, is_primary, placement_kind, started_on
     ) values ($1, $2, $3, $4, $5, 'enrolled', true, 'primary', '2026-09-01')`,
    [input.organisationId, profileId, input.academicYearId, input.yearGroupId, input.houseId ?? null],
  );
  await client.query(
    `insert into class_memberships (
       organisation_id, class_id, student_profile_id, academic_year_id, started_on
     ) values ($1, $2, $3, $4, '2026-09-01')`,
    [input.organisationId, input.classId, profileId, input.academicYearId],
  );
  return { profileId, userId };
}

async function seedStudentDocument(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    title: string;
    documentType: string;
    visibility: string;
    createdBy: string;
  },
): Promise<void> {
  await client.query(
    `insert into student_documents (
       organisation_id, student_profile_id, title, document_type, visibility, created_by
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.organisationId,
      input.studentProfileId,
      input.title,
      input.documentType,
      input.visibility,
      input.createdBy,
    ],
  );
}

async function seedGuardian(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    userId: string;
    relationship: string;
    priority?: number;
  },
): Promise<void> {
  await client.query(
    `insert into guardianships (
       organisation_id, student_profile_id, guardian_user_id, relationship,
       has_parental_responsibility, is_emergency_contact, lives_with_student,
       restricted_contact, portal_access, priority, started_on
     ) values ($1, $2, $3, $4, true, true, true, false, true, $5, '2026-09-01')`,
    [
      input.organisationId,
      input.studentProfileId,
      input.userId,
      input.relationship,
      input.priority ?? 1,
    ],
  );
}

async function weekdaysFrom(start: string, count: number): Promise<string[]> {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function seedAttendanceMarks(
  client: pg.Client,
  input: {
    organisationId: string;
    academicYearId: string;
    recordedBy: string;
    pupils: Array<{
      profileId: string;
      classId: string;
      yearGroupId: string;
      pattern: Array<"present" | "late" | "authorised" | "unauthorised" | "not_required">;
    }>;
  },
): Promise<void> {
  const sessions = await client.query<{ id: string; key: string }>(
    `select id, key from attendance_session_types
     where organisation_id = $1 and is_active
     order by sort_order`,
    [input.organisationId],
  );
  const codes = await client.query<{ id: string; code: string }>(
    `select id, code from attendance_codes where organisation_id = $1`,
    [input.organisationId],
  );
  const codeId = (code: string) => codes.rows.find((row) => row.code === code)?.id;
  const dates = await weekdaysFrom("2026-09-01", 8);
  for (const [index, date] of dates.entries()) {
    for (const session of sessions.rows) {
      for (const pupil of input.pupils) {
        const mark = pupil.pattern[(index + (session.key === "pm" ? 1 : 0)) % pupil.pattern.length]!;
        await client.query(
          `insert into attendance_marks (
             organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
             attendance_code_id, late_minutes, reason, note, parent_visible_note, class_id,
             year_group_id, recorded_by, recorded_at
           ) values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13, now())
           on conflict (organisation_id, student_profile_id, mark_date, session_type_id) do nothing`,
          [
            input.organisationId,
            pupil.profileId,
            input.academicYearId,
            session.id,
            date,
            codeId(mark),
            mark === "late" ? 8 : null,
            mark === "authorised" ? "Medical appointment" : mark === "unauthorised" ? "No reason given" : null,
            mark === "authorised" ? "Internal: appointment letter on file" : null,
            mark === "late" ? "Arrived after registration" : null,
            pupil.classId,
            pupil.yearGroupId,
            input.recordedBy,
          ],
        );
      }
    }
  }
}

async function notify(
  client: pg.Client,
  input: {
    organisationId: string;
    recipientUserId: string;
    createdBy: string;
    type: string;
    category: string;
    title: string;
    body: string;
  },
): Promise<void> {
  await client.query(
    `insert into notifications (
       organisation_id, recipient_user_id, type, category, title, body, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.organisationId,
      input.recipientUserId,
      input.type,
      input.category,
      input.title,
      input.body,
      input.createdBy,
    ],
  );
}

async function insertEnquiry(
  client: pg.Client,
  input: {
    organisationId: string;
    createdBy: string;
    reference: string;
    status: string;
    pupil: string;
    guardian: string;
    email: string;
    yearGroupId: string;
    academicYearId: string;
    source: string;
    notes: string;
  },
): Promise<string> {
  const inserted = await client.query<IdRow>(
    `insert into admissions_enquiries (
       organisation_id, reference, status, pupil_legal_name, guardian_full_name, guardian_email,
       intended_academic_year_id, intended_year_group_id, source, notes, created_by, enquiry_date
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'2026-08-10')
     returning id`,
    [
      input.organisationId,
      input.reference,
      input.status,
      input.pupil,
      input.guardian,
      input.email,
      input.academicYearId,
      input.yearGroupId,
      input.source,
      input.notes,
      input.createdBy,
    ],
  );
  return inserted.rows[0]!.id;
}

async function insertApplication(
  client: pg.Client,
  input: {
    organisationId: string;
    createdBy: string;
    reference: string;
    status: string;
    pupil: string;
    yearGroupId: string;
    academicYearId: string;
    enquiryId?: string | null;
    previousSchool?: string;
  },
): Promise<string> {
  const inserted = await client.query<IdRow>(
    `insert into admissions_applications (
       organisation_id, reference, enquiry_id, status, pupil_legal_name,
       intended_academic_year_id, intended_year_group_id, intended_entry_date,
       previous_school, application_date, submitted_at, source, created_by
     ) values (
       $1,$2,$3,$4,$5,$6,$7,'2026-09-01',$8,'2026-08-12',
       case when $4 in ('draft','enquiry') then null else now() end,
       'demo-seed', $9
     )
     returning id`,
    [
      input.organisationId,
      input.reference,
      input.enquiryId ?? null,
      input.status,
      input.pupil,
      input.academicYearId,
      input.yearGroupId,
      input.previousSchool ?? "Local primary",
      input.createdBy,
    ],
  );
  const id = inserted.rows[0]!.id;
  await client.query(
    `insert into admissions_application_status_history (
       organisation_id, application_id, previous_status, new_status, reason, actor_user_id
     ) values ($1, $2, null, $3, 'Demo seed', $4)`,
    [input.organisationId, id, input.status, input.createdBy],
  );
  if (input.enquiryId) {
    await client.query(
      "update admissions_enquiries set converted_application_id = $2, status = 'converted' where id = $1",
      [input.enquiryId, id],
    );
  }
  return id;
}

async function seedGreenwood(
  client: pg.Client,
  hashes: Record<string, string>,
): Promise<{ orgId: string; accounts: DemoSeedResult["accounts"] }> {
  const orgId = await createOrganisation(client, DEMO_ORGANISATIONS.greenwood);
  const year = await client.query<IdRow>(
    `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
     values ($1, '2026/27', '2026-09-01', '2027-07-31', true)
     returning id`,
    [orgId],
  );
  const academicYearId = year.rows[0]!.id;
  await seedTerms(client, orgId, academicYearId);
  const yearGroups = await seedYearGroups(client, orgId);
  const subjects = await seedSubjects(client, orgId);
  const oakHouse = await client.query<IdRow>(
    "insert into houses (organisation_id, name) values ($1, 'Oak') returning id",
    [orgId],
  );
  await client.query("insert into houses (organisation_id, name) values ($1, 'Willow')", [orgId]);
  await client.query("insert into houses (organisation_id, name) values ($1, 'Beech')", [orgId]);

  const classIds = new Map<string, string>();
  for (const row of [
    { name: "3A", year: "3" },
    { name: "3B", year: "3" },
    { name: "4A", year: "4" },
    { name: "5A", year: "5" },
    { name: "6A", year: "6" },
    { name: "7A", year: "7" },
  ]) {
    const inserted = await client.query<IdRow>(
      `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
       values ($1, $2, $3, $4, 'form') returning id`,
      [orgId, academicYearId, yearGroups.get(row.year), row.name],
    );
    classIds.set(row.name, inserted.rows[0]!.id);
    await client.query(
      "insert into class_subjects (organisation_id, class_id, subject_id) values ($1, $2, $3)",
      [orgId, inserted.rows[0]!.id, subjects.get("english")],
    );
  }
  const mathsSet = await client.query<IdRow>(
    `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
     values ($1, $2, $3, 'Maths 5', 'teaching') returning id`,
    [orgId, academicYearId, yearGroups.get("5")],
  );
  await client.query(
    "insert into class_subjects (organisation_id, class_id, subject_id) values ($1, $2, $3)",
    [orgId, mathsSet.rows[0]!.id, subjects.get("mathematics")],
  );

  const adminId = await insertUser(client, {
    email: DEMO_ACCOUNTS.greenwoodAdmin.email,
    fullName: DEMO_ACCOUNTS.greenwoodAdmin.fullName,
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodAdmin.password],
  });
  await addMembership(client, orgId, adminId, "school.admin");
  const adminStaffId = await seedStaff(client, {
    organisationId: orgId,
    userId: adminId,
    jobTitle: "School Business Manager",
    employeeNumber: "GW-001",
  });

  const headId = await insertUser(client, {
    email: DEMO_ACCOUNTS.greenwoodHeadteacher.email,
    fullName: DEMO_ACCOUNTS.greenwoodHeadteacher.fullName,
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodHeadteacher.password],
  });
  await addMembership(client, orgId, headId, "school.headteacher");
  await seedStaff(client, {
    organisationId: orgId,
    userId: headId,
    jobTitle: "Headteacher",
    employeeNumber: "GW-002",
  });

  const teacherId = await insertUser(client, {
    email: DEMO_ACCOUNTS.greenwoodTeacher.email,
    fullName: DEMO_ACCOUNTS.greenwoodTeacher.fullName,
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodTeacher.password],
  });
  await addMembership(client, orgId, teacherId, "school.teacher");
  const teacherStaffId = await seedStaff(client, {
    organisationId: orgId,
    userId: teacherId,
    jobTitle: "Year 3 class teacher",
    employeeNumber: "GW-003",
  });
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'form_tutor', '2026-09-01')`,
    [orgId, classIds.get("3A"), teacherStaffId],
  );

  const extraTeacher = await insertUser(client, {
    email: "demo.teacher2@greenwood.test",
    fullName: "Daniel Okonkwo",
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodTeacher.password],
  });
  await addMembership(client, orgId, extraTeacher, "school.teacher");
  const extraStaffId = await seedStaff(client, {
    organisationId: orgId,
    userId: extraTeacher,
    jobTitle: "Year 4 class teacher",
    employeeNumber: "GW-004",
  });
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'form_tutor', '2026-09-01')`,
    [orgId, classIds.get("4A"), extraStaffId],
  );

  const parentId = await insertUser(client, {
    email: DEMO_ACCOUNTS.greenwoodParent.email,
    fullName: DEMO_ACCOUNTS.greenwoodParent.fullName,
    kind: "parent",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodParent.password],
  });
  await addMembership(client, orgId, parentId, "school.parent");

  const secondParentId = await insertUser(client, {
    email: "demo.parent2@greenwood.test",
    fullName: "Tom Ellis",
    kind: "parent",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodParent.password],
  });
  await addMembership(client, orgId, secondParentId, "school.parent");

  const amelia = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    classId: classIds.get("3A")!,
    houseId: oakHouse.rows[0]!.id,
    legalName: DEMO_ACCOUNTS.greenwoodStudent.fullName,
    preferredName: "Amelia",
    admissionNumber: "GW-2026-001",
    dateOfBirth: "2018-04-12",
    loginAlias: DEMO_ACCOUNTS.greenwoodStudent.username,
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodStudent.password],
  });
  const jack = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    classId: classIds.get("3A")!,
    houseId: oakHouse.rows[0]!.id,
    legalName: "Jack Brennan",
    preferredName: "Jack",
    admissionNumber: "GW-2026-007",
    dateOfBirth: "2018-08-21",
  });
  const priya = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    classId: classIds.get("3A")!,
    houseId: oakHouse.rows[0]!.id,
    legalName: "Priya Shah",
    preferredName: "Priya",
    admissionNumber: "GW-2026-008",
    dateOfBirth: "2018-03-04",
  });
  const yusuf = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("5")!,
    classId: classIds.get("5A")!,
    legalName: "Yusuf Khan",
    admissionNumber: "GW-2026-002",
    dateOfBirth: "2016-09-03",
  });
  const maya = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    classId: classIds.get("3B")!,
    legalName: "Maya Ellis",
    admissionNumber: "GW-2026-003",
    dateOfBirth: "2018-01-22",
  });
  const oliver = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("4")!,
    classId: classIds.get("4A")!,
    legalName: "Oliver Brooks",
    admissionNumber: "GW-2026-004",
    dateOfBirth: "2017-06-18",
  });
  const sophie = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("6")!,
    classId: classIds.get("6A")!,
    legalName: "Sophie Chen",
    admissionNumber: "GW-2026-005",
    dateOfBirth: "2015-11-09",
  });
  const leo = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("7")!,
    classId: classIds.get("7A")!,
    legalName: "Leo Nwosu",
    admissionNumber: "GW-2026-006",
    dateOfBirth: "2014-02-27",
  });

  await seedGuardian(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    userId: parentId,
    relationship: "mother",
  });
  await seedGuardian(client, {
    organisationId: orgId,
    studentProfileId: yusuf.profileId,
    userId: parentId,
    relationship: "mother",
  });
  await seedGuardian(client, {
    organisationId: orgId,
    studentProfileId: maya.profileId,
    userId: secondParentId,
    relationship: "father",
  });

  await seedAttendanceMarks(client, {
    organisationId: orgId,
    academicYearId,
    recordedBy: teacherId,
    pupils: [
      {
        profileId: amelia.profileId,
        classId: classIds.get("3A")!,
        yearGroupId: yearGroups.get("3")!,
        pattern: ["present", "present", "late", "present", "authorised", "present", "present", "unauthorised"],
      },
      {
        profileId: jack.profileId,
        classId: classIds.get("3A")!,
        yearGroupId: yearGroups.get("3")!,
        pattern: ["present", "unauthorised", "present", "late", "present", "present", "authorised", "present"],
      },
      {
        profileId: priya.profileId,
        classId: classIds.get("3A")!,
        yearGroupId: yearGroups.get("3")!,
        pattern: ["present", "present", "present", "present", "late", "present", "present", "present"],
      },
      {
        profileId: maya.profileId,
        classId: classIds.get("3B")!,
        yearGroupId: yearGroups.get("3")!,
        pattern: ["present", "authorised", "authorised", "present", "present", "late", "present", "present"],
      },
      {
        profileId: oliver.profileId,
        classId: classIds.get("4A")!,
        yearGroupId: yearGroups.get("4")!,
        pattern: ["present", "late", "present", "unauthorised", "present", "present", "late", "present"],
      },
      {
        profileId: yusuf.profileId,
        classId: classIds.get("5A")!,
        yearGroupId: yearGroups.get("5")!,
        pattern: ["present", "present", "present", "late", "present", "authorised", "present", "present"],
      },
      {
        profileId: sophie.profileId,
        classId: classIds.get("6A")!,
        yearGroupId: yearGroups.get("6")!,
        pattern: ["present", "not_required", "present", "present", "late", "present", "present", "authorised"],
      },
      {
        profileId: leo.profileId,
        classId: classIds.get("7A")!,
        yearGroupId: yearGroups.get("7")!,
        pattern: ["present", "present", "unauthorised", "present", "present", "late", "present", "present"],
      },
    ],
  });

  await seedStudentDocument(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    title: "Autumn term welcome letter",
    documentType: "letter",
    visibility: "staff_and_parents",
    createdBy: adminId,
  });
  await seedStudentDocument(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    title: "Internal support note",
    documentType: "support",
    visibility: "staff",
    createdBy: adminId,
  });

  const year3 = yearGroups.get("3")!;
  await insertEnquiry(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "ENQ-2026-0001",
    status: "open",
    pupil: "Isla Bennett",
    guardian: "Claire Bennett",
    email: "claire.bennett@example.test",
    yearGroupId: year3,
    academicYearId,
    source: "school-tour",
    notes: "Interested in Year 3 place for 2026/27.",
  });
  const convertedEnquiry = await insertEnquiry(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "ENQ-2026-0002",
    status: "contacted",
    pupil: "Noah Patel",
    guardian: "Anita Patel",
    email: "anita.patel@example.test",
    yearGroupId: yearGroups.get("4")!,
    academicYearId,
    source: "website",
    notes: "Converted to application after tour.",
  });
  await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0001",
    status: "submitted",
    pupil: "Noah Patel",
    yearGroupId: yearGroups.get("4")!,
    academicYearId,
    enquiryId: convertedEnquiry,
  });
  const reviewApp = await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0002",
    status: "under_review",
    pupil: "Freya Walsh",
    yearGroupId: year3,
    academicYearId,
  });
  await client.query(
    `insert into admissions_application_contacts (
       organisation_id, application_id, full_name, email, relationship, is_primary,
       has_parental_responsibility
     ) values ($1, $2, 'Siobhan Walsh', 'siobhan.walsh@example.test', 'mother', true, true)`,
    [orgId, reviewApp],
  );
  const assessApp = await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0003",
    status: "assessment_pending",
    pupil: "Arthur Green",
    yearGroupId: yearGroups.get("7")!,
    academicYearId,
  });
  await client.query(
    `insert into admissions_assessments (
       organisation_id, application_id, assessment_type, status, scheduled_at,
       assigned_staff_profile_id, created_by
     ) values ($1, $2, 'admissions_interview', 'scheduled', '2026-09-08 10:00:00+00', $3, $4)`,
    [orgId, assessApp, adminStaffId, adminId],
  );
  const waitApp = await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0004",
    status: "waiting_list",
    pupil: "Chloe Rahman",
    yearGroupId: year3,
    academicYearId,
  });
  await client.query(
    `insert into admissions_waiting_list_entries (
       organisation_id, application_id, intended_academic_year_id, intended_year_group_id,
       status, notes, created_by
     ) values ($1, $2, $3, $4, 'active', 'Year 3 waiting list — demo', $5)`,
    [orgId, waitApp, academicYearId, year3, adminId],
  );
  const offerApp = await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0005",
    status: "offer_made",
    pupil: "Ethan Hughes",
    yearGroupId: yearGroups.get("5")!,
    academicYearId,
  });
  await client.query(
    `insert into admissions_offers (
       organisation_id, application_id, status, offered_academic_year_id, offered_year_group_id,
       intended_start_date, offer_made_on, response_deadline, created_by
     ) values ($1, $2, 'made', $3, $4, '2026-09-01', current_date, current_date + 14, $5)`,
    [orgId, offerApp, academicYearId, yearGroups.get("5"), adminId],
  );
  await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0006",
    status: "withdrawn",
    pupil: "Harper Singh",
    yearGroupId: year3,
    academicYearId,
  });
  await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0007",
    status: "rejected",
    pupil: "George Quinn",
    yearGroupId: yearGroups.get("7")!,
    academicYearId,
  });
  await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0008",
    status: "draft",
    pupil: "Ava Robinson",
    yearGroupId: yearGroups.get("R")!,
    academicYearId,
  });

  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: adminId,
    type: "school_announcement",
    category: "announcement",
    title: "Autumn term starts 1 September",
    body: "Welcome back to Greenwood Academy. Please check the parent portal for class and form details.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: adminId,
    type: "admissions_update",
    category: "admissions",
    title: "Open morning reminder",
    body: "Year 3 families can still book a short tour next week. This is a demo notification.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: amelia.userId,
    createdBy: teacherId,
    type: "general",
    category: "general",
    title: "Welcome to Year 3A",
    body: "Hello Amelia — your form tutor is Hannah Cole. Homework and quizzes will appear here later.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: teacherId,
    createdBy: adminId,
    type: "general",
    category: "general",
    title: "Staff briefing (demo)",
    body: "INSET day is 2 September. Registers open from 1 September — take AM and PM for your form class.",
  });

  return {
    orgId,
    accounts: [
      { key: DEMO_ACCOUNTS.greenwoodAdmin.key, userId: adminId, email: DEMO_ACCOUNTS.greenwoodAdmin.email },
      {
        key: DEMO_ACCOUNTS.greenwoodHeadteacher.key,
        userId: headId,
        email: DEMO_ACCOUNTS.greenwoodHeadteacher.email,
      },
      {
        key: DEMO_ACCOUNTS.greenwoodTeacher.key,
        userId: teacherId,
        email: DEMO_ACCOUNTS.greenwoodTeacher.email,
      },
      { key: DEMO_ACCOUNTS.greenwoodParent.key, userId: parentId, email: DEMO_ACCOUNTS.greenwoodParent.email },
      {
        key: DEMO_ACCOUNTS.greenwoodStudent.key,
        userId: amelia.userId,
        username: DEMO_ACCOUNTS.greenwoodStudent.username,
      },
    ],
  };
}

async function seedOakAcademy(
  client: pg.Client,
  hashes: Record<string, string>,
): Promise<{ orgId: string; accounts: DemoSeedResult["accounts"] }> {
  const orgId = await createOrganisation(client, DEMO_ORGANISATIONS.oakacademy);
  const year = await client.query<IdRow>(
    `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
     values ($1, '2026/27', '2026-09-01', '2027-07-31', true)
     returning id`,
    [orgId],
  );
  const academicYearId = year.rows[0]!.id;
  await seedTerms(client, orgId, academicYearId);
  const yearGroups = await seedYearGroups(client, orgId);
  const subjects = await seedSubjects(client, orgId);
  await client.query("insert into houses (organisation_id, name) values ($1, 'Hart')", [orgId]);

  const class3 = await client.query<IdRow>(
    `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
     values ($1, $2, $3, '3A', 'form') returning id`,
    [orgId, academicYearId, yearGroups.get("3")],
  );
  const class5 = await client.query<IdRow>(
    `insert into classes (organisation_id, academic_year_id, year_group_id, name, class_type)
     values ($1, $2, $3, '5A', 'form') returning id`,
    [orgId, academicYearId, yearGroups.get("5")],
  );
  await client.query(
    "insert into class_subjects (organisation_id, class_id, subject_id) values ($1, $2, $3)",
    [orgId, class3.rows[0]!.id, subjects.get("english")],
  );

  const adminId = await insertUser(client, {
    email: DEMO_ACCOUNTS.oakAdmin.email,
    fullName: DEMO_ACCOUNTS.oakAdmin.fullName,
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.oakAdmin.password],
  });
  await addMembership(client, orgId, adminId, "school.admin");
  await seedStaff(client, {
    organisationId: orgId,
    userId: adminId,
    jobTitle: "School Administrator",
    employeeNumber: "OA-001",
  });

  const teacherId = await insertUser(client, {
    email: DEMO_EXTRA_ACCOUNTS.oakTeacher.email,
    fullName: DEMO_EXTRA_ACCOUNTS.oakTeacher.fullName,
    kind: "staff",
    passwordHash: hashes[DEMO_EXTRA_ACCOUNTS.oakTeacher.password],
  });
  await addMembership(client, orgId, teacherId, "school.teacher");
  const teacherStaffId = await seedStaff(client, {
    organisationId: orgId,
    userId: teacherId,
    jobTitle: "Class teacher",
    employeeNumber: "OA-002",
  });
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'form_tutor', '2026-09-01')`,
    [orgId, class3.rows[0]!.id, teacherStaffId],
  );

  const parentId = await insertUser(client, {
    email: DEMO_EXTRA_ACCOUNTS.oakParent.email,
    fullName: DEMO_EXTRA_ACCOUNTS.oakParent.fullName,
    kind: "parent",
    passwordHash: hashes[DEMO_EXTRA_ACCOUNTS.oakParent.password],
  });
  await addMembership(client, orgId, parentId, "school.parent");

  const niamh = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    classId: class3.rows[0]!.id,
    legalName: DEMO_EXTRA_ACCOUNTS.oakStudent.fullName,
    preferredName: "Niamh",
    admissionNumber: "OA-2026-001",
    dateOfBirth: "2018-07-19",
    loginAlias: DEMO_EXTRA_ACCOUNTS.oakStudent.username,
    passwordHash: hashes[DEMO_EXTRA_ACCOUNTS.oakStudent.password],
  });
  const ethan = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("5")!,
    classId: class5.rows[0]!.id,
    legalName: "Ethan Cole",
    admissionNumber: "OA-2026-002",
    dateOfBirth: "2016-03-14",
  });
  await seedGuardian(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    userId: parentId,
    relationship: "mother",
  });

  await seedAttendanceMarks(client, {
    organisationId: orgId,
    academicYearId,
    recordedBy: teacherId,
    pupils: [
      {
        profileId: niamh.profileId,
        classId: class3.rows[0]!.id,
        yearGroupId: yearGroups.get("3")!,
        pattern: ["present", "late", "present", "authorised", "present", "present", "unauthorised", "present"],
      },
      {
        profileId: ethan.profileId,
        classId: class5.rows[0]!.id,
        yearGroupId: yearGroups.get("5")!,
        pattern: ["present", "present", "late", "present", "present", "present", "present", "authorised"],
      },
    ],
  });
  await seedStudentDocument(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    title: "Oak Academy induction letter",
    documentType: "letter",
    visibility: "staff",
    createdBy: adminId,
  });

  await insertEnquiry(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "ENQ-2026-0001",
    status: "open",
    pupil: "Ruby Adeyemi",
    guardian: "Tunde Adeyemi",
    email: "tunde.adeyemi@example.test",
    yearGroupId: yearGroups.get("3")!,
    academicYearId,
    source: "open-evening",
    notes: "Oak Academy demo enquiry — must not appear at Greenwood.",
  });
  await insertApplication(client, {
    organisationId: orgId,
    createdBy: adminId,
    reference: "APP-2026-0001",
    status: "submitted",
    pupil: "Ruby Adeyemi",
    yearGroupId: yearGroups.get("3")!,
    academicYearId,
  });

  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: adminId,
    type: "school_announcement",
    category: "announcement",
    title: "Oak Academy parent welcome",
    body: "This notice belongs to Oak Academy only. Greenwood users must never see it.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: niamh.userId,
    createdBy: teacherId,
    type: "general",
    category: "general",
    title: "Hello from Oak Academy",
    body: "Niamh, this is your Oak Academy student inbox. It is separate from Greenwood.",
  });

  return {
    orgId,
    accounts: [
      { key: DEMO_ACCOUNTS.oakAdmin.key, userId: adminId, email: DEMO_ACCOUNTS.oakAdmin.email },
      {
        key: DEMO_EXTRA_ACCOUNTS.oakTeacher.key,
        userId: teacherId,
        email: DEMO_EXTRA_ACCOUNTS.oakTeacher.email,
      },
      { key: DEMO_EXTRA_ACCOUNTS.oakParent.key, userId: parentId, email: DEMO_EXTRA_ACCOUNTS.oakParent.email },
      {
        key: DEMO_EXTRA_ACCOUNTS.oakStudent.key,
        userId: niamh.userId,
        username: DEMO_EXTRA_ACCOUNTS.oakStudent.username,
      },
    ],
  };
}

export async function seedDemo(options: DemoSeedOptions): Promise<DemoSeedResult> {
  const env = options.env ?? process.env;
  assertDemoSeedAllowed({
    NODE_ENV: env.NODE_ENV,
    ALLOW_DEMO_SEED: env.ALLOW_DEMO_SEED,
    PLATFORM_DOMAIN: env.PLATFORM_DOMAIN ?? "localhost",
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_OWNER_URL: options.ownerUrl,
  });

  const uniquePasswords = [...new Set(ALL_DEMO_LOGINS.map((account) => account.password))];
  const hashes: Record<string, string> = {};
  await Promise.all(
    uniquePasswords.map(async (password) => {
      hashes[password] = await hashPassword(password);
    }),
  );

  const client = new pg.Client({ connectionString: options.ownerUrl });
  await client.connect();
  try {
    await client.query("begin");
    await wipeDemoData(client);

    const platformId = await insertUser(client, {
      email: DEMO_ACCOUNTS.platformAdmin.email,
      fullName: DEMO_ACCOUNTS.platformAdmin.fullName,
      kind: "platform_admin",
      passwordHash: hashes[DEMO_ACCOUNTS.platformAdmin.password],
    });
    await client.query("insert into platform_admins (user_id) values ($1) on conflict do nothing", [platformId]);

    const greenwood = await seedGreenwood(client, hashes);
    const oak = await seedOakAcademy(client, hashes);
    await client.query("commit");

    return {
      organisations: [
        { id: greenwood.orgId, ...DEMO_ORGANISATIONS.greenwood },
        { id: oak.orgId, ...DEMO_ORGANISATIONS.oakacademy },
      ],
      accounts: [
        { key: DEMO_ACCOUNTS.platformAdmin.key, userId: platformId, email: DEMO_ACCOUNTS.platformAdmin.email },
        ...greenwood.accounts,
        ...oak.accounts,
      ],
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection may already be broken.
    }
    throw error;
  } finally {
    await client.end();
  }
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (isMain) {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    console.error("DATABASE_OWNER_URL is required");
    process.exit(1);
  }
  seedDemo({ ownerUrl })
    .then((result) => {
      console.log("Demo environment seeded.");
      for (const org of result.organisations) {
        console.log(`- ${org.name} (${org.slug}) ${org.id}`);
      }
      console.log("");
      console.log(formatDemoCredentials());
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
