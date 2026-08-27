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
      "update learning_submissions set current_revision_id = null where organisation_id = any($1::uuid[])",
      [orgIds],
    );
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
    await client.query(
      `update message_conversations
       set last_message_id = null
       where organisation_id = any($1::uuid[])`,
      [orgIds],
    );
    await client.query(
      `update message_participants
       set last_read_message_id = null
       where organisation_id = any($1::uuid[])`,
      [orgIds],
    );

    const tenantDeletes = [
      "learning_activity_answers",
      "learning_activity_attempts",
      "learning_activity_recipients",
      "learning_activity_targets",
      "learning_activity_assignments",
      "learning_activity_items",
      "learning_activity_definitions",
      "competition_results",
      "competition_manual_scores",
      "competition_targets",
      "competitions",
      "pupil_achievements",
      "achievement_definitions",
      "pupil_xp_events",
      "pupil_rewards",
      "reward_categories",
      "engagement_year_group_policies",
      "engagement_settings",
      "census_validation_issues",
      "census_snapshot_pupils",
      "census_snapshot_schools",
      "data_exports",
      "census_runs",
      "student_fsm_periods",
      "student_statutory_profiles",
      "organisation_statutory_profiles",
      "message_attachments",
      "messages",
      "message_participants",
      "message_conversations",
      "message_counters",
      "school_payment_receipts",
      "school_payment_refunds",
      "school_payment_provider_events",
      "school_payment_sessions",
      "school_payment_transactions",
      "school_charge_adjustments",
      "school_charges",
      "school_charge_categories",
      "school_payment_provider_configs",
      "school_finance_counters",
      "timetable_covers",
      "timetable_exceptions",
      "timetable_entry_teachers",
      "timetable_entries",
      "school_day_periods",
      "school_day_profiles",
      "rooms",
      "school_activity_updates",
      "school_activity_documents",
      "school_activity_responses",
      "school_activity_participants",
      "school_activity_consent_clauses",
      "school_activity_staff",
      "school_activity_eligible_pupils",
      "school_activity_targets",
      "school_activity_status_history",
      "school_activities",
      "school_activity_types",
      "safeguarding_attachments",
      "safeguarding_chronology_entries",
      "safeguarding_concern_revisions",
      "safeguarding_concerns",
      "pastoral_record_attachments",
      "pastoral_interventions",
      "pastoral_concern_revisions",
      "pastoral_concerns",
      "behaviour_action_revisions",
      "behaviour_actions",
      "behaviour_incident_witnesses",
      "behaviour_incident_related_pupils",
      "behaviour_incident_revisions",
      "behaviour_incidents",
      "positive_behaviour_records",
      "behaviour_incident_categories",
      "behaviour_action_categories",
      "positive_behaviour_categories",
      "behaviour_locations",
      "pastoral_concern_categories",
      "safeguarding_concern_categories",
      "announcement_recipient_subjects",
      "announcement_recipients",
      "announcement_resources",
      "announcement_targets",
      "announcement_status_history",
      "announcements",
      "school_event_audience_subjects",
      "school_event_audience",
      "school_event_resources",
      "school_event_targets",
      "school_event_status_history",
      "school_events",
      "school_event_types",
      "admissions_form_documents",
      "student_medication_revisions",
      "student_medications",
      "student_dietary_requirement_revisions",
      "student_dietary_requirements",
      "student_additional_needs",
      "admissions_form_submissions",
      "admissions_form_fields",
      "admissions_form_sections",
      "academic_report_publications",
      "academic_report_status_history",
      "academic_report_sections",
      "academic_reports",
      "academic_result_revisions",
      "academic_results",
      "academic_assessment_inclusions",
      "academic_assessment_classes",
      "academic_assessment_status_history",
      "academic_assessments",
      "academic_targets",
      "academic_reporting_periods",
      "academic_grade_scheme_levels",
      "academic_grade_schemes",
      "academic_assessment_types",
      "learning_submission_attachments",
      "learning_marks",
      "learning_submission_revisions",
      "learning_submissions",
      "learning_assignment_resources",
      "learning_assignment_recipients",
      "learning_assignment_targets",
      "learning_assignment_status_history",
      "learning_resources",
      "learning_assignments",
      "learning_work_types",
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
      "admissions_forms",
      "admissions_campaigns",
      "admissions_counters",
      "class_subjects",
      "class_staff_assignments",
      "class_memberships",
      "student_enrolments",
      "guardianships",
      "notification_preferences",
      "user_login_aliases",
      "stored_objects",
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
  await client.query(
    `insert into organisation_settings (organisation_id, extras)
     values ($1, '{"branding":{"primaryColor":"#1e3a5f","logoUrl":null}}'::jsonb)`,
    [id],
  );
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
    startedOn?: string;
    endedOn?: string | null;
    enrolmentStatus?: "enrolled" | "left" | "alumni";
  },
): Promise<{ profileId: string; userId: string }> {
  const startedOn = input.startedOn ?? "2026-09-01";
  const enrolmentStatus = input.enrolmentStatus ?? "enrolled";
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
     ) values ($1, $2, $3, $4, $5)
     returning id`,
    [input.organisationId, userId, input.admissionNumber, enrolmentStatus, input.legalName],
  );
  const profileId = profile.rows[0]!.id;
  await client.query(
    `insert into student_enrolments (
       organisation_id, student_profile_id, academic_year_id, year_group_id, house_id,
       status, is_primary, placement_kind, started_on, ended_on
     ) values ($1, $2, $3, $4, $5, $6, true, 'primary', $7, $8)`,
    [
      input.organisationId,
      profileId,
      input.academicYearId,
      input.yearGroupId,
      input.houseId ?? null,
      enrolmentStatus === "left" ? "withdrawn" : "enrolled",
      startedOn,
      input.endedOn ?? null,
    ],
  );
  await client.query(
    `insert into class_memberships (
       organisation_id, class_id, student_profile_id, academic_year_id, started_on, ended_on
     ) values ($1, $2, $3, $4, $5, $6)`,
    [input.organisationId, input.classId, profileId, input.academicYearId, startedOn, input.endedOn ?? null],
  );
  return { profileId, userId };
}

async function seedEngagementDemo(
  client: pg.Client,
  input: {
    organisationId: string;
    actorUserId: string;
    teacherUserId: string;
    yearGroups: Map<string, string>;
    classIds: Map<string, string>;
    subjects: Map<string, string>;
    houseId: string | null;
    ameliaId?: string;
    jackId?: string;
    variant: "greenwood" | "oak";
  },
): Promise<void> {
  await client.query("select ensure_organisation_phase19_defaults($1)", [input.organisationId]);
  if (input.variant === "greenwood") {
    await client.query(
      `update engagement_settings set
         leaderboards_enabled = true,
         allow_individual_leaderboard = false,
         allow_class_leaderboard = true,
         allow_house_leaderboard = true,
         anonymise_pupil_leaderboard = true,
         leaderboard_display_name_policy = 'first_name_initial',
         competitions_enabled = true,
         early_learning_enabled = true,
         xp_enabled = true
       where organisation_id = $1`,
      [input.organisationId],
    );
    for (const [code, flags] of [
      ["R", { early: true, parent: true, friendly: true, board: false, challenges: false, competitions: false }],
      ["1", { early: true, parent: true, friendly: true, board: false, challenges: false, competitions: false }],
      ["2", { early: true, parent: true, friendly: true, board: false, challenges: true, competitions: false }],
      ["3", { early: false, parent: false, friendly: false, board: true, challenges: true, competitions: true }],
    ] as const) {
      const yearGroupId = input.yearGroups.get(code);
      if (!yearGroupId) continue;
      await client.query(
        `insert into engagement_year_group_policies (
           organisation_id, year_group_id, early_learning_enabled, parent_assisted_mode, child_friendly_ui,
           leaderboards_enabled, learning_challenges_enabled, competitions_enabled, rewards_enabled
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,true)
         on conflict (year_group_id) do update set
           early_learning_enabled = excluded.early_learning_enabled,
           parent_assisted_mode = excluded.parent_assisted_mode,
           child_friendly_ui = excluded.child_friendly_ui,
           leaderboards_enabled = excluded.leaderboards_enabled,
           learning_challenges_enabled = excluded.learning_challenges_enabled,
           competitions_enabled = excluded.competitions_enabled`,
        [
          input.organisationId,
          yearGroupId,
          flags.early,
          flags.parent,
          flags.friendly,
          flags.board,
          flags.challenges,
          flags.competitions,
        ],
      );
    }
    const reading = await client.query<IdRow>(
      `select id from reward_categories where organisation_id = $1 and key = 'reading_star'`,
      [input.organisationId],
    );
    const kindness = await client.query<IdRow>(
      `select id from reward_categories where organisation_id = $1 and key = 'kindness'`,
      [input.organisationId],
    );
    if (input.ameliaId && reading.rows[0]) {
      await client.query(
        `insert into pupil_rewards (
           organisation_id, student_profile_id, category_id, points, title, pupil_message, awarded_by, house_id, source_type
         ) values ($1,$2,$3,5,'Reading Star','Amelia read beautifully this week.',$4,$5,'manual')`,
        [input.organisationId, input.ameliaId, reading.rows[0].id, input.teacherUserId, input.houseId],
      );
    }
    if (input.jackId && kindness.rows[0]) {
      await client.query(
        `insert into pupil_rewards (
           organisation_id, student_profile_id, category_id, points, title, pupil_message, awarded_by, house_id, source_type
         ) values ($1,$2,$3,5,'Kindness','Jack helped a classmate without being asked.',$4,$5,'manual')`,
        [input.organisationId, input.jackId, kindness.rows[0].id, input.teacherUserId, input.houseId],
      );
    }
    const readingDef = await client.query<IdRow>(
      `select id from achievement_definitions where organisation_id = $1 and key = 'reading_star'`,
      [input.organisationId],
    );
    if (input.ameliaId && readingDef.rows[0]) {
      await client.query(
        `insert into pupil_achievements (
           organisation_id, student_profile_id, definition_id, awarded_by, source
         ) values ($1,$2,$3,$4,'manual')
         on conflict do nothing`,
        [input.organisationId, input.ameliaId, readingDef.rows[0].id, input.teacherUserId],
      );
    }
    if (input.houseId) {
      const competition = await client.query<IdRow>(
        `insert into competitions (
           organisation_id, title, description, competition_type, scoring_model, status,
           student_visible, parent_visible, created_by
         ) values ($1,'Greenwood House Reading Challenge','House points from reading rewards.','house','reward_points','active',true,true,$2)
         returning id`,
        [input.organisationId, input.actorUserId],
      );
      await client.query(
        `insert into competition_targets (organisation_id, competition_id, target_type)
         values ($1,$2,'whole_school')`,
        [input.organisationId, competition.rows[0]!.id],
      );
    }

    const apples = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Count the Apples 1–10','counting','Count the fruit and choose how many.', 'easy', $2, $3, 10, 'published', $4, '{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("R"), input.subjects.get("mathematics"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, prompt_emoji, item_type, choices, correct_answer, points
       ) values ($1,$2,0,'How many apples?','🍎🍎🍎🍎','single_choice',
         '[{"id":"3","label":"3"},{"id":"4","label":"4"},{"id":"5","label":"5"}]'::jsonb,
         '{"choiceId":"4"}'::jsonb, 1)`,
      [input.organisationId, apples.rows[0]!.id],
    );
    const letters = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Match Uppercase and Lowercase Letters','case_matching','Match the capital letter to the small letter.','easy',$2,$3,10,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("R"), input.subjects.get("english") ?? input.subjects.get("phonics"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, choices, correct_answer, points
       ) values ($1,$2,0,'Match A to a','matching','[{"id":"A","label":"A"},{"id":"a","label":"a"}]'::jsonb,'{"pairs":[["A","a"]]}'::jsonb,1)`,
      [input.organisationId, letters.rows[0]!.id],
    );
    const order = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Number Order to 20','number_ordering','Put the numbers in order.','easy',$2,$3,10,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("1"), input.subjects.get("mathematics"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, choices, correct_answer, points
       ) values ($1,$2,0,'Put 1 then 2','ordering','[{"id":"1","label":"1"},{"id":"2","label":"2"}]'::jsonb,'{"order":["1","2"]}'::jsonb,1)`,
      [input.organisationId, order.rows[0]!.id],
    );
    const sounds = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Beginning Sounds','phonics_matching','Choose the letter that matches the sound.','easy',$2,$3,10,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("1"), input.subjects.get("phonics") ?? input.subjects.get("english"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, choices, correct_answer, points
       ) values ($1,$2,0,'ssssnake starts with','single_choice','[{"id":"s","label":"s"},{"id":"t","label":"t"}]'::jsonb,'{"choiceId":"s"}'::jsonb,1)`,
      [input.organisationId, sounds.rows[0]!.id],
    );
    const addition = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Addition within 20','simple_addition','Add the numbers.','easy',$2,$3,10,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("2"), input.subjects.get("mathematics"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, correct_answer, points
       ) values ($1,$2,0,'7 + 5 =','numeric','{"value":12}'::jsonb,1)`,
      [input.organisationId, addition.rows[0]!.id],
    );
    const spelling = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Simple Spelling','spelling','Type the word.','easy',$2,$3,10,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("2"), input.subjects.get("english"), input.actorUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, correct_answer, points
       ) values ($1,$2,0,'the animal: cat','short_exact_text','{"text":"cat","caseInsensitive":true}'::jsonb,1)`,
      [input.organisationId, spelling.rows[0]!.id],
    );
    const maths = await client.query<IdRow>(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, recommended_year_group_id,
         subject_id, xp_reward, status, created_by, content_payload
       ) values ($1,'Year 3 Maths challenge','challenge','A short times-tables check.','challenge',$2,$3,15,'published',$4,'{"schemaVersion":1}'::jsonb)
       returning id`,
      [input.organisationId, input.yearGroups.get("3"), input.subjects.get("mathematics"), input.teacherUserId],
    );
    await client.query(
      `insert into learning_activity_items (
         organisation_id, activity_id, sort_order, prompt_text, item_type, correct_answer, points
       ) values ($1,$2,0,'4 x 5 =','numeric','{"value":20}'::jsonb,1)`,
      [input.organisationId, maths.rows[0]!.id],
    );

    async function assign(activityId: string, targetType: "year_group" | "class", targetId: string) {
      const assignment = await client.query<IdRow>(
        `insert into learning_activity_assignments (
           organisation_id, activity_id, status, created_by, published_at
         ) values ($1,$2,'published',$3,now()) returning id`,
        [input.organisationId, activityId, input.actorUserId],
      );
      await client.query(
        `insert into learning_activity_targets (
           organisation_id, assignment_id, target_type, year_group_id, class_id
         ) values ($1,$2,$3,$4,$5)`,
        [
          input.organisationId,
          assignment.rows[0]!.id,
          targetType,
          targetType === "year_group" ? targetId : null,
          targetType === "class" ? targetId : null,
        ],
      );
      await client.query(
        `insert into learning_activity_recipients (organisation_id, assignment_id, student_profile_id)
         select distinct $1::uuid, $2::uuid, src.student_profile_id from (
           select cm.student_profile_id
           from class_memberships cm
           join academic_years ay on ay.id = cm.academic_year_id and ay.is_current
           where $3 = 'class' and cm.class_id = $4 and cm.organisation_id = $1
             and (cm.ended_on is null or cm.ended_on >= current_date)
           union
           select se.student_profile_id
           from student_enrolments se
           join academic_years ay on ay.id = se.academic_year_id and ay.is_current
           where $3 = 'year_group' and se.year_group_id = $4 and se.organisation_id = $1
             and se.is_primary and se.ended_on is null and se.status = 'enrolled'
         ) src`,
        [input.organisationId, assignment.rows[0]!.id, targetType, targetId],
      );
    }
    await assign(apples.rows[0]!.id, "year_group", input.yearGroups.get("R")!);
    await assign(letters.rows[0]!.id, "year_group", input.yearGroups.get("R")!);
    await assign(order.rows[0]!.id, "year_group", input.yearGroups.get("1")!);
    await assign(sounds.rows[0]!.id, "year_group", input.yearGroups.get("1")!);
    await assign(addition.rows[0]!.id, "year_group", input.yearGroups.get("2")!);
    await assign(spelling.rows[0]!.id, "year_group", input.yearGroups.get("2")!);
    if (input.classIds.get("3A")) {
      await assign(maths.rows[0]!.id, "class", input.classIds.get("3A")!);
    }
  } else {
    await client.query(
      `update engagement_settings set rewards_enabled = true, competitions_enabled = true
       where organisation_id = $1`,
      [input.organisationId],
    );
    const kindness = await client.query<IdRow>(
      `select id from reward_categories where organisation_id = $1 and key = 'kindness'`,
      [input.organisationId],
    );
    if (input.ameliaId && kindness.rows[0]) {
      await client.query(
        `insert into pupil_rewards (
           organisation_id, student_profile_id, category_id, points, title, pupil_message, awarded_by, source_type
         ) values ($1,$2,$3,3,'Oak kindness','Oak-only reward for isolation tests.',$4,'manual')`,
        [input.organisationId, input.ameliaId, kindness.rows[0].id, input.actorUserId],
      );
    }
    await client.query(
      `insert into learning_activity_definitions (
         organisation_id, title, activity_type, instructions, difficulty, xp_reward, status, created_by, content_payload
       ) values ($1,'Oak counting','counting','Oak-only practice.','easy',5,'published',$2,'{"schemaVersion":1}'::jsonb)`,
      [input.organisationId, input.actorUserId],
    );
  }
}

async function seedStatutoryProfile(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    legalForename: string;
    legalSurname: string;
    middleNames?: string | null;
    sex: "M" | "F";
    upn?: string | null;
    ethnicityCode?: string | null;
    languageCode?: string | null;
    enrolmentStatusCode?: string;
    dateOfAdmission?: string;
    dateOfLeaving?: string | null;
    leavingReasonCode?: string | null;
    previousSchoolName?: string | null;
    sendProvisionCode?: string | null;
    lookedAfterStatus?: "none" | "looked_after" | "previously_looked_after";
    serviceChild?: boolean | null;
  },
): Promise<void> {
  await client.query(
    `insert into student_statutory_profiles (
       student_profile_id, organisation_id, legal_forename, legal_surname, middle_names, sex, upn,
       ethnicity_code, language_code, enrolment_status_code, date_of_admission, date_of_leaving,
       leaving_reason_code, previous_school_name, send_provision_code, looked_after_status, service_child
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      input.studentProfileId,
      input.organisationId,
      input.legalForename,
      input.legalSurname,
      input.middleNames ?? null,
      input.sex,
      input.upn ?? null,
      input.ethnicityCode ?? null,
      input.languageCode ?? null,
      input.enrolmentStatusCode ?? "C",
      input.dateOfAdmission ?? "2026-09-01",
      input.dateOfLeaving ?? null,
      input.leavingReasonCode ?? null,
      input.previousSchoolName ?? null,
      input.sendProvisionCode ?? "N",
      input.lookedAfterStatus ?? "none",
      input.serviceChild ?? false,
    ],
  );
}

async function seedSchoolStatutory(
  client: pg.Client,
  input: {
    organisationId: string;
    statutoryName: string;
    establishmentNumber: string;
    localAuthorityNumber: string;
    urn: string;
  },
): Promise<void> {
  await client.query(
    `insert into organisation_statutory_profiles (
       organisation_id, statutory_name, establishment_number, local_authority_number, urn,
       school_phase, establishment_type, establishment_status, address_line1, address_town,
       address_postcode, timezone
     ) values ($1,$2,$3,$4,$5,'PS','11','1','1 Demo Lane','London','N1 1AA','Europe/London')`,
    [
      input.organisationId,
      input.statutoryName,
      input.establishmentNumber,
      input.localAuthorityNumber,
      input.urn,
    ],
  );
  await client.query(
    `insert into organisation_identifiers (organisation_id, system, identifier)
     values ($1, 'urn', $2)
     on conflict (organisation_id, system) do update set identifier = excluded.identifier`,
    [input.organisationId, input.urn],
  );
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

async function workTypeId(client: pg.Client, organisationId: string, key: string): Promise<string> {
  const result = await client.query<IdRow>(
    "select id from learning_work_types where organisation_id = $1 and key = $2",
    [organisationId, key],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Missing learning work type ${key}`);
  return id;
}

async function seedAssignment(client: pg.Client, input: {
  organisationId: string;
  title: string;
  description: string;
  workTypeKey: string;
  subjectId: string;
  academicYearId: string;
  intendedYearGroupId?: string | null;
  createdBy: string;
  dueAtSql: string;
  teacherNotes?: string | null;
  maximumMarks?: number | null;
  classIds?: string[];
  yearGroupId?: string | null;
  studentIds?: string[];
  resource?: { title: string; kind: string; url: string };
}): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into learning_assignments (
       organisation_id, title, description, work_type_id, subject_id, academic_year_id,
       intended_year_group_id, created_by, due_at, available_from, maximum_marks, teacher_notes
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, ${input.dueAtSql}, now() - interval '2 days', $9, $10
     ) returning id`,
    [
      input.organisationId,
      input.title,
      input.description,
      await workTypeId(client, input.organisationId, input.workTypeKey),
      input.subjectId,
      input.academicYearId,
      input.intendedYearGroupId ?? null,
      input.createdBy,
      input.maximumMarks ?? null,
      input.teacherNotes ?? null,
    ],
  );
  const assignmentId = created.rows[0]!.id;
  for (const classId of input.classIds ?? []) {
    await client.query(
      `insert into learning_assignment_targets (
         organisation_id, assignment_id, target_type, class_id, created_by
       ) values ($1, $2, 'class', $3, $4)`,
      [input.organisationId, assignmentId, classId, input.createdBy],
    );
    const members = await client.query<{ student_profile_id: string; year_group_id: string | null }>(
      `select cm.student_profile_id, c.year_group_id
       from class_memberships cm
       join classes c on c.id = cm.class_id
       where cm.class_id = $1 and cm.ended_on is null`,
      [classId],
    );
    for (const member of members.rows) {
      await client.query(
        `insert into learning_assignment_recipients (
           organisation_id, assignment_id, student_profile_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5)
         on conflict (assignment_id, student_profile_id) do nothing`,
        [input.organisationId, assignmentId, member.student_profile_id, classId, member.year_group_id],
      );
    }
  }
  if (input.yearGroupId) {
    await client.query(
      `insert into learning_assignment_targets (
         organisation_id, assignment_id, target_type, year_group_id, created_by
       ) values ($1, $2, 'year_group', $3, $4)`,
      [input.organisationId, assignmentId, input.yearGroupId, input.createdBy],
    );
  }
  for (const studentId of input.studentIds ?? []) {
    await client.query(
      `insert into learning_assignment_targets (
         organisation_id, assignment_id, target_type, student_profile_id, created_by
       ) values ($1, $2, 'student', $3, $4)`,
      [input.organisationId, assignmentId, studentId, input.createdBy],
    );
    await client.query(
      `insert into learning_assignment_recipients (
         organisation_id, assignment_id, student_profile_id
       ) values ($1, $2, $3)
       on conflict (assignment_id, student_profile_id) do nothing`,
      [input.organisationId, assignmentId, studentId],
    );
  }
  if (input.resource) {
    const resource = await client.query<IdRow>(
      `insert into learning_resources (organisation_id, title, resource_kind, url, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.organisationId, input.resource.title, input.resource.kind, input.resource.url, input.createdBy],
    );
    await client.query(
      `insert into learning_assignment_resources (organisation_id, assignment_id, resource_id)
       values ($1, $2, $3)`,
      [input.organisationId, assignmentId, resource.rows[0]!.id],
    );
  }
  await client.query(
    "update learning_assignments set status = 'published' where id = $1",
    [assignmentId],
  );
  return assignmentId;
}

async function seedSubmission(client: pg.Client, input: {
  organisationId: string;
  assignmentId: string;
  studentProfileId: string;
  submittedBy: string;
  textResponse: string;
  comment?: string;
  status?: string;
  mark?: {
    score: number;
    maximumMarks: number;
    feedback: string;
    releasedToStudent: boolean;
    releasedToParent: boolean;
    resubmission?: boolean;
    markedBy: string;
  };
}): Promise<void> {
  const submission = await client.query<IdRow>(
    `insert into learning_submissions (
       organisation_id, assignment_id, student_profile_id, status, submitted_at, submitted_by
     ) values ($1, $2, $3, 'submitted', now() - interval '1 day', $4)
     returning id`,
    [input.organisationId, input.assignmentId, input.studentProfileId, input.submittedBy],
  );
  const submissionId = submission.rows[0]!.id;
  const revision = await client.query<IdRow>(
    `insert into learning_submission_revisions (
       organisation_id, submission_id, revision_number, text_response, comment, submitted_by, submitted_at
     ) values ($1, $2, 1, $3, $4, $5, now() - interval '1 day')
     returning id`,
    [input.organisationId, submissionId, input.textResponse, input.comment ?? null, input.submittedBy],
  );
  await client.query(
    "update learning_submissions set current_revision_id = $2 where id = $1",
    [submissionId, revision.rows[0]!.id],
  );
  if (input.mark) {
    await client.query(
      `insert into learning_marks (
         organisation_id, submission_id, score, maximum_marks, feedback,
         released_to_student, released_to_parent, resubmission_requested, marked_by, marked_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '12 hours')`,
      [
        input.organisationId,
        submissionId,
        input.mark.score,
        input.mark.maximumMarks,
        input.mark.feedback,
        input.mark.releasedToStudent,
        input.mark.releasedToParent,
        input.mark.resubmission ?? false,
        input.mark.markedBy,
      ],
    );
  }
  if (input.status && input.status !== "submitted") {
    await client.query("update learning_submissions set status = $2 where id = $1", [
      submissionId,
      input.status,
    ]);
  }
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

async function catalogueId(
  client: pg.Client,
  table:
    | "behaviour_incident_categories"
    | "behaviour_action_categories"
    | "positive_behaviour_categories"
    | "behaviour_locations"
    | "pastoral_concern_categories"
    | "safeguarding_concern_categories",
  organisationId: string,
  key: string,
): Promise<string> {
  return lookupId(client, `select id from ${table} where organisation_id = $1 and key = $2`, [
    organisationId,
    key,
  ]);
}

async function seedBehaviourIncident(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    occurredAt: string;
    categoryKey: string;
    locationKey?: string;
    classId?: string;
    description: string;
    severity?: string;
    actionTaken?: string;
    status?: string;
    recordedBy: string;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into behaviour_incidents (
       organisation_id, student_profile_id, occurred_at, category_id, location_id, class_id,
       description, severity, action_taken, status, recorded_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      input.organisationId,
      input.studentProfileId,
      input.occurredAt,
      await catalogueId(client, "behaviour_incident_categories", input.organisationId, input.categoryKey),
      input.locationKey
        ? await catalogueId(client, "behaviour_locations", input.organisationId, input.locationKey)
        : null,
      input.classId ?? null,
      input.description,
      input.severity ?? "low",
      input.actionTaken ?? null,
      input.status ?? "open",
      input.recordedBy,
    ],
  );
  return created.rows[0]!.id;
}

async function seedPositiveRecord(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    occurredOn: string;
    categoryKey: string;
    classId?: string;
    description: string;
    recordedBy: string;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into positive_behaviour_records (
       organisation_id, student_profile_id, occurred_on, category_id, class_id, description, recorded_by
     ) values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [
      input.organisationId,
      input.studentProfileId,
      input.occurredOn,
      await catalogueId(client, "positive_behaviour_categories", input.organisationId, input.categoryKey),
      input.classId ?? null,
      input.description,
      input.recordedBy,
    ],
  );
  return created.rows[0]!.id;
}

async function seedPastoralConcern(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    categoryKey: string;
    concernOn: string;
    summary: string;
    detailedNotes?: string;
    priority?: string;
    assignedStaffUserId?: string;
    attendanceRelated?: boolean;
    followUpDueOn?: string;
    raisedBy: string;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into pastoral_concerns (
       organisation_id, student_profile_id, category_id, concern_on, summary, detailed_notes,
       priority, assigned_staff_user_id, attendance_related, follow_up_due_on, raised_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      input.organisationId,
      input.studentProfileId,
      await catalogueId(client, "pastoral_concern_categories", input.organisationId, input.categoryKey),
      input.concernOn,
      input.summary,
      input.detailedNotes ?? null,
      input.priority ?? "medium",
      input.assignedStaffUserId ?? null,
      input.attendanceRelated ?? false,
      input.followUpDueOn ?? null,
      input.raisedBy,
    ],
  );
  return created.rows[0]!.id;
}

async function seedSafeguardingConcern(
  client: pg.Client,
  input: {
    organisationId: string;
    studentProfileId: string;
    categoryKey: string;
    aroseAt: string;
    factualDescription: string;
    immediateActionTaken?: string;
    assignedUserId?: string;
    recordedBy: string;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into safeguarding_concerns (
       organisation_id, student_profile_id, arose_at, category_id, factual_description,
       immediate_action_taken, assigned_safeguarding_lead_user_id, recorded_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id`,
    [
      input.organisationId,
      input.studentProfileId,
      input.aroseAt,
      await catalogueId(client, "safeguarding_concern_categories", input.organisationId, input.categoryKey),
      input.factualDescription,
      input.immediateActionTaken ?? null,
      input.assignedUserId ?? null,
      input.recordedBy,
    ],
  );
  await client.query(
    `insert into safeguarding_chronology_entries (
       organisation_id, concern_id, occurred_at, entry_type, factual_note, actor_user_id
     ) values ($1,$2,$3,'note','Concern recorded in demo seed.',$4)`,
    [input.organisationId, created.rows[0]!.id, input.aroseAt, input.recordedBy],
  );
  return created.rows[0]!.id;
}

async function eventTypeId(client: pg.Client, organisationId: string, key: string): Promise<string> {
  return lookupId(
    client,
    "select id from school_event_types where organisation_id = $1 and key = $2",
    [organisationId, key],
  );
}

async function seedAnnouncement(
  client: pg.Client,
  input: {
    organisationId: string;
    title: string;
    body: string;
    createdBy: string;
    priority?: string;
    acknowledgementRequired?: boolean;
    pinned?: boolean;
    expiresAtSql?: string | null;
    targets: Array<{
      targetType: string;
      classId?: string;
      yearGroupId?: string;
      studentProfileId?: string;
      staffUserId?: string;
    }>;
    resource?: { title: string; kind: string; url: string };
    recipients: Array<{
      userId: string;
      audienceRole: "staff" | "parent" | "student";
      subjects?: Array<{ studentProfileId: string; classId?: string | null; yearGroupId?: string | null }>;
    }>;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into announcements (
       organisation_id, title, body, priority, acknowledgement_required, pinned, created_by, expires_at
     ) values ($1, $2, $3, $4, $5, $6, $7, ${input.expiresAtSql ?? "null"})
     returning id`,
    [
      input.organisationId,
      input.title,
      input.body,
      input.priority ?? "normal",
      input.acknowledgementRequired ?? false,
      input.pinned ?? false,
      input.createdBy,
    ],
  );
  const announcementId = created.rows[0]!.id;
  for (const target of input.targets) {
    await client.query(
      `insert into announcement_targets (
         organisation_id, announcement_id, target_type, class_id, year_group_id, student_profile_id, staff_user_id, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.organisationId,
        announcementId,
        target.targetType,
        target.classId ?? null,
        target.yearGroupId ?? null,
        target.studentProfileId ?? null,
        target.staffUserId ?? null,
        input.createdBy,
      ],
    );
  }
  if (input.resource) {
    await client.query(
      `insert into announcement_resources (organisation_id, announcement_id, title, resource_kind, url, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.organisationId,
        announcementId,
        input.resource.title,
        input.resource.kind,
        input.resource.url,
        input.createdBy,
      ],
    );
  }
  await client.query("update announcements set status = 'published', published_by = $2 where id = $1", [
    announcementId,
    input.createdBy,
  ]);
  for (const recipient of input.recipients) {
    await client.query(
      `insert into announcement_recipients (organisation_id, announcement_id, user_id, audience_role)
       values ($1, $2, $3, $4)
       on conflict (announcement_id, user_id) do nothing`,
      [input.organisationId, announcementId, recipient.userId, recipient.audienceRole],
    );
    for (const subject of recipient.subjects ?? []) {
      await client.query(
        `insert into announcement_recipient_subjects (
           organisation_id, announcement_id, user_id, student_profile_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (announcement_id, user_id, student_profile_id) do nothing`,
        [
          input.organisationId,
          announcementId,
          recipient.userId,
          subject.studentProfileId,
          subject.classId ?? null,
          subject.yearGroupId ?? null,
        ],
      );
    }
  }
  return announcementId;
}

async function seedSchoolEvent(
  client: pg.Client,
  input: {
    organisationId: string;
    title: string;
    description?: string | null;
    typeKey: string;
    startsAt: string;
    endsAt: string;
    allDay?: boolean;
    location?: string | null;
    createdBy: string;
    targets: Array<{
      targetType: string;
      classId?: string;
      yearGroupId?: string;
      studentProfileId?: string;
      staffUserId?: string;
    }>;
    audience: Array<{
      userId: string;
      audienceRole: "staff" | "parent" | "student";
      subjects?: Array<{ studentProfileId: string; classId?: string | null; yearGroupId?: string | null }>;
    }>;
  },
): Promise<string> {
  const created = await client.query<IdRow>(
    `insert into school_events (
       organisation_id, title, description, event_type_id, starts_at, ends_at, all_day, location, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      input.organisationId,
      input.title,
      input.description ?? null,
      await eventTypeId(client, input.organisationId, input.typeKey),
      input.startsAt,
      input.endsAt,
      input.allDay ?? false,
      input.location ?? null,
      input.createdBy,
    ],
  );
  const eventId = created.rows[0]!.id;
  for (const target of input.targets) {
    await client.query(
      `insert into school_event_targets (
         organisation_id, event_id, target_type, class_id, year_group_id, student_profile_id, staff_user_id, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.organisationId,
        eventId,
        target.targetType,
        target.classId ?? null,
        target.yearGroupId ?? null,
        target.studentProfileId ?? null,
        target.staffUserId ?? null,
        input.createdBy,
      ],
    );
  }
  await client.query("update school_events set status = 'published', published_by = $2 where id = $1", [
    eventId,
    input.createdBy,
  ]);
  for (const member of input.audience) {
    await client.query(
      `insert into school_event_audience (organisation_id, event_id, user_id, audience_role)
       values ($1, $2, $3, $4)
       on conflict (event_id, user_id) do nothing`,
      [input.organisationId, eventId, member.userId, member.audienceRole],
    );
    for (const subject of member.subjects ?? []) {
      await client.query(
        `insert into school_event_audience_subjects (
           organisation_id, event_id, user_id, student_profile_id, class_id, year_group_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (event_id, user_id, student_profile_id) do nothing`,
        [
          input.organisationId,
          eventId,
          member.userId,
          subject.studentProfileId,
          subject.classId ?? null,
          subject.yearGroupId ?? null,
        ],
      );
    }
  }
  return eventId;
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

async function seedMessageConversation(
  client: pg.Client,
  input: {
    organisationId: string;
    reference: string;
    conversationType: "parent_teacher" | "parent_school" | "admissions" | "staff_internal";
    subject: string;
    relatedPupilId?: string | null;
    createdBy: string;
    status?: "open" | "closed" | "archived";
    participants: Array<{ userId: string; kind: "staff" | "parent"; lastReadAt?: string | null }>;
    messages: Array<{ senderUserId: string; body: string; sentAt: string }>;
  },
): Promise<string> {
  const conversation = await client.query<IdRow>(
    `insert into message_conversations (
       organisation_id, reference, conversation_type, subject, related_pupil_id,
       related_domain, status, created_by, last_message_at, last_message_preview,
       closed_at, closed_by
     ) values ($1,$2,$3,$4,$5,'none',$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      input.organisationId,
      input.reference,
      input.conversationType,
      input.subject,
      input.relatedPupilId ?? null,
      input.status ?? "open",
      input.createdBy,
      input.messages[input.messages.length - 1]?.sentAt ?? new Date().toISOString(),
      (input.messages[input.messages.length - 1]?.body ?? "").slice(0, 140),
      input.status === "closed" ? input.messages[input.messages.length - 1]?.sentAt ?? null : null,
      input.status === "closed" ? input.createdBy : null,
    ],
  );
  const conversationId = conversation.rows[0]!.id;
  for (const participant of input.participants) {
    await client.query(
      `insert into message_participants (
         organisation_id, conversation_id, user_id, participant_kind, added_by, last_read_at
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        input.organisationId,
        conversationId,
        participant.userId,
        participant.kind,
        input.createdBy,
        participant.lastReadAt ?? null,
      ],
    );
  }
  let lastId: string | null = null;
  for (const message of input.messages) {
    const inserted = await client.query<IdRow>(
      `insert into messages (
         organisation_id, conversation_id, sender_user_id, body, sent_at
       ) values ($1,$2,$3,$4,$5)
       returning id`,
      [input.organisationId, conversationId, message.senderUserId, message.body, message.sentAt],
    );
    lastId = inserted.rows[0]!.id;
  }
  if (lastId) {
    await client.query(
      `update message_conversations set last_message_id = $2 where id = $1`,
      [conversationId, lastId],
    );
  }
  return conversationId;
}

async function lookupId(client: pg.Client, sql: string, values: unknown[]): Promise<string> {
  const result = await client.query<IdRow>(sql, values);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Demo seed lookup failed: ${sql}`);
  return id;
}

async function activityTypeId(client: pg.Client, organisationId: string, key: string): Promise<string> {
  return lookupId(client, "select id from school_activity_types where organisation_id = $1 and key = $2", [
    organisationId,
    key,
  ]);
}

async function seedSchoolActivity(
  client: pg.Client,
  input: {
    organisationId: string;
    createdBy: string;
    title: string;
    description?: string;
    typeKey: string;
    academicYearId?: string | null;
    startsAt: string;
    endsAt: string;
    location?: string | null;
    externalAddress?: string | null;
    meetingPoint?: string | null;
    returnPoint?: string | null;
    capacity?: number | null;
    responseDeadlineAt?: string | null;
    consentRequired?: boolean;
    parentResponseRequired?: boolean;
    studentSignupEnabled?: boolean;
    studentVisible?: boolean;
    parentVisible?: boolean;
    occurrenceKind?: "one_off" | "recurring";
    recurrenceWeekdays?: number[] | null;
    recurrenceUntil?: string | null;
    staffNotes?: string | null;
    parentNotes?: string | null;
    status?: "published" | "cancelled";
    cancelReason?: string | null;
    targets: Array<{
      targetType: "whole_school" | "year_group" | "class" | "student" | "staff_member";
      classId?: string;
      yearGroupId?: string;
      studentProfileId?: string;
      staffUserId?: string;
    }>;
    clauses?: Array<{ clauseKey: string; title: string; wording: string }>;
    staff?: Array<{ staffUserId: string; staffRole?: string }>;
    documents?: Array<{ title: string; visibility: string }>;
    eligible: Array<{ studentProfileId: string; classId?: string | null; yearGroupId?: string | null }>;
    participants?: Array<{
      studentProfileId: string;
      registrationStatus: string;
      waitingListPosition?: number | null;
      source?: string;
    }>;
    responses?: Array<{
      studentProfileId: string;
      actorUserId: string;
      guardianUserId?: string | null;
      channel: "parent_portal" | "staff_offline";
      response: "consented" | "declined" | "withdrawn";
      wording: string;
    }>;
    updates?: Array<{ body: string; parentVisible?: boolean; studentVisible?: boolean }>;
    priceAmountMinor?: number | null;
    priceCurrency?: string | null;
    paymentRequired?: boolean;
    paymentDeadlineAt?: string | null;
    paymentInstructions?: string | null;
    chargePolicy?: "none" | "on_confirmed" | "on_consent";
  },
): Promise<string> {
  const typeId = await activityTypeId(client, input.organisationId, input.typeKey);
  const created = await client.query<IdRow>(
    `insert into school_activities (
       organisation_id, academic_year_id, title, description, activity_type_id,
       starts_at, ends_at, location, external_address, meeting_point, return_point,
       capacity, response_deadline_at, consent_required, parent_response_required,
       student_signup_enabled, student_visible, parent_visible, occurrence_kind,
       recurrence_weekdays, recurrence_until, staff_notes, parent_notes,
       price_amount_minor, price_currency, payment_required, payment_deadline_at,
       payment_instructions, charge_policy, created_by
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
     ) returning id`,
    [
      input.organisationId,
      input.academicYearId ?? null,
      input.title,
      input.description ?? null,
      typeId,
      input.startsAt,
      input.endsAt,
      input.location ?? null,
      input.externalAddress ?? null,
      input.meetingPoint ?? null,
      input.returnPoint ?? null,
      input.capacity ?? null,
      input.responseDeadlineAt ?? null,
      input.consentRequired ?? false,
      input.parentResponseRequired ?? input.consentRequired ?? false,
      input.studentSignupEnabled ?? false,
      input.studentVisible ?? true,
      input.parentVisible ?? true,
      input.occurrenceKind ?? "one_off",
      input.recurrenceWeekdays ?? null,
      input.recurrenceUntil ?? null,
      input.staffNotes ?? null,
      input.parentNotes ?? null,
      input.priceAmountMinor ?? null,
      input.priceCurrency ?? null,
      input.paymentRequired ?? false,
      input.paymentDeadlineAt ?? null,
      input.paymentInstructions ?? null,
      input.chargePolicy ?? "on_confirmed",
      input.createdBy,
    ],
  );
  const activityId = created.rows[0]!.id;
  for (const target of input.targets) {
    await client.query(
      `insert into school_activity_targets (
         organisation_id, activity_id, target_type, class_id, year_group_id,
         student_profile_id, staff_user_id, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.organisationId,
        activityId,
        target.targetType,
        target.classId ?? null,
        target.yearGroupId ?? null,
        target.studentProfileId ?? null,
        target.staffUserId ?? null,
        input.createdBy,
      ],
    );
  }
  const clauses =
    input.clauses ??
    (input.consentRequired
      ? [
          {
            clauseKey: "permission_to_attend",
            title: "Permission to attend",
            wording:
              "I give permission for my child to take part in this school activity and confirm the information I provide is accurate.",
          },
        ]
      : []);
  for (const [index, clause] of clauses.entries()) {
    await client.query(
      `insert into school_activity_consent_clauses (
         organisation_id, activity_id, clause_key, title, wording, required, sort_order
       ) values ($1,$2,$3,$4,$5,true,$6)`,
      [input.organisationId, activityId, clause.clauseKey, clause.title, clause.wording, index],
    );
  }
  for (const member of input.staff ?? []) {
    await client.query(
      `insert into school_activity_staff (organisation_id, activity_id, staff_user_id, staff_role, created_by)
       values ($1,$2,$3,$4,$5)`,
      [input.organisationId, activityId, member.staffUserId, member.staffRole ?? "lead", input.createdBy],
    );
  }
  await client.query(
    `update school_activities
        set status = $3,
            published_by = $4,
            cancel_reason = $5
      where id = $1 and organisation_id = $2`,
    [activityId, input.organisationId, input.status ?? "published", input.createdBy, input.cancelReason ?? null],
  );
  for (const pupil of input.eligible) {
    await client.query(
      `insert into school_activity_eligible_pupils (
         organisation_id, activity_id, student_profile_id, class_id, year_group_id
       ) values ($1,$2,$3,$4,$5)
       on conflict (activity_id, student_profile_id) do nothing`,
      [
        input.organisationId,
        activityId,
        pupil.studentProfileId,
        pupil.classId ?? null,
        pupil.yearGroupId ?? null,
      ],
    );
  }
  for (const participant of input.participants ?? []) {
    await client.query(
      `insert into school_activity_participants (
         organisation_id, activity_id, student_profile_id, registration_status,
         waiting_list_position, source, confirmed_at
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.organisationId,
        activityId,
        participant.studentProfileId,
        participant.registrationStatus,
        participant.waitingListPosition ?? null,
        participant.source ?? "staff_assigned",
        participant.registrationStatus === "confirmed" ? new Date().toISOString() : null,
      ],
    );
  }
  for (const response of input.responses ?? []) {
    await client.query(
      `insert into school_activity_responses (
         organisation_id, activity_id, student_profile_id, actor_user_id, guardian_user_id,
         channel, response, is_effective, consent_version, wording_snapshot, staff_note
       ) values ($1,$2,$3,$4,$5,$6,$7,true,1,$8::jsonb,$9)`,
      [
        input.organisationId,
        activityId,
        response.studentProfileId,
        response.actorUserId,
        response.channel === "staff_offline" ? null : (response.guardianUserId ?? null),
        response.channel,
        response.response,
        JSON.stringify({
          consentVersion: 1,
          capturedAt: "2026-09-20T09:00:00.000Z",
          clauses: [{ clauseKey: "permission_to_attend", title: "Permission to attend", wording: response.wording, required: true, sortOrder: 0 }],
        }),
        response.channel === "staff_offline" ? "Recorded from paper consent for demo." : null,
      ],
    );
  }
  for (const document of input.documents ?? []) {
    await client.query(
      `insert into school_activity_documents (
         organisation_id, activity_id, title, visibility, created_by
       ) values ($1,$2,$3,$4,$5)`,
      [input.organisationId, activityId, document.title, document.visibility, input.createdBy],
    );
  }
  for (const update of input.updates ?? []) {
    await client.query(
      `insert into school_activity_updates (
         organisation_id, activity_id, body, parent_visible, student_visible, published_by
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        input.organisationId,
        activityId,
        update.body,
        update.parentVisible ?? true,
        update.studentVisible ?? false,
        input.createdBy,
      ],
    );
  }
  return activityId;
}

async function seedCharge(
  client: pg.Client,
  input: {
    organisationId: string;
    createdBy: string;
    title: string;
    categoryKey: string;
    studentProfileId: string;
    amountMinor: number;
    currency?: string;
    dueAt?: string | null;
    activityId?: string | null;
    sourceKind?: "manual" | "activity" | "bulk";
    parentNote?: string | null;
    reference: string;
    status?: "issued" | "paid" | "refunded";
  },
): Promise<string> {
  const category = await client.query<IdRow>(
    "select id from school_charge_categories where organisation_id = $1 and key = $2",
    [input.organisationId, input.categoryKey],
  );
  const created = await client.query<IdRow>(
    `insert into school_charges (
       organisation_id, reference, title, category_id, student_profile_id, activity_id,
       source_kind, original_amount_minor, amount_due_minor, currency, due_at, status,
       parent_note, created_by, issued_by, issued_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,now())
     returning id`,
    [
      input.organisationId,
      input.reference,
      input.title,
      category.rows[0]!.id,
      input.studentProfileId,
      input.activityId ?? null,
      input.sourceKind ?? "manual",
      input.amountMinor,
      input.amountMinor,
      input.currency ?? "GBP",
      input.dueAt ?? null,
      input.status ?? "issued",
      input.parentNote ?? null,
      input.createdBy,
    ],
  );
  return created.rows[0]!.id;
}

async function seedReportingPeriod(
  client: pg.Client,
  input: {
    organisationId: string;
    academicYearId: string;
    name: string;
    startsOn: string;
    endsOn: string;
    status?: string;
  },
): Promise<string> {
  const inserted = await client.query<IdRow>(
    `insert into academic_reporting_periods (
       organisation_id, academic_year_id, name, starts_on, ends_on, status
     ) values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [input.organisationId, input.academicYearId, input.name, input.startsOn, input.endsOn, input.status ?? "open"],
  );
  return inserted.rows[0]!.id;
}

async function seedFormalAssessment(
  client: pg.Client,
  input: {
    organisationId: string;
    academicYearId: string;
    reportingPeriodId?: string | null;
    title: string;
    subjectId: string;
    yearGroupId: string;
    typeKey: string;
    assessmentDate: string;
    createdBy: string;
    classIds?: string[];
    maximumMarks?: number | null;
    gradeSchemeKey?: string | null;
    status?: "draft" | "open" | "completed" | "reviewed" | "published";
    internalNotes?: string | null;
  },
): Promise<string> {
  const typeId = await lookupId(
    client,
    "select id from academic_assessment_types where organisation_id = $1 and key = $2",
    [input.organisationId, input.typeKey],
  );
  const schemeId = input.gradeSchemeKey
    ? await lookupId(
        client,
        "select id from academic_grade_schemes where organisation_id = $1 and key = $2",
        [input.organisationId, input.gradeSchemeKey],
      )
    : null;
  const inserted = await client.query<IdRow>(
    `insert into academic_assessments (
       organisation_id, academic_year_id, reporting_period_id, title, subject_id, year_group_id,
       assessment_type_id, assessment_date, maximum_marks, grade_scheme_id, internal_notes, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      input.organisationId,
      input.academicYearId,
      input.reportingPeriodId ?? null,
      input.title,
      input.subjectId,
      input.yearGroupId,
      typeId,
      input.assessmentDate,
      input.maximumMarks ?? null,
      schemeId,
      input.internalNotes ?? null,
      input.createdBy,
    ],
  );
  const id = inserted.rows[0]!.id;
  for (const classId of input.classIds ?? []) {
    await client.query(
      `insert into academic_assessment_classes (organisation_id, assessment_id, class_id)
       values ($1, $2, $3)`,
      [input.organisationId, id, classId],
    );
  }
  const status = input.status ?? "draft";
  if (status !== "draft") {
    await client.query("select snapshot_academic_assessment_inclusions($1)", [id]);
    await client.query("update academic_assessments set status = 'open' where id = $1", [id]);
    if (status === "completed" || status === "reviewed" || status === "published") {
      await client.query("update academic_assessments set status = 'completed' where id = $1", [id]);
    }
    if (status === "reviewed") {
      await client.query("update academic_assessments set status = 'reviewed' where id = $1", [id]);
    }
    if (status === "published") {
      await client.query("update academic_assessments set status = 'published' where id = $1", [id]);
    }
  }
  return id;
}

async function seedFormalResult(
  client: pg.Client,
  input: {
    organisationId: string;
    assessmentId: string;
    studentProfileId: string;
    enteredBy: string;
    rawScore?: number | null;
    maximumScore?: number | null;
    gradeCode?: string | null;
    teacherJudgement?: string | null;
    comment?: string | null;
    releasedToStudent?: boolean;
    releasedToParent?: boolean;
  },
): Promise<void> {
  const levelId = input.gradeCode
    ? (
        await client.query<IdRow>(
          `select l.id
           from academic_grade_scheme_levels l
           join academic_assessments a on a.grade_scheme_id = l.scheme_id
           where a.id = $1 and l.code = $2`,
          [input.assessmentId, input.gradeCode],
        )
      ).rows[0]?.id ?? null
    : null;
  await client.query(
    `insert into academic_results (
       organisation_id, assessment_id, student_profile_id, raw_score, maximum_score,
       grade_scheme_level_id, teacher_judgement, comment, released_to_student,
       released_to_parent, entered_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.organisationId,
      input.assessmentId,
      input.studentProfileId,
      input.rawScore ?? null,
      input.maximumScore ?? null,
      levelId,
      input.teacherJudgement ?? null,
      input.comment ?? null,
      input.releasedToStudent ?? false,
      input.releasedToParent ?? false,
      input.enteredBy,
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

async function seedAdmissionsPublicForms(
  client: pg.Client,
  input: {
    organisationId: string;
    createdBy: string;
    academicYearId: string;
    yearGroupId: string;
    schoolKey: "greenwood" | "oak";
  },
): Promise<void> {
  await client.query(
    `insert into admissions_counters (organisation_id, kind, year, last_value)
     values ($1, 'enquiry', extract(year from current_date)::int, 20),
            ($1, 'application', extract(year from current_date)::int, 20)
     on conflict (organisation_id, kind, year)
     do update set last_value = greatest(admissions_counters.last_value, excluded.last_value)`,
    [input.organisationId],
  );

  const campaigns: Array<[string, string]> =
    input.schoolKey === "greenwood"
      ? [
          ["school-website", "School Website"],
          ["facebook", "Facebook"],
          ["instagram", "Instagram"],
          ["google-ads", "Google Ads"],
          ["open-day-qr", "Open Day QR Poster"],
          ["referral", "Referral"],
          ["local-newspaper", "Local Newspaper"],
        ]
      : [
          ["oak-website", "Oak Website"],
          ["oak-open-evening", "Oak Open Evening"],
        ];
  const campaignIds = new Map<string, string>();
  for (const [code, label] of campaigns) {
    const row = await client.query<IdRow>(
      `insert into admissions_campaigns (organisation_id, public_code, label, enabled)
       values ($1,$2,$3,true) returning id`,
      [input.organisationId, code, label],
    );
    campaignIds.set(code, row.rows[0]!.id);
  }

  async function insertForm(form: {
    slug: string;
    type: string;
    name: string;
    status: "draft" | "published" | "unpublished";
    description: string;
    success: string;
  }): Promise<string> {
    const inserted = await client.query<IdRow>(
      `insert into admissions_forms (
         organisation_id, slug, form_type, name, description, status, success_title, success_text,
         privacy_notice_text, allowed_academic_year_ids, allowed_year_group_ids, created_by,
         published_at
       ) values ($1,$2,$3,$4,$5,$6,'Thank you',$7,$8,array[$9]::uuid[],array[$10]::uuid[],$11,
         case when $6 = 'published' then now() else null end)
       returning id`,
      [
        input.organisationId,
        form.slug,
        form.type,
        form.name,
        form.description,
        form.status,
        form.success,
        "We keep the information you submit to process your enquiry or application. See the school privacy notice.",
        input.academicYearId,
        input.yearGroupId,
        input.createdBy,
      ],
    );
    return inserted.rows[0]!.id;
  }

  async function addField(
    formId: string,
    sectionId: string,
    field: {
      key: string;
      kind: "canonical" | "custom";
      type: string;
      label: string;
      required?: boolean;
      options?: Array<{ value: string; label: string }>;
    },
    sort: number,
  ) {
    await client.query(
      `insert into admissions_form_fields (
         organisation_id, form_id, section_id, field_key, field_kind, canonical_key,
         question_type, label, required, enabled, sort_order, options
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11::jsonb)`,
      [
        input.organisationId,
        formId,
        sectionId,
        field.key,
        field.kind,
        field.kind === "canonical" ? field.key : null,
        field.type,
        field.label,
        field.required ?? false,
        sort,
        JSON.stringify(field.options ?? []),
      ],
    );
  }

  const enquiryId = await insertForm({
    slug: input.schoolKey === "greenwood" ? "year-3-enquiry" : "oak-enquiry",
    type: "enquiry",
    name: input.schoolKey === "greenwood" ? "Year 3 enquiry" : "Oak enquiry",
    status: "published",
    description: "A short enquiry form for families.",
    success: "Thank you. The admissions team will be in touch.",
  });
  const enquiryChild = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'child','Child details',0) returning id`,
    [input.organisationId, enquiryId],
  );
  const enquiryGuardian = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'guardian','Parent / guardian',1) returning id`,
    [input.organisationId, enquiryId],
  );
  const enquiryDetails = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'details','Your enquiry',2) returning id`,
    [input.organisationId, enquiryId],
  );
  await addField(enquiryId, enquiryChild.rows[0]!.id, { key: "child.legal_name", kind: "canonical", type: "short_text", label: "Child's legal name", required: true }, 0);
  await addField(enquiryId, enquiryChild.rows[0]!.id, { key: "child.date_of_birth", kind: "canonical", type: "date", label: "Date of birth", required: true }, 1);
  await addField(enquiryId, enquiryChild.rows[0]!.id, { key: "child.intended_academic_year_id", kind: "canonical", type: "single_choice", label: "Intended academic year", required: true }, 2);
  await addField(enquiryId, enquiryChild.rows[0]!.id, { key: "child.intended_year_group_id", kind: "canonical", type: "single_choice", label: "Intended year group", required: true }, 3);
  await addField(enquiryId, enquiryGuardian.rows[0]!.id, { key: "guardian.full_name", kind: "canonical", type: "short_text", label: "Parent / guardian name", required: true }, 0);
  await addField(enquiryId, enquiryGuardian.rows[0]!.id, { key: "guardian.email", kind: "canonical", type: "email", label: "Email", required: true }, 1);
  await addField(enquiryId, enquiryGuardian.rows[0]!.id, { key: "guardian.phone", kind: "canonical", type: "phone", label: "Telephone" }, 2);
  await addField(enquiryId, enquiryDetails.rows[0]!.id, { key: "enquiry.notes", kind: "canonical", type: "long_text", label: "Your question or note", required: true }, 0);

  const applyId = await insertForm({
    slug: input.schoolKey === "greenwood" ? "year-3-application" : "oak-application",
    type: "application",
    name: input.schoolKey === "greenwood" ? "Year 3 application" : "Oak application",
    status: "published",
    description: "Full multi-step admissions application.",
    success: "Your application has been submitted.",
  });
  const applyChild = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'child','Child details',0) returning id`,
    [input.organisationId, applyId],
  );
  const applyGuardians = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'guardians','Parents / guardians',1) returning id`,
    [input.organisationId, applyId],
  );
  const applyEducation = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'previous_education','Previous education',2) returning id`,
    [input.organisationId, applyId],
  );
  const applyMedical = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'medical','Medical and additional needs',3) returning id`,
    [input.organisationId, applyId],
  );
  const applyEmergency = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'emergency','Emergency contacts',4) returning id`,
    [input.organisationId, applyId],
  );
  const applyDetails = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'application','Application details',5) returning id`,
    [input.organisationId, applyId],
  );
  const applyDecl = await client.query<IdRow>(
    `insert into admissions_form_sections (organisation_id, form_id, section_key, title, sort_order)
     values ($1,$2,'declarations','Documents and declarations',6) returning id`,
    [input.organisationId, applyId],
  );
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.legal_name", kind: "canonical", type: "short_text", label: "Child's legal name", required: true }, 0);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.preferred_name", kind: "canonical", type: "short_text", label: "Preferred name" }, 1);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.date_of_birth", kind: "canonical", type: "date", label: "Date of birth", required: true }, 2);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.gender", kind: "canonical", type: "single_choice", label: "Gender", options: [
    { value: "female", label: "Female" },
    { value: "male", label: "Male" },
    { value: "prefer_not_to_say", label: "Prefer not to say" },
  ] }, 3);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.address", kind: "canonical", type: "address_group", label: "Child's address" }, 4);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.intended_academic_year_id", kind: "canonical", type: "single_choice", label: "Intended academic year", required: true }, 5);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.intended_year_group_id", kind: "canonical", type: "single_choice", label: "Intended year group", required: true }, 6);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.proposed_start_date", kind: "canonical", type: "date", label: "Proposed start date" }, 7);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.current_school", kind: "canonical", type: "short_text", label: "Current school" }, 8);
  await addField(applyId, applyChild.rows[0]!.id, { key: "child.previous_school", kind: "canonical", type: "short_text", label: "Previous school" }, 9);
  await addField(applyId, applyGuardians.rows[0]!.id, { key: "guardians", kind: "canonical", type: "guardian_group", label: "Parents / guardians", required: true }, 0);
  await addField(applyId, applyEducation.rows[0]!.id, { key: "previous_education.school_name", kind: "canonical", type: "short_text", label: "Current or previous school" }, 0);
  await addField(applyId, applyEducation.rows[0]!.id, { key: "previous_education.start_date", kind: "canonical", type: "date", label: "Dates attended (from)" }, 1);
  await addField(applyId, applyEducation.rows[0]!.id, { key: "previous_education.end_date", kind: "canonical", type: "date", label: "Dates attended (to)" }, 2);
  await addField(applyId, applyEducation.rows[0]!.id, { key: "previous_education.report_details", kind: "canonical", type: "long_text", label: "Previous report or reference details" }, 3);
  await addField(applyId, applyMedical.rows[0]!.id, { key: "medical.allergies", kind: "canonical", type: "long_text", label: "Allergies" }, 0);
  await addField(applyId, applyMedical.rows[0]!.id, { key: "medical.conditions", kind: "canonical", type: "long_text", label: "Medical conditions" }, 1);
  await addField(applyId, applyMedical.rows[0]!.id, { key: "medical.medication", kind: "canonical", type: "long_text", label: "Medication" }, 2);
  await addField(applyId, applyMedical.rows[0]!.id, { key: "medical.dietary", kind: "canonical", type: "short_text", label: "Dietary requirements" }, 3);
  await addField(applyId, applyMedical.rows[0]!.id, { key: "medical.send_notes", kind: "canonical", type: "long_text", label: "SEND / additional support notes" }, 4);
  await addField(applyId, applyEmergency.rows[0]!.id, { key: "emergency.full_name", kind: "canonical", type: "short_text", label: "Emergency contact name" }, 0);
  await addField(applyId, applyEmergency.rows[0]!.id, { key: "emergency.relationship", kind: "canonical", type: "short_text", label: "Emergency contact relationship" }, 1);
  await addField(applyId, applyEmergency.rows[0]!.id, { key: "emergency.telephone", kind: "canonical", type: "phone", label: "Emergency telephone" }, 2);
  await addField(applyId, applyEmergency.rows[0]!.id, { key: "emergency.authorised_collection", kind: "canonical", type: "yes_no", label: "Authorised to collect the child" }, 3);
  await addField(applyId, applyDetails.rows[0]!.id, { key: "application.notes", kind: "canonical", type: "long_text", label: "Anything else we should know" }, 0);
  await addField(applyId, applyDetails.rows[0]!.id, { key: "sibling_at_school", kind: "custom", type: "yes_no", label: "Does the child have a sibling at this school?" }, 1);
  await addField(applyId, applyDetails.rows[0]!.id, { key: "how_heard", kind: "custom", type: "single_choice", label: "How did you hear about us?", options: [
    { value: "tour", label: "School tour" },
    { value: "friend", label: "Friend or family" },
    { value: "online", label: "Online" },
  ] }, 2);
  await addField(applyId, applyDecl.rows[0]!.id, {
    key: "supporting_evidence",
    kind: "custom",
    type: "file",
    label: "Supporting document (optional)",
  }, 0);
  await addField(applyId, applyDecl.rows[0]!.id, { key: "declaration_privacy", kind: "custom", type: "declaration", label: "I confirm the information is accurate and I have read the privacy notice", required: true }, 1);

  await insertForm({
    slug: input.schoolKey === "greenwood" ? "sixth-form-draft" : "oak-scholarship-draft",
    type: input.schoolKey === "greenwood" ? "sixth_form" : "scholarship",
    name: input.schoolKey === "greenwood" ? "Sixth Form (draft)" : "Oak scholarship (draft)",
    status: "draft",
    description: "Unpublished draft form.",
    success: "Draft only.",
  });

  const campaignId =
    campaignIds.get(input.schoolKey === "greenwood" ? "facebook" : "oak-website") ?? null;
  const enquiryAnswers = {
    "child.legal_name": input.schoolKey === "greenwood" ? "Maya Cole" : "Owen Hart",
    "child.date_of_birth": "2018-04-12",
    "child.intended_academic_year_id": input.academicYearId,
    "child.intended_year_group_id": input.yearGroupId,
    "guardian.full_name": input.schoolKey === "greenwood" ? "Priya Cole" : "Helen Hart",
    "guardian.email": input.schoolKey === "greenwood" ? "priya.cole@example.test" : "helen.hart@example.test",
    "enquiry.notes": input.schoolKey === "greenwood" ? "Please send Year 3 open morning dates." : "Oak-only public enquiry.",
  };
  await client.query(
    `select submit_public_admissions_form(
       $1, 'enquiry', $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $6, false, null, null, null, null, 'complete'
     )`,
    [
      input.organisationId,
      input.schoolKey === "greenwood" ? "year-3-enquiry" : "oak-enquiry",
      JSON.stringify(enquiryAnswers),
      JSON.stringify({
        child: {
          legalName: enquiryAnswers["child.legal_name"],
          dateOfBirth: "2018-04-12",
          intendedAcademicYearId: input.academicYearId,
          intendedYearGroupId: input.yearGroupId,
        },
        guardians: [
          {
            fullName: enquiryAnswers["guardian.full_name"],
            email: enquiryAnswers["guardian.email"],
            primaryContact: true,
          },
        ],
        notes: enquiryAnswers["enquiry.notes"],
      }),
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        privacyNoticeText: "Demo privacy notice snapshot",
        declarations: [{ fieldKey: "declaration_privacy", label: "I confirm", accepted: true }],
      }),
      input.schoolKey === "greenwood" ? "facebook" : "oak-website",
    ],
  );
  void campaignId;
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

async function seedTimetable(
  client: pg.Client,
  input: {
    organisationId: string;
    academicYearId: string;
    createdBy: string;
    classIds: Map<string, string>;
    subjects: Map<string, string>;
    teachers: {
      hannah?: string;
      daniel?: string;
      elena?: string;
      mark?: string;
      head?: string;
    };
    variant: "greenwood" | "oak";
  },
): Promise<void> {
  const { organisationId: orgId, academicYearId, createdBy } = input;

  async function room(name: string, shortCode: string, extra: { building?: string; type?: string } = {}) {
    const inserted = await client.query<IdRow>(
      `insert into rooms (
         organisation_id, name, short_code, building, location_type, is_active, created_by
       ) values ($1,$2,$3,$4,$5,true,$6) returning id`,
      [orgId, name, shortCode, extra.building ?? null, extra.type ?? "teaching", createdBy],
    );
    return inserted.rows[0]!.id;
  }

  async function profile(name: string, weekdays: number[], startsAt: string, endsAt: string) {
    const inserted = await client.query<IdRow>(
      `insert into school_day_profiles (
         organisation_id, academic_year_id, name, weekdays, starts_at, ends_at, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [orgId, academicYearId, name, weekdays, startsAt, endsAt, createdBy],
    );
    return inserted.rows[0]!.id;
  }

  async function period(
    profileId: string,
    name: string,
    type: string,
    startsAt: string,
    endsAt: string,
    sortOrder: number,
    sessionKey?: string,
  ) {
    let sessionId: string | null = null;
    if (sessionKey) {
      const session = await client.query<IdRow>(
        "select id from attendance_session_types where organisation_id = $1 and key = $2",
        [orgId, sessionKey],
      );
      sessionId = session.rows[0]?.id ?? null;
    }
    const inserted = await client.query<IdRow>(
      `insert into school_day_periods (
         organisation_id, school_day_profile_id, name, period_type, starts_at, ends_at,
         sort_order, attendance_session_type_id, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [orgId, profileId, name, type, startsAt, endsAt, sortOrder, sessionId, createdBy],
    );
    return inserted.rows[0]!.id;
  }

  async function lesson(row: {
    weekday: number;
    periodId?: string;
    startsAt: string;
    endsAt: string;
    className: string;
    subjectKey?: string;
    roomId?: string | null;
    teacherId: string;
    lessonType?: string;
  }) {
    const inserted = await client.query<IdRow>(
      `insert into timetable_entries (
         organisation_id, academic_year_id, school_day_period_id, weekday, starts_at, ends_at,
         class_id, subject_id, room_id, lesson_type, effective_from, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2026-09-01',$11) returning id`,
      [
        orgId,
        academicYearId,
        row.periodId ?? null,
        row.weekday,
        row.startsAt,
        row.endsAt,
        input.classIds.get(row.className),
        row.subjectKey ? input.subjects.get(row.subjectKey) : null,
        row.roomId ?? null,
        row.lessonType ?? "lesson",
        createdBy,
      ],
    );
    await client.query(
      `insert into timetable_entry_teachers (
         organisation_id, timetable_entry_id, staff_profile_id, participation_role, is_primary
       ) values ($1,$2,$3,'teacher',true)`,
      [orgId, inserted.rows[0]!.id, row.teacherId],
    );
    return inserted.rows[0]!.id;
  }

  if (input.variant === "greenwood") {
    const receptionRoom = await room("Reception Classroom", "REC", { building: "Infant wing" });
    const year3a = await room("Year 3A", "3A", { building: "Main building" });
    const year4a = await room("Year 4A", "4A", { building: "Main building" });
    const year5a = await room("Year 5A", "5A", { building: "Main building" });
    const lab = await room("Science Lab", "SCI", { building: "STEM block" });
    const ict = await room("ICT Suite", "ICT", { building: "STEM block" });
    const hall = await room("Sports Hall", "HALL", { building: "Sports", type: "teaching" });
    const library = await room("Library", "LIB", { building: "Main building", type: "non_teaching" });
    await room("Art Room", "ART", { building: "Creative block" });
    await room("Music Room", "MUS", { building: "Creative block" });

    const midweek = await profile("Standard day", [1, 2, 3, 4], "08:30", "15:15");
    const friday = await profile("Friday early finish", [5], "08:30", "14:00");
    const mid = {
      reg: await period(midweek, "Registration", "registration", "08:30", "08:45", 1, "am"),
      p1: await period(midweek, "Period 1", "teaching", "08:45", "09:35", 2),
      p2: await period(midweek, "Period 2", "teaching", "09:35", "10:25", 3),
      brk: await period(midweek, "Break", "break", "10:25", "10:45", 4),
      p3: await period(midweek, "Period 3", "teaching", "10:45", "11:35", 5),
      p4: await period(midweek, "Period 4", "teaching", "11:35", "12:25", 6),
      lunch: await period(midweek, "Lunch", "lunch", "12:25", "13:15", 7),
      p5: await period(midweek, "Period 5", "teaching", "13:15", "14:05", 8),
      p6: await period(midweek, "Period 6", "teaching", "14:05", "14:55", 9),
    };
    const fri = {
      reg: await period(friday, "Registration", "registration", "08:30", "08:45", 1, "am"),
      p1: await period(friday, "Period 1", "teaching", "08:45", "09:35", 2),
      p2: await period(friday, "Period 2", "teaching", "09:35", "10:25", 3),
      brk: await period(friday, "Break", "break", "10:25", "10:45", 4),
      p3: await period(friday, "Period 3", "teaching", "10:45", "11:35", 5),
      p4: await period(friday, "Period 4", "teaching", "11:35", "12:25", 6),
      lunch: await period(friday, "Lunch", "lunch", "12:25", "13:10", 7),
      p5: await period(friday, "Period 5", "teaching", "13:10", "14:00", 8),
    };

    const hannah = input.teachers.hannah!;
    const daniel = input.teachers.daniel!;
    const elena = input.teachers.elena!;
    const classDays = [1, 2, 3, 4] as const;
    const primaryBlocks: Array<{
      className: string;
      teacherId: string;
      roomId: string;
      slots: Array<{ period: string; subject?: string; lessonType?: string; roomId?: string }>;
    }> = [
      {
        className: "Reception",
        teacherId: elena,
        roomId: receptionRoom,
        slots: [
          { period: "reg", lessonType: "registration" },
          { period: "p1", subject: "phonics" },
          { period: "p2", subject: "reading" },
          { period: "p3", subject: "mathematics" },
          { period: "p4", subject: "english" },
          { period: "p5", subject: "art" },
          { period: "p6", subject: "pe", roomId: hall },
        ],
      },
      {
        className: "3A",
        teacherId: hannah,
        roomId: year3a,
        slots: [
          { period: "reg", lessonType: "registration" },
          { period: "p1", subject: "mathematics" },
          { period: "p2", subject: "english" },
          { period: "p3", subject: "science", roomId: lab },
          { period: "p4", subject: "computing", roomId: ict },
          { period: "p5", subject: "history" },
          { period: "p6", lessonType: "assembly" },
        ],
      },
      {
        className: "4A",
        teacherId: daniel,
        roomId: year4a,
        slots: [
          { period: "reg", lessonType: "registration" },
          { period: "p1", subject: "english" },
          { period: "p2", subject: "mathematics" },
          { period: "p3", subject: "geography" },
          { period: "p4", subject: "science", roomId: lab },
          { period: "p5", subject: "pe", roomId: hall },
          { period: "p6", subject: "music" },
        ],
      },
    ];

    for (const weekday of classDays) {
      for (const block of primaryBlocks) {
        for (const slot of block.slots) {
          const periodId = mid[slot.period as keyof typeof mid];
          const periodRow = await client.query<{ starts_at: string; ends_at: string }>(
            "select starts_at::text, ends_at::text from school_day_periods where id = $1",
            [periodId],
          );
          await lesson({
            weekday,
            periodId,
            startsAt: periodRow.rows[0]!.starts_at.slice(0, 5),
            endsAt: periodRow.rows[0]!.ends_at.slice(0, 5),
            className: block.className,
            subjectKey: slot.subject,
            roomId: slot.roomId ?? block.roomId,
            teacherId: block.teacherId,
            lessonType: slot.lessonType,
          });
        }
      }
    }

    for (const slot of [
      { className: "Reception", teacherId: elena, roomId: receptionRoom, period: "reg", lessonType: "registration" },
      { className: "Reception", teacherId: elena, roomId: receptionRoom, period: "p1", subject: "phonics" },
      { className: "Reception", teacherId: elena, roomId: receptionRoom, period: "p2", subject: "reading" },
      { className: "Reception", teacherId: elena, roomId: receptionRoom, period: "p3", subject: "mathematics" },
      { className: "Reception", teacherId: elena, roomId: receptionRoom, period: "p4", subject: "english" },
      { className: "Reception", teacherId: elena, roomId: hall, period: "p5", subject: "pe" },
      { className: "3A", teacherId: hannah, roomId: year3a, period: "reg", lessonType: "registration" },
      { className: "3A", teacherId: hannah, roomId: year3a, period: "p1", subject: "mathematics" },
      { className: "3A", teacherId: hannah, roomId: year3a, period: "p2", subject: "english" },
      { className: "3A", teacherId: hannah, roomId: year3a, period: "p3", subject: "pe" },
      { className: "3A", teacherId: hannah, roomId: year3a, period: "p4", subject: "art" },
      { className: "4A", teacherId: daniel, roomId: year4a, period: "reg", lessonType: "registration" },
      { className: "4A", teacherId: daniel, roomId: year4a, period: "p1", subject: "english" },
      { className: "4A", teacherId: daniel, roomId: year4a, period: "p2", subject: "mathematics" },
      { className: "4A", teacherId: daniel, roomId: year4a, period: "p3", subject: "computing", extraRoom: ict },
      { className: "4A", teacherId: daniel, roomId: year4a, period: "p4", subject: "history" },
    ] as Array<{
      className: string;
      teacherId: string;
      roomId: string;
      period: keyof typeof fri;
      subject?: string;
      lessonType?: string;
      extraRoom?: string;
    }>) {
      const periodId = fri[slot.period];
      const periodRow = await client.query<{ starts_at: string; ends_at: string }>(
        "select starts_at::text, ends_at::text from school_day_periods where id = $1",
        [periodId],
      );
      await lesson({
        weekday: 5,
        periodId,
        startsAt: periodRow.rows[0]!.starts_at.slice(0, 5),
        endsAt: periodRow.rows[0]!.ends_at.slice(0, 5),
        className: slot.className,
        subjectKey: slot.subject,
        roomId: slot.extraRoom ?? slot.roomId,
        teacherId: slot.teacherId,
        lessonType: slot.lessonType,
      });
    }

    const p5 = await client.query<{ starts_at: string; ends_at: string }>(
      "select starts_at::text, ends_at::text from school_day_periods where id = $1",
      [fri.p5],
    );
    const english3b = await lesson({
      weekday: 5,
      periodId: fri.p5,
      startsAt: p5.rows[0]!.starts_at.slice(0, 5),
      endsAt: p5.rows[0]!.ends_at.slice(0, 5),
      className: "3B",
      subjectKey: "english",
      roomId: year3a,
      teacherId: hannah,
    });
    await lesson({
      weekday: 5,
      periodId: fri.p5,
      startsAt: p5.rows[0]!.starts_at.slice(0, 5),
      endsAt: p5.rows[0]!.ends_at.slice(0, 5),
      className: "5A",
      subjectKey: "mathematics",
      roomId: year5a,
      teacherId: daniel,
    });

    const mondayP1 = await client.query<IdRow>(
      `select te.id
       from timetable_entries te
       join timetable_entry_teachers tet on tet.timetable_entry_id = te.id
       where te.organisation_id = $1
         and te.class_id = $2
         and te.weekday = 1
         and tet.staff_profile_id = $3
         and te.starts_at = '08:45'
       limit 1`,
      [orgId, input.classIds.get("3A"), hannah],
    );
    if (input.teachers.head && mondayP1.rows[0]) {
      await client.query(
        `insert into timetable_covers (
           organisation_id, timetable_entry_id, cover_date, original_staff_profile_id,
           covering_staff_profile_id, reason, assigned_by
         ) values ($1,$2,'2026-09-07',$3,$4,'INSET cover example',$5)`,
        [orgId, mondayP1.rows[0].id, hannah, input.teachers.head, createdBy],
      );
    }
    const fridayPe = await client.query<IdRow>(
      `select id from timetable_entries
       where organisation_id = $1 and class_id = $2 and weekday = 5 and starts_at = '10:45'
       limit 1`,
      [orgId, input.classIds.get("3A")],
    );
    if (fridayPe.rows[0]) {
      await client.query(
        `insert into timetable_exceptions (
           organisation_id, timetable_entry_id, exception_date, exception_type,
           replacement_room_id, parent_visible_note, created_by
         ) values ($1,$2,'2026-09-11','room_changed',$3,'PE is in the sports hall this Friday.',$4)`,
        [orgId, fridayPe.rows[0].id, hall, createdBy],
      );
    }
    void english3b;
    void library;
  } else {
    const classroom = await room("Oak Classroom 3A", "O3A", { building: "Oak House" });
    const oakHall = await room("Oak Hall", "OHALL", { building: "Oak House" });
    const midweek = await profile("Oak weekday", [1, 2, 3, 4, 5], "09:00", "15:00");
    const reg = await period(midweek, "Morning registration", "registration", "09:00", "09:15", 1, "am");
    const p1 = await period(midweek, "Lesson 1", "teaching", "09:15", "10:15", 2);
    const p2 = await period(midweek, "Lesson 2", "teaching", "10:15", "11:15", 3);
    const brk = await period(midweek, "Break", "break", "11:15", "11:30", 4);
    const p3 = await period(midweek, "Lesson 3", "teaching", "11:30", "12:30", 5);
    void brk;
    const mark = input.teachers.mark!;
    for (const weekday of [1, 2, 3, 4, 5]) {
      for (const slot of [
        { periodId: reg, startsAt: "09:00", endsAt: "09:15", lessonType: "registration" },
        { periodId: p1, startsAt: "09:15", endsAt: "10:15", subject: "english" },
        { periodId: p2, startsAt: "10:15", endsAt: "11:15", subject: "mathematics" },
        { periodId: p3, startsAt: "11:30", endsAt: "12:30", subject: "science", roomId: oakHall },
      ]) {
        await lesson({
          weekday,
          periodId: slot.periodId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          className: "3A",
          subjectKey: slot.subject,
          roomId: slot.roomId ?? classroom,
          teacherId: mark,
          lessonType: slot.lessonType,
        });
      }
    }
  }
}

async function seedGreenwood(
  client: pg.Client,
  hashes: Record<string, string>,
): Promise<{ orgId: string; accounts: DemoSeedResult["accounts"] }> {
  const orgId = await createOrganisation(client, DEMO_ORGANISATIONS.greenwood);
  await seedSchoolStatutory(client, {
    organisationId: orgId,
    statutoryName: "Greenwood Academy (synthetic demo)",
    establishmentNumber: "9901",
    localAuthorityNumber: "201",
    urn: "999001",
  });
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
  for (const [key, name] of [
    ["phonics", "Phonics"],
    ["reading", "Reading"],
  ] as const) {
    const inserted = await client.query<IdRow>(
      "insert into subjects (organisation_id, key, name) values ($1, $2, $3) returning id",
      [orgId, key, name],
    );
    subjects.set(key, inserted.rows[0]!.id);
  }
  const oakHouse = await client.query<IdRow>(
    `insert into houses (organisation_id, name, short_code, colour)
     values ($1, 'Oak', 'OAK', '#2f6f4e') returning id`,
    [orgId],
  );
  await client.query(
    `insert into houses (organisation_id, name, short_code, colour)
     values ($1, 'Willow', 'WIL', '#6b8e23')`,
    [orgId],
  );
  await client.query(
    `insert into houses (organisation_id, name, short_code, colour)
     values ($1, 'Beech', 'BCH', '#8b5a2b')`,
    [orgId],
  );

  const classIds = new Map<string, string>();
  for (const row of [
    { name: "Reception", year: "R" },
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
  const headStaffId = await seedStaff(client, {
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
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'subject_teacher', '2026-09-01')`,
    [orgId, classIds.get("3B"), teacherStaffId],
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
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'subject_teacher', '2026-09-01')`,
    [orgId, classIds.get("5A"), extraStaffId],
  );

  const receptionTeacher = await insertUser(client, {
    email: "demo.teacher3@greenwood.test",
    fullName: "Elena Rossi",
    kind: "staff",
    passwordHash: hashes[DEMO_ACCOUNTS.greenwoodTeacher.password],
  });
  await addMembership(client, orgId, receptionTeacher, "school.teacher");
  const receptionStaffId = await seedStaff(client, {
    organisationId: orgId,
    userId: receptionTeacher,
    jobTitle: "Reception class teacher",
    employeeNumber: "GW-005",
  });
  await client.query(
    `insert into class_staff_assignments (
       organisation_id, class_id, staff_profile_id, assignment_role, started_on
     ) values ($1, $2, $3, 'form_tutor', '2026-09-01')`,
    [orgId, classIds.get("Reception"), receptionStaffId],
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
    startedOn: "2026-11-03",
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
  const harper = await seedStudent(client, {
    organisationId: orgId,
    academicYearId,
    yearGroupId: yearGroups.get("4")!,
    classId: classIds.get("4A")!,
    legalName: "Harper Quinn",
    admissionNumber: "GW-2026-009",
    dateOfBirth: "2017-02-11",
    endedOn: "2026-12-18",
    enrolmentStatus: "left",
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

  await client.query(
    `insert into student_additional_needs (
       organisation_id, student_profile_id, allergies, medication, dietary_requirements, medical_conditions, send_notes
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      amelia.profileId,
      "Peanut allergy (synthetic demo example)",
      "Antihistamine as recorded by the school nurse (demo)",
      "No nuts",
      "Mild asthma — inhaler as needed (demo)",
      "EHCP for speech and language support (synthetic demo)",
    ],
  );
  await client.query(
    `insert into student_medications (
       organisation_id, student_profile_id, medication_name, dosage, route, schedule_text, is_prn,
       started_on, ended_on, instructions, administration_responsibility, parent_consent_status,
       parent_consent_on, review_on, status, stopped_reason, parent_visible, internal_notes
     ) values
       ($1,$2,'Cetirizine','5mg','oral','Once daily during hay-fever season', false,
        '2026-04-01', null,'Give with water after lunch','school_staff','granted','2026-04-01',
        '2027-04-01','active', null, true, 'Internal nurse cupboard location: shelf A (demo)'),
       ($1,$2,'Salbutamol inhaler','2 puffs','inhaled','As required for wheeze', true,
        '2026-09-01', null,'Supervise inhaler technique; send spare with trips','school_staff','granted','2026-09-01',
        '2027-03-01','active', null, true, null),
       ($1,$2,'Amoxicillin','250mg','oral','Three times daily for 7 days', false,
        '2026-01-10','2026-01-17','Completed course — historical only','parent','granted','2026-01-10',
        null,'stopped', 'Course completed', true, 'Do not restart without GP advice (demo)'),
       ($1,$2,'Barrier cream','thin layer','topical','After first aid only', true,
        '2026-09-01', null,'Staff-administered after playground first aid','school_staff','not_required', null,
        null,'active', null, false, 'Not parent-visible — first-aid cupboard (demo)')`,
    [orgId, amelia.profileId],
  );
  await client.query(
    `insert into student_dietary_requirements (
       organisation_id, student_profile_id, requirement_type, requirement, foods_to_avoid,
       safe_alternatives, is_religious_or_cultural, related_allergy, texture_feeding_notes,
       parent_confirmed_on, review_on, status, parent_visible, internal_notes
     ) values
       ($1,$2,'allergy','Nut-free diet','Peanuts, mixed nuts, nut oils',
        'Use school nut-free packed lunch alternatives', false,
        'Linked to recorded peanut allergy', null,
        '2026-09-01','2027-09-01','active', true, 'Kitchen allergen matrix row 12 (demo)'),
       ($1,$2,'religious','Halal meat only','Non-halal meat and gelatine',
        'Vegetarian option when halal is unavailable', true,
        null, null,
        '2026-09-01','2027-09-01','active', true, null)`,
    [orgId, amelia.profileId],
  );

  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    legalForename: "Amelia",
    legalSurname: "Khan",
    sex: "F",
    upn: "P201990100001",
    ethnicityCode: "APKN",
    languageCode: "ENG",
    sendProvisionCode: "E",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: jack.profileId,
    legalForename: "Jack",
    legalSurname: "Brennan",
    sex: "M",
    ethnicityCode: "WBRI",
    languageCode: "ENG",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: priya.profileId,
    legalForename: "Priya",
    legalSurname: "Shah",
    sex: "F",
    upn: "T201990100003",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: yusuf.profileId,
    legalForename: "Yusuf",
    legalSurname: "Khan",
    sex: "M",
    upn: "G201990100004",
    ethnicityCode: "APKN",
    languageCode: "URD",
  });
  await client.query(
    `insert into student_fsm_periods (organisation_id, student_profile_id, started_on, ended_on)
     values ($1, $2, '2026-09-01', '2026-12-31')`,
    [orgId, yusuf.profileId],
  );
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: maya.profileId,
    legalForename: "Maya",
    legalSurname: "Ellis",
    sex: "F",
    upn: "W201990100005",
    ethnicityCode: "WBRI",
    languageCode: "ENG",
    serviceChild: true,
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: oliver.profileId,
    legalForename: "Oliver",
    legalSurname: "Brooks",
    sex: "M",
    upn: "K201990100006",
    ethnicityCode: "WBRI",
    languageCode: "ENG",
    dateOfAdmission: "2026-11-03",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: sophie.profileId,
    legalForename: "Sophie",
    legalSurname: "Chen",
    sex: "F",
    upn: "Z201990100007",
    ethnicityCode: "CHNE",
    languageCode: "ENG",
    lookedAfterStatus: "previously_looked_after",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: leo.profileId,
    legalForename: "Leo",
    legalSurname: "Nwosu",
    sex: "M",
    upn: "N201990100008",
    ethnicityCode: "BAFR",
    languageCode: "ENG",
    lookedAfterStatus: "looked_after",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: harper.profileId,
    legalForename: "Harper",
    legalSurname: "Quinn",
    sex: "F",
    upn: "C201990100009",
    ethnicityCode: "WBRI",
    languageCode: "ENG",
    dateOfLeaving: "2026-12-18",
    leavingReasonCode: "SC",
    previousSchoolName: null,
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

  const fractions = await seedAssignment(client, {
    organisationId: orgId,
    title: "Year 3 Fractions",
    description: "Complete the fractions worksheet. Show your working for each question.",
    workTypeKey: "homework",
    subjectId: subjects.get("mathematics")!,
    academicYearId,
    intendedYearGroupId: yearGroups.get("3"),
    createdBy: teacherId,
    dueAtSql: "now() + interval '2 days'",
    teacherNotes: "Watch Jack — he needed extra support last week. Do not share this note.",
    maximumMarks: 20,
    classIds: [classIds.get("3A")!],
    resource: {
      title: "Fractions worksheet",
      kind: "worksheet",
      url: "https://example.com/greenwood/year3-fractions",
    },
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: fractions,
    studentProfileId: amelia.profileId,
    submittedBy: amelia.userId,
    textResponse: "I coloured 1/2 and 1/4. Equivalent fractions: 2/4 = 1/2.",
    status: "completed",
    mark: {
      score: 18,
      maximumMarks: 20,
      feedback: "Clear working, Amelia. Check the last equivalent fraction.",
      releasedToStudent: true,
      releasedToParent: true,
      markedBy: teacherId,
    },
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: fractions,
    studentProfileId: priya.profileId,
    submittedBy: priya.userId,
    textResponse: "I finished the first page of the worksheet.",
  });

  const science = await seedAssignment(client, {
    organisationId: orgId,
    title: "Materials investigation",
    description: "Write three sentences about how we grouped classroom materials.",
    workTypeKey: "classwork",
    subjectId: subjects.get("science")!,
    academicYearId,
    intendedYearGroupId: yearGroups.get("3"),
    createdBy: teacherId,
    dueAtSql: "now() - interval '3 days'",
    teacherNotes: "Overdue follow-up for 3A.",
    maximumMarks: 10,
    classIds: [classIds.get("3A")!],
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: science,
    studentProfileId: jack.profileId,
    submittedBy: jack.userId ?? teacherId,
    textResponse: "Wood is hard. Metal is shiny. Plastic can bend.",
  });

  const poetry = await seedAssignment(client, {
    organisationId: orgId,
    title: "Poetry recitation",
    description: "Practise the verse we started in English and write two lines from memory.",
    workTypeKey: "homework",
    subjectId: subjects.get("english")!,
    academicYearId,
    createdBy: teacherId,
    dueAtSql: "now() + interval '5 days'",
    classIds: [classIds.get("3A")!],
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: poetry,
    studentProfileId: amelia.profileId,
    submittedBy: amelia.userId,
    textResponse: "The owl and the pussycat went to sea.",
    status: "resubmission_requested",
    mark: {
      score: 8,
      maximumMarks: 10,
      feedback: "Good start — please add the second line and resubmit.",
      releasedToStudent: true,
      releasedToParent: false,
      resubmission: true,
      markedBy: teacherId,
    },
  });

  await seedAssignment(client, {
    organisationId: orgId,
    title: "Reading journal",
    description: "Write three sentences about your independent reading book.",
    workTypeKey: "reading",
    subjectId: subjects.get("english")!,
    academicYearId,
    createdBy: teacherId,
    dueAtSql: "now() + interval '10 days'",
    classIds: [classIds.get("3A")!, classIds.get("3B")!],
  });

  const year5 = await seedAssignment(client, {
    organisationId: orgId,
    title: "Year 5 Fractions",
    description: "Convert improper fractions and mixed numbers.",
    workTypeKey: "homework",
    subjectId: subjects.get("mathematics")!,
    academicYearId,
    intendedYearGroupId: yearGroups.get("5"),
    createdBy: headId,
    dueAtSql: "now() + interval '4 days'",
    maximumMarks: 25,
    classIds: [classIds.get("5A")!],
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: year5,
    studentProfileId: yusuf.profileId,
    submittedBy: yusuf.userId,
    textResponse: "7/4 = 1 3/4. 2 1/2 = 5/2.",
    status: "returned",
    mark: {
      score: 22,
      maximumMarks: 25,
      feedback: "Accurate conversions. Challenge: try 11/3 next.",
      releasedToStudent: true,
      releasedToParent: true,
      markedBy: headId,
    },
  });

  await client.query(
    `insert into learning_assignments (
       organisation_id, title, description, work_type_id, subject_id, academic_year_id,
       created_by, due_at, teacher_notes
     ) values ($1, 'Spelling list (draft)', 'Not published yet.', $2, $3, $4, $5, now() + interval '8 days', 'Draft only')`,
    [
      orgId,
      await workTypeId(client, orgId, "practice"),
      subjects.get("english"),
      academicYearId,
      teacherId,
    ],
  );

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

  const autumnPeriod = await seedReportingPeriod(client, {
    organisationId: orgId,
    academicYearId,
    name: "Autumn Term",
    startsOn: "2026-09-01",
    endsOn: "2026-12-18",
    status: "open",
  });
  const springPeriod = await seedReportingPeriod(client, {
    organisationId: orgId,
    academicYearId,
    name: "Spring Term",
    startsOn: "2027-01-05",
    endsOn: "2027-03-26",
    status: "planned",
  });

  const mathsTest = await seedFormalAssessment(client, {
    organisationId: orgId,
    academicYearId,
    reportingPeriodId: autumnPeriod,
    title: "Year 3 Maths Test",
    subjectId: subjects.get("mathematics")!,
    yearGroupId: yearGroups.get("3")!,
    typeKey: "class_test",
    assessmentDate: "2026-10-14",
    createdBy: teacherId,
    classIds: [classIds.get("3A")!],
    maximumMarks: 20,
    gradeSchemeKey: "age_related",
    status: "published",
    internalNotes: "Moderation: check Jack's working-towards judgement. Do not share with parents.",
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: mathsTest,
    studentProfileId: amelia.profileId,
    enteredBy: teacherId,
    rawScore: 18,
    maximumScore: 20,
    gradeCode: "EX",
    comment: "Secure on place value and addition.",
    releasedToStudent: true,
    releasedToParent: true,
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: mathsTest,
    studentProfileId: jack.profileId,
    enteredBy: teacherId,
    rawScore: 11,
    maximumScore: 20,
    gradeCode: "WT",
    comment: "Keep practising number bonds.",
    releasedToStudent: true,
    releasedToParent: false,
  });

  const englishReading = await seedFormalAssessment(client, {
    organisationId: orgId,
    academicYearId,
    reportingPeriodId: autumnPeriod,
    title: "Year 3 English reading assessment",
    subjectId: subjects.get("english")!,
    yearGroupId: yearGroups.get("3")!,
    typeKey: "reading_assessment",
    assessmentDate: "2026-11-04",
    createdBy: teacherId,
    classIds: [classIds.get("3A")!],
    gradeSchemeKey: "age_related",
    status: "published",
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: englishReading,
    studentProfileId: amelia.profileId,
    enteredBy: teacherId,
    gradeCode: "GD",
    teacherJudgement: "Greater Depth",
    comment: "Reads with fluency and inference.",
    releasedToStudent: false,
    releasedToParent: true,
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: englishReading,
    studentProfileId: jack.profileId,
    enteredBy: teacherId,
    gradeCode: "EX",
    releasedToStudent: true,
    releasedToParent: true,
  });

  const sciencePractical = await seedFormalAssessment(client, {
    organisationId: orgId,
    academicYearId,
    reportingPeriodId: autumnPeriod,
    title: "Year 3 Science practical",
    subjectId: subjects.get("science")!,
    yearGroupId: yearGroups.get("3")!,
    typeKey: "practical_assessment",
    assessmentDate: "2026-11-18",
    createdBy: teacherId,
    classIds: [classIds.get("3A")!],
    maximumMarks: 10,
    gradeSchemeKey: "percentage",
    status: "open",
    internalNotes: "Unreleased science scores — keep internal until moderation.",
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: sciencePractical,
    studentProfileId: amelia.profileId,
    enteredBy: teacherId,
    rawScore: 8,
    maximumScore: 10,
    comment: "Clear observations.",
    releasedToStudent: false,
    releasedToParent: false,
  });

  await seedFormalAssessment(client, {
    organisationId: orgId,
    academicYearId,
    reportingPeriodId: autumnPeriod,
    title: "Year 6 Maths Assessment",
    subjectId: subjects.get("mathematics")!,
    yearGroupId: yearGroups.get("6")!,
    typeKey: "end_of_unit",
    assessmentDate: "2026-10-21",
    createdBy: adminId,
    classIds: [classIds.get("6A")!],
    maximumMarks: 40,
    gradeSchemeKey: "percentage",
    status: "published",
  }).then(async (id) => {
    await seedFormalResult(client, {
      organisationId: orgId,
      assessmentId: id,
      studentProfileId: sophie.profileId,
      enteredBy: adminId,
      rawScore: 31,
      maximumScore: 40,
      releasedToStudent: true,
      releasedToParent: true,
    });
  });

  const ageScheme = await lookupId(
    client,
    "select id from academic_grade_schemes where organisation_id = $1 and key = 'age_related'",
    [orgId],
  );
  const expectedLevel = await lookupId(
    client,
    "select id from academic_grade_scheme_levels where scheme_id = $1 and code = 'EX'",
    [ageScheme],
  );
  const towardsLevel = await lookupId(
    client,
    "select id from academic_grade_scheme_levels where scheme_id = $1 and code = 'WT'",
    [ageScheme],
  );
  await client.query(
    `insert into academic_targets (
       organisation_id, student_profile_id, academic_year_id, subject_id, grade_scheme_id,
       target_level_id, target_value, baseline_level_id, baseline_value, note, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      orgId,
      amelia.profileId,
      academicYearId,
      subjects.get("mathematics")!,
      ageScheme,
      expectedLevel,
      "Expected",
      towardsLevel,
      "Working Towards",
      "End-of-year maths target from autumn baseline.",
      teacherId,
    ],
  );

  const publishedReport = await client.query<IdRow>(
    `insert into academic_reports (
       organisation_id, student_profile_id, academic_year_id, reporting_period_id,
       general_comment, created_by
     ) values ($1,$2,$3,$4,$5,$6)
     returning id`,
    [
      orgId,
      amelia.profileId,
      academicYearId,
      autumnPeriod,
      "Amelia has settled well in Year 3A and is working at the expected standard in mathematics.",
      teacherId,
    ],
  );
  await client.query(
    `insert into academic_report_sections (
       organisation_id, report_id, subject_id, teacher_user_id, attainment_summary,
       progress_judgement, teacher_comment, target_next_steps, sort_order
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
    [
      orgId,
      publishedReport.rows[0]!.id,
      subjects.get("mathematics")!,
      teacherId,
      "Expected standard on the autumn maths test (18/20).",
      "Good progress from the autumn baseline.",
      "Amelia explains her methods clearly.",
      "Continue with greater-depth reasoning problems.",
    ],
  );
  await client.query("update academic_reports set status = 'published' where id = $1", [
    publishedReport.rows[0]!.id,
  ]);
  await client.query(
    `insert into academic_report_publications (organisation_id, report_id, payload, published_by)
     values ($1, $2, $3::jsonb, $4)`,
    [
      orgId,
      publishedReport.rows[0]!.id,
      JSON.stringify({
        generalComment:
          "Amelia has settled well in Year 3A and is working at the expected standard in mathematics.",
        sections: [
          {
            subject_id: subjects.get("mathematics"),
            subject_name: "Mathematics",
            attainment_summary: "Expected standard on the autumn maths test (18/20).",
            progress_judgement: "Good progress from the autumn baseline.",
            teacher_comment: "Amelia explains her methods clearly.",
            target_next_steps: "Continue with greater-depth reasoning problems.",
            sort_order: 1,
          },
        ],
      }),
      teacherId,
    ],
  );

  await client.query(
    `insert into academic_reports (
       organisation_id, student_profile_id, academic_year_id, reporting_period_id,
       general_comment, created_by
     ) values ($1,$2,$3,$4,$5,$6)`,
    [
      orgId,
      amelia.profileId,
      academicYearId,
      springPeriod,
      "Draft spring comment — not visible to parents or pupils.",
      teacherId,
    ],
  );

  const class3A = classIds.get("3A")!;
  const ameliaSubject = { studentProfileId: amelia.profileId, classId: class3A, yearGroupId: year3 };
  const yusufSubject = {
    studentProfileId: yusuf.profileId,
    classId: classIds.get("5A")!,
    yearGroupId: yearGroups.get("5")!,
  };
  const jackSubject = { studentProfileId: jack.profileId, classId: class3A, yearGroupId: year3 };

  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Welcome back to Greenwood",
    body: "Term starts on 1 September. Please read the parent and student notices in the portal.",
    createdBy: adminId,
    pinned: true,
    targets: [{ targetType: "whole_school" }],
    resource: {
      title: "Term dates",
      kind: "url",
      url: "https://example.com/greenwood/term-dates",
    },
    recipients: [
      { userId: adminId, audienceRole: "staff" },
      { userId: headId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: secondParentId, audienceRole: "parent" },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
      { userId: yusuf.userId, audienceRole: "student", subjects: [yusufSubject] },
    ],
  });
  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Parents' evening bookings",
    body: "Book your autumn parents' evening slot. This notice is for families only.",
    createdBy: adminId,
    priority: "important",
    targets: [{ targetType: "parents" }],
    recipients: [
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: secondParentId, audienceRole: "parent" },
    ],
  });
  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Year 3 swimming kit",
    body: "3A pupils need a named swimming kit next Wednesday.",
    createdBy: teacherId,
    targets: [{ targetType: "class", classId: class3A }],
    recipients: [
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject] },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
      { userId: jack.userId, audienceRole: "student", subjects: [jackSubject] },
    ],
  });
  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Staff briefing Friday",
    body: "Internal briefing in the staff room at 08:00. Do not share with families.",
    createdBy: adminId,
    priority: "urgent",
    targets: [{ targetType: "staff" }],
    recipients: [
      { userId: adminId, audienceRole: "staff" },
      { userId: headId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
    ],
  });
  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Acceptable use policy reminder",
    body: "Please acknowledge that you have read this term's acceptable use reminder.",
    createdBy: adminId,
    acknowledgementRequired: true,
    targets: [{ targetType: "whole_school" }],
    recipients: [
      { userId: adminId, audienceRole: "staff" },
      { userId: headId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: secondParentId, audienceRole: "parent" },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
    ],
  });

  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "October half term",
    description: "School closed for October half term.",
    typeKey: "school_holiday",
    startsAt: "2026-10-26T00:00:00Z",
    endsAt: "2026-10-30T23:59:00Z",
    allDay: true,
    createdBy: adminId,
    targets: [{ targetType: "whole_school" }],
    audience: [
      { userId: adminId, audienceRole: "staff" },
      { userId: headId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
    ],
  });
  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "INSET day",
    typeKey: "inset_day",
    startsAt: "2026-09-01T00:00:00Z",
    endsAt: "2026-09-01T23:59:00Z",
    allDay: true,
    createdBy: adminId,
    targets: [{ targetType: "whole_school" }],
    audience: [
      { userId: adminId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
    ],
  });
  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "Autumn parents' evening",
    description: "Year 3 families meet form tutors.",
    typeKey: "parents_evening",
    startsAt: "2026-10-14T16:00:00Z",
    endsAt: "2026-10-14T19:00:00Z",
    location: "Main hall",
    createdBy: adminId,
    targets: [{ targetType: "year_group", yearGroupId: year3 }],
    audience: [
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject] },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
    ],
  });
  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "Sports day",
    typeKey: "sports_day",
    startsAt: "2026-06-19T09:00:00Z",
    endsAt: "2026-06-19T15:00:00Z",
    location: "Playing field",
    createdBy: adminId,
    targets: [{ targetType: "whole_school" }],
    audience: [
      { userId: adminId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      { userId: parentId, audienceRole: "parent", subjects: [ameliaSubject, yusufSubject] },
      { userId: amelia.userId, audienceRole: "student", subjects: [ameliaSubject] },
    ],
  });
  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "Staff meeting",
    typeKey: "meeting",
    startsAt: "2026-09-04T15:30:00Z",
    endsAt: "2026-09-04T16:30:00Z",
    location: "Staff room",
    createdBy: adminId,
    targets: [{ targetType: "staff" }],
    audience: [
      { userId: adminId, audienceRole: "staff" },
      { userId: headId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
    ],
  });

  const class3APupils = [
    { studentProfileId: amelia.profileId, classId: class3A, yearGroupId: year3 },
    { studentProfileId: jack.profileId, classId: class3A, yearGroupId: year3 },
    { studentProfileId: priya.profileId, classId: class3A, yearGroupId: year3 },
  ];
  const museumWording =
    "I give permission for my child to attend the Year 3 Science Museum visit, including coach travel, and confirm that emergency/medical information held by the school is up to date.";
  const museumId = await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Year 3 Science Museum visit",
    description: "Class 3A visit to the Science Museum. Packed lunch required. Consent is a school acknowledgement, not an electronic signature.",
    typeKey: "trip",
    academicYearId,
    startsAt: "2026-11-12T09:00:00Z",
    endsAt: "2026-11-12T15:30:00Z",
    location: "Science Museum",
    externalAddress: "Exhibition Road, London SW7 2DD",
    meetingPoint: "School playground 08:45",
    returnPoint: "School playground 15:45",
    capacity: 20,
    responseDeadlineAt: "2026-11-04T16:00:00Z",
    consentRequired: true,
    parentNotes: "Please return consent by 4 November. Packed lunch and a waterproof coat are required.",
    staffNotes: "Coach booked for 08:45. Internal staffing plan — not visible to parents.",
    paymentRequired: true,
    priceAmountMinor: 1250,
    priceCurrency: "GBP",
    paymentDeadlineAt: "2026-11-06T16:00:00Z",
    paymentInstructions: "Museum visit fee covers coach travel. Pay in the parent Payments area.",
    chargePolicy: "on_confirmed",
    targets: [{ targetType: "class", classId: class3A }],
    staff: [{ staffUserId: teacherId, staffRole: "trip_leader" }],
    clauses: [
      { clauseKey: "permission_to_attend", title: "Permission to attend", wording: museumWording },
      {
        clauseKey: "emergency_treatment",
        title: "Emergency treatment",
        wording: "I agree that school staff may seek emergency medical treatment if needed during this visit.",
      },
    ],
    documents: [
      { title: "Science Museum trip letter", visibility: "staff_and_parents" },
      { title: "Staff risk-assessment summary", visibility: "staff" },
    ],
    eligible: class3APupils,
    participants: [
      { studentProfileId: jack.profileId, registrationStatus: "confirmed", source: "staff_offline" },
      { studentProfileId: amelia.profileId, registrationStatus: "confirmed", source: "parent_consent" },
    ],
    responses: [
      {
        studentProfileId: jack.profileId,
        actorUserId: adminId,
        channel: "staff_offline",
        response: "consented",
        wording: museumWording,
      },
      {
        studentProfileId: amelia.profileId,
        actorUserId: parentId,
        guardianUserId: parentId,
        channel: "parent_portal",
        response: "consented",
        wording: museumWording,
      },
    ],
    updates: [{ body: "Please bring a waterproof coat. Departure remains 08:45 from the playground." }],
  });
  const chessId = await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Chess Club",
    description: "Tuesday after-school chess club in the library. Limited to two confirmed places in this demo so the waiting list is visible.",
    typeKey: "club",
    academicYearId,
    startsAt: "2026-09-08T15:30:00Z",
    endsAt: "2026-09-08T16:30:00Z",
    location: "Library",
    capacity: 2,
    occurrenceKind: "recurring",
    recurrenceWeekdays: [2],
    recurrenceUntil: "2026-12-15",
    parentNotes: "Club runs every Tuesday until 15 December. Places are limited.",
    paymentRequired: true,
    priceAmountMinor: 800,
    priceCurrency: "GBP",
    paymentDeadlineAt: "2026-09-20T16:00:00Z",
    paymentInstructions: "Termly chess club fee.",
    chargePolicy: "on_confirmed",
    targets: [
      { targetType: "student", studentProfileId: amelia.profileId },
      { targetType: "student", studentProfileId: yusuf.profileId },
      { targetType: "student", studentProfileId: jack.profileId },
    ],
    staff: [{ staffUserId: teacherId, staffRole: "lead" }],
    eligible: [
      { studentProfileId: amelia.profileId, classId: class3A, yearGroupId: year3 },
      { studentProfileId: yusuf.profileId, classId: classIds.get("5A")!, yearGroupId: yearGroups.get("5")! },
      { studentProfileId: jack.profileId, classId: class3A, yearGroupId: year3 },
    ],
    participants: [
      { studentProfileId: yusuf.profileId, registrationStatus: "confirmed", source: "staff_assigned" },
      { studentProfileId: jack.profileId, registrationStatus: "confirmed", source: "staff_assigned" },
      {
        studentProfileId: amelia.profileId,
        registrationStatus: "waitlisted",
        waitingListPosition: 1,
        source: "staff_assigned",
      },
    ],
  });
  await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Year 3 vs Oak football fixture",
    description: "Selected pupils play a friendly fixture. Hannah Cole is the accompanying teacher.",
    typeKey: "sports_fixture",
    academicYearId,
    startsAt: "2026-10-09T13:30:00Z",
    endsAt: "2026-10-09T15:00:00Z",
    location: "Playing field",
    studentVisible: true,
    parentVisible: true,
    parentNotes: "Football boots and shin pads. Collect from the field at 15:15.",
    targets: [
      { targetType: "student", studentProfileId: amelia.profileId },
      { targetType: "student", studentProfileId: jack.profileId },
    ],
    staff: [{ staffUserId: teacherId, staffRole: "lead" }],
    eligible: [
      { studentProfileId: amelia.profileId, classId: class3A, yearGroupId: year3 },
      { studentProfileId: jack.profileId, classId: class3A, yearGroupId: year3 },
    ],
    participants: [
      { studentProfileId: amelia.profileId, registrationStatus: "confirmed", source: "school_assigned" },
      { studentProfileId: jack.profileId, registrationStatus: "confirmed", source: "school_assigned" },
    ],
  });
  await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Year 3 pottery workshop",
    description: "This visit was cancelled after the venue closed. History and any responses are retained.",
    typeKey: "workshop",
    academicYearId,
    startsAt: "2026-10-02T09:30:00Z",
    endsAt: "2026-10-02T12:00:00Z",
    location: "Town pottery studio",
    consentRequired: true,
    status: "cancelled",
    cancelReason: "Venue closed — demo cancellation.",
    parentNotes: "This activity has been cancelled. No further action is required.",
    targets: [{ targetType: "class", classId: class3A }],
    eligible: class3APupils,
  });
  await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Coding club taster",
    description: "Optional student self-sign-up workshop. Parent consent is not required.",
    typeKey: "workshop",
    academicYearId,
    startsAt: "2026-10-16T15:30:00Z",
    endsAt: "2026-10-16T16:30:00Z",
    location: "ICT suite",
    studentSignupEnabled: true,
    consentRequired: false,
    parentNotes: "Pupils in 3A can sign up themselves from the student portal.",
    targets: [{ targetType: "class", classId: class3A }],
    eligible: class3APupils,
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: adminId,
    type: "activity_consent_required",
    category: "activities",
    title: "Consent needed: Year 3 Science Museum visit",
    body: "Please respond for Year 3 Science Museum visit. This is a school consent acknowledgement, not an electronic signature.",
  });

  const museumChargeId = await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Year 3 Science Museum visit",
    categoryKey: "trip",
    studentProfileId: amelia.profileId,
    amountMinor: 1250,
    dueAt: "2026-11-06T16:00:00Z",
    activityId: museumId,
    sourceKind: "activity",
    parentNote: "Museum visit fee covers coach travel.",
    reference: "CHG-2026-000101",
  });
  await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Year 3 Science Museum visit",
    categoryKey: "trip",
    studentProfileId: jack.profileId,
    amountMinor: 1250,
    dueAt: "2026-11-06T16:00:00Z",
    activityId: museumId,
    sourceKind: "activity",
    reference: "CHG-2026-000102",
  });
  const chessYusufChargeId = await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Chess Club",
    categoryKey: "club",
    studentProfileId: yusuf.profileId,
    amountMinor: 800,
    dueAt: "2026-09-20T16:00:00Z",
    activityId: chessId,
    sourceKind: "activity",
    reference: "CHG-2026-000103",
    status: "paid",
  });
  await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Chess Club",
    categoryKey: "club",
    studentProfileId: jack.profileId,
    amountMinor: 800,
    dueAt: "2026-09-20T16:00:00Z",
    activityId: chessId,
    sourceKind: "activity",
    reference: "CHG-2026-000104",
  });
  const bookChargeId = await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Replacement reading book",
    categoryKey: "lost_item",
    studentProfileId: amelia.profileId,
    amountMinor: 800,
    dueAt: "2026-10-01T16:00:00Z",
    parentNote: "Lost library copy of The Hodgeheg.",
    reference: "CHG-2026-000105",
  });
  const refundChargeId = await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Broken recorder",
    categoryKey: "lost_item",
    studentProfileId: jack.profileId,
    amountMinor: 600,
    reference: "CHG-2026-000106",
    status: "refunded",
  });
  await client.query(
    `insert into school_payment_transactions (
       organisation_id, charge_id, reference, amount_minor, currency, payer_user_id,
       channel, provider_key, provider_payment_id, status, paid_at
     ) values ($1,$2,'PAY-2026-000201',800,'GBP',$3,'provider','fake','fake_pay_demo_yusuf','succeeded', now())`,
    [orgId, chessYusufChargeId, parentId],
  );
  const yusufTx = await client.query<IdRow>(
    "select id from school_payment_transactions where reference = 'PAY-2026-000201' and organisation_id = $1",
    [orgId],
  );
  await client.query(
    `insert into school_payment_receipts (organisation_id, charge_id, transaction_id, reference, snapshot)
     values ($1,$2,$3,'RCPT-2026-000201', $4::jsonb)`,
    [
      orgId,
      chessYusufChargeId,
      yusufTx.rows[0]!.id,
      JSON.stringify({
        schoolName: "Greenwood Academy",
        receiptReference: "RCPT-2026-000201",
        chargeReference: "CHG-2026-000103",
        chargeTitle: "Chess Club",
        pupilName: "Yusuf Khan",
        payerName: "Aisha Khan",
        amountMinor: 800,
        currency: "GBP",
        formattedAmount: "£8.00",
        paidAt: "2026-09-02T10:00:00Z",
        provider: "fake",
        providerReference: "fake_p…usuf",
        channel: "provider",
        status: "succeeded",
      }),
    ],
  );
  await client.query(
    `insert into school_payment_transactions (
       organisation_id, charge_id, reference, amount_minor, currency, payer_user_id,
       channel, provider_key, status, paid_at, refunded_amount_minor, offline_method, received_by, received_at
     ) values ($1,$2,'PAY-2026-000202',600,'GBP',$3,'offline','offline','refunded', now(), 600, 'cash', $4, now())`,
    [orgId, refundChargeId, parentId, adminId],
  );
  const refundTx = await client.query<IdRow>(
    "select id from school_payment_transactions where reference = 'PAY-2026-000202' and organisation_id = $1",
    [orgId],
  );
  await client.query(
    `insert into school_payment_refunds (
       organisation_id, charge_id, transaction_id, reference, amount_minor, currency,
       reason, requested_by, provider_key, provider_refund_id, status, completed_at
     ) values ($1,$2,$3,'RFD-2026-000201',600,'GBP','Instrument returned',$4,'offline','offline_re_demo','succeeded', now())`,
    [orgId, refundChargeId, refundTx.rows[0]!.id, adminId],
  );
  await client.query(
    `insert into school_finance_counters (organisation_id, kind, year, last_value)
     values ($1, 'charge', 2026, 106), ($1, 'payment', 2026, 202), ($1, 'receipt', 2026, 201), ($1, 'refund', 2026, 201)
     on conflict (organisation_id, kind, year) do update set last_value = excluded.last_value`,
    [orgId],
  );
  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: adminId,
    type: "payment_request",
    category: "finance",
    title: "Payment requested: Year 3 Science Museum visit",
    body: "A school payment request is ready for Year 3 Science Museum visit. Open Payments to review the amount due.",
  });
  void museumChargeId;
  void bookChargeId;

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
    body: "Hello Amelia — your form tutor is Hannah Cole. Open My Learning for this week's work.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: amelia.userId,
    createdBy: teacherId,
    type: "learning_assigned",
    category: "homework",
    title: "New learning work",
    body: "New learning work: Year 3 Fractions",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: amelia.userId,
    createdBy: teacherId,
    type: "learning_feedback",
    category: "feedback",
    title: "Feedback available",
    body: "Feedback is available for Year 3 Fractions",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: teacherId,
    type: "learning_assigned",
    category: "homework",
    title: "New learning work",
    body: "New learning work: Year 3 Fractions",
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

  await seedPositiveRecord(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    occurredOn: "2026-09-12",
    categoryKey: "excellent_work",
    classId: class3A,
    description: "Careful fractions work and a clear explanation to the class.",
    recordedBy: teacherId,
  });
  await seedBehaviourIncident(client, {
    organisationId: orgId,
    studentProfileId: amelia.profileId,
    occurredAt: "2026-09-15T10:15:00Z",
    categoryKey: "disruption",
    locationKey: "classroom",
    classId: class3A,
    description: "Called out during the input. Reminder given and work completed.",
    severity: "low",
    actionTaken: "Verbal reminder.",
    status: "resolved",
    recordedBy: teacherId,
  });
  await seedBehaviourIncident(client, {
    organisationId: orgId,
    studentProfileId: jack.profileId,
    occurredAt: "2026-09-16T09:10:00Z",
    categoryKey: "unkindness",
    locationKey: "playground",
    description: "Pushed into a game without joining in fairly.",
    severity: "low",
    status: "resolved",
    recordedBy: teacherId,
  });
  await seedBehaviourIncident(client, {
    organisationId: orgId,
    studentProfileId: jack.profileId,
    occurredAt: "2026-09-18T11:40:00Z",
    categoryKey: "disruption",
    locationKey: "classroom",
    classId: class3A,
    description: "Repeated calling out after a previous reminder.",
    severity: "medium",
    status: "in_progress",
    recordedBy: teacherId,
  });
  await seedBehaviourIncident(client, {
    organisationId: orgId,
    studentProfileId: jack.profileId,
    occurredAt: "2026-09-22T13:05:00Z",
    categoryKey: "defiance",
    locationKey: "corridor",
    description: "Did not line up when asked. Restorative conversation planned.",
    severity: "medium",
    status: "open",
    recordedBy: teacherId,
  });
  const yusufPastoral = await seedPastoralConcern(client, {
    organisationId: orgId,
    studentProfileId: yusuf.profileId,
    categoryKey: "attendance_concern",
    concernOn: "2026-09-20",
    summary: "Several late marks this fortnight; pastoral check-in arranged.",
    detailedNotes: "Internal note: discuss morning routine with form tutor. Not for parent portal.",
    priority: "medium",
    assignedStaffUserId: headId,
    attendanceRelated: true,
    followUpDueOn: "2026-10-04",
    raisedBy: adminId,
  });
  await client.query(
    `insert into pastoral_interventions (
       organisation_id, concern_id, intervention_type, responsible_staff_user_id,
       action_on, outcome, next_review_on, recorded_by
     ) values ($1,$2,'pupil_meeting',$3,'2026-09-21','Calm conversation. Agreed to check in next week.','2026-10-04',$4)`,
    [orgId, yusufPastoral, headId, adminId],
  );
  await seedSafeguardingConcern(client, {
    organisationId: orgId,
    studentProfileId: sophie.profileId,
    categoryKey: "change_in_presentation",
    aroseAt: "2026-09-19T15:10:00Z",
    factualDescription:
      "Member of staff recorded a change in presentation after lunch. Facts only; DSL to review.",
    immediateActionTaken: "Passed to the designated safeguarding lead the same afternoon.",
    assignedUserId: headId,
    recordedBy: adminId,
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: headId,
    createdBy: adminId,
    type: "safeguarding_assigned",
    category: "safeguarding",
    title: "Safeguarding item assigned",
    body: "A safeguarding item has been assigned to you.",
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: headId,
    createdBy: adminId,
    type: "pastoral_assigned",
    category: "pastoral",
    title: "Pastoral item assigned",
    body: "A pastoral item has been assigned to you.",
  });

  await seedTimetable(client, {
    organisationId: orgId,
    academicYearId,
    createdBy: adminId,
    classIds,
    subjects,
    teachers: {
      hannah: teacherStaffId,
      daniel: extraStaffId,
      elena: receptionStaffId,
      head: headStaffId,
    },
    variant: "greenwood",
  });

  await seedAdmissionsPublicForms(client, {
    organisationId: orgId,
    createdBy: adminId,
    academicYearId,
    yearGroupId: year3,
    schoolKey: "greenwood",
  });

  await client.query(
    `insert into message_counters (organisation_id, last_value) values ($1, 3)`,
    [orgId],
  );
  await seedMessageConversation(client, {
    organisationId: orgId,
    reference: "MSG-000001",
    conversationType: "parent_teacher",
    subject: "Amelia Khan — Maths homework question",
    relatedPupilId: amelia.profileId,
    createdBy: teacherId,
    participants: [
      { userId: teacherId, kind: "staff", lastReadAt: "2026-09-24T16:00:00Z" },
      { userId: parentId, kind: "parent", lastReadAt: "2026-09-23T18:00:00Z" },
    ],
    messages: [
      {
        senderUserId: teacherId,
        body: "Hello Aisha, Amelia asked a clear question about tonight's maths worksheet. She can skip question 8 if it is taking too long.",
        sentAt: "2026-09-23T16:10:00Z",
      },
      {
        senderUserId: parentId,
        body: "Thank you, Mrs Cole. We will do questions 1 to 7 and come back to 8 at the weekend.",
        sentAt: "2026-09-23T18:05:00Z",
      },
      {
        senderUserId: teacherId,
        body: "That plan is fine. I have left a short note in her reading diary as well.",
        sentAt: "2026-09-24T15:40:00Z",
      },
    ],
  });
  await seedMessageConversation(client, {
    organisationId: orgId,
    reference: "MSG-000002",
    conversationType: "parent_school",
    subject: "School office — holiday club dates",
    relatedPupilId: amelia.profileId,
    createdBy: adminId,
    participants: [
      { userId: adminId, kind: "staff", lastReadAt: "2026-09-22T10:00:00Z" },
      { userId: parentId, kind: "parent", lastReadAt: "2026-09-22T11:00:00Z" },
    ],
    messages: [
      {
        senderUserId: adminId,
        body: "Holiday club booking forms are in the office. Please collect one if Amelia will attend October half-term.",
        sentAt: "2026-09-22T09:30:00Z",
      },
      {
        senderUserId: parentId,
        body: "Thank you. I will collect a form on Friday.",
        sentAt: "2026-09-22T10:45:00Z",
      },
    ],
  });
  await seedMessageConversation(client, {
    organisationId: orgId,
    reference: "MSG-000003",
    conversationType: "parent_school",
    subject: "Yusuf Khan — lost jumper",
    relatedPupilId: yusuf.profileId,
    createdBy: adminId,
    status: "closed",
    participants: [
      { userId: adminId, kind: "staff", lastReadAt: "2026-09-20T12:00:00Z" },
      { userId: parentId, kind: "parent", lastReadAt: "2026-09-20T12:00:00Z" },
    ],
    messages: [
      {
        senderUserId: parentId,
        body: "Yusuf's navy jumper is missing after PE. Could the office check lost property?",
        sentAt: "2026-09-19T17:20:00Z",
      },
      {
        senderUserId: adminId,
        body: "We found it in lost property and it is waiting at reception.",
        sentAt: "2026-09-20T09:15:00Z",
      },
    ],
  });
  await notify(client, {
    organisationId: orgId,
    recipientUserId: parentId,
    createdBy: teacherId,
    type: "message_received",
    category: "messaging",
    title: "New message",
    body: "You have a new message from Greenwood Academy.",
  });

  await seedEngagementDemo(client, {
    organisationId: orgId,
    actorUserId: adminId,
    teacherUserId: teacherId,
    yearGroups,
    classIds,
    subjects,
    houseId: oakHouse.rows[0]!.id,
    ameliaId: amelia.profileId,
    jackId: jack.profileId,
    variant: "greenwood",
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

  const oakEnglish = await seedAssignment(client, {
    organisationId: orgId,
    title: "Oak comprehension",
    description: "Answer the three questions about The Harbour Light.",
    workTypeKey: "homework",
    subjectId: subjects.get("english")!,
    academicYearId,
    createdBy: teacherId,
    dueAtSql: "now() + interval '3 days'",
    teacherNotes: "Oak-only private note. Greenwood must never see this.",
    maximumMarks: 12,
    classIds: [class3.rows[0]!.id],
    resource: {
      title: "Harbour Light extract",
      kind: "url",
      url: "https://example.com/oakacademy/harbour-light",
    },
  });
  await seedSubmission(client, {
    organisationId: orgId,
    assignmentId: oakEnglish,
    studentProfileId: niamh.profileId,
    submittedBy: niamh.userId,
    textResponse: "The lighthouse keeper waited for the storm to pass.",
    status: "completed",
    mark: {
      score: 11,
      maximumMarks: 12,
      feedback: "Thoughtful answer, Niamh.",
      releasedToStudent: true,
      releasedToParent: true,
      markedBy: teacherId,
    },
  });
  const oakAutumn = await seedReportingPeriod(client, {
    organisationId: orgId,
    academicYearId,
    name: "Autumn Term",
    startsOn: "2026-09-01",
    endsOn: "2026-12-18",
  });
  const oakMaths = await seedFormalAssessment(client, {
    organisationId: orgId,
    academicYearId,
    reportingPeriodId: oakAutumn,
    title: "Oak Year 3 Maths check",
    subjectId: subjects.get("mathematics")!,
    yearGroupId: yearGroups.get("3")!,
    typeKey: "class_test",
    assessmentDate: "2026-10-08",
    createdBy: teacherId,
    classIds: [class3.rows[0]!.id],
    maximumMarks: 15,
    gradeSchemeKey: "percentage",
    status: "published",
    internalNotes: "Oak-only formal assessment. Greenwood must never see this.",
  });
  await seedFormalResult(client, {
    organisationId: orgId,
    assessmentId: oakMaths,
    studentProfileId: niamh.profileId,
    enteredBy: teacherId,
    rawScore: 13,
    maximumScore: 15,
    comment: "Oak-only result.",
    releasedToStudent: true,
    releasedToParent: true,
  });

  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Oak Academy term start",
    body: "Welcome back to Oak Academy. Greenwood families must never see this notice.",
    createdBy: adminId,
    targets: [{ targetType: "whole_school" }],
    recipients: [
      { userId: adminId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      {
        userId: parentId,
        audienceRole: "parent",
        subjects: [{ studentProfileId: niamh.profileId, classId: class3.rows[0]!.id, yearGroupId: yearGroups.get("3")! }],
      },
      {
        userId: niamh.userId,
        audienceRole: "student",
        subjects: [{ studentProfileId: niamh.profileId, classId: class3.rows[0]!.id, yearGroupId: yearGroups.get("3")! }],
      },
    ],
  });
  await seedAnnouncement(client, {
    organisationId: orgId,
    title: "Oak staff-only briefing",
    body: "Internal Oak notice. Parents and Greenwood must never see this.",
    createdBy: adminId,
    targets: [{ targetType: "staff" }],
    recipients: [
      { userId: adminId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
    ],
  });
  await seedSchoolEvent(client, {
    organisationId: orgId,
    title: "Oak INSET day",
    typeKey: "inset_day",
    startsAt: "2026-09-02T00:00:00Z",
    endsAt: "2026-09-02T23:59:00Z",
    allDay: true,
    createdBy: adminId,
    targets: [{ targetType: "whole_school" }],
    audience: [
      { userId: adminId, audienceRole: "staff" },
      { userId: teacherId, audienceRole: "staff" },
      {
        userId: parentId,
        audienceRole: "parent",
        subjects: [{ studentProfileId: niamh.profileId, classId: class3.rows[0]!.id, yearGroupId: yearGroups.get("3")! }],
      },
      {
        userId: niamh.userId,
        audienceRole: "student",
        subjects: [{ studentProfileId: niamh.profileId, classId: class3.rows[0]!.id, yearGroupId: yearGroups.get("3")! }],
      },
    ],
  });

  await seedAssignment(client, {
    organisationId: orgId,
    title: "Oak science observations",
    description: "List two things you noticed on the nature walk.",
    workTypeKey: "classwork",
    subjectId: subjects.get("science")!,
    academicYearId,
    createdBy: teacherId,
    dueAtSql: "now() + interval '6 days'",
    classIds: [class3.rows[0]!.id],
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

  await seedPositiveRecord(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    occurredOn: "2026-09-11",
    categoryKey: "kindness",
    classId: class3.rows[0]!.id,
    description: "Helped a new classmate find the cloakroom.",
    recordedBy: teacherId,
  });
  await seedBehaviourIncident(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    occurredAt: "2026-09-17T10:05:00Z",
    categoryKey: "equipment",
    locationKey: "classroom",
    classId: class3.rows[0]!.id,
    description: "Oak-only incident: forgot reading book twice this week.",
    severity: "low",
    status: "open",
    recordedBy: teacherId,
  });
  await seedPastoralConcern(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    categoryKey: "friendship",
    concernOn: "2026-09-18",
    summary: "Oak-only pastoral note about playground friendships.",
    detailedNotes: "Internal Oak pastoral note. Greenwood must never see this.",
    priority: "low",
    assignedStaffUserId: teacherId,
    raisedBy: adminId,
  });
  await seedSafeguardingConcern(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    categoryKey: "general_concern",
    aroseAt: "2026-09-18T16:00:00Z",
    factualDescription: "Oak-only safeguarding record for tenant isolation tests. Neutral demo content.",
    immediateActionTaken: "Recorded for the Oak DSL.",
    assignedUserId: adminId,
    recordedBy: adminId,
  });

  await seedTimetable(client, {
    organisationId: orgId,
    academicYearId,
    createdBy: adminId,
    classIds: new Map([
      ["3A", class3.rows[0]!.id],
      ["5A", class5.rows[0]!.id],
    ]),
    subjects,
    teachers: { mark: teacherStaffId },
    variant: "oak",
  });

  await seedAdmissionsPublicForms(client, {
    organisationId: orgId,
    createdBy: adminId,
    academicYearId,
    yearGroupId: yearGroups.get("3")!,
    schoolKey: "oak",
  });

  await client.query(
    `insert into message_counters (organisation_id, last_value) values ($1, 1)`,
    [orgId],
  );
  await seedMessageConversation(client, {
    organisationId: orgId,
    reference: "MSG-000001",
    conversationType: "parent_teacher",
    subject: "Niamh Okonkwo — reading book",
    relatedPupilId: niamh.profileId,
    createdBy: teacherId,
    participants: [
      { userId: teacherId, kind: "staff", lastReadAt: "2026-09-21T16:00:00Z" },
      { userId: parentId, kind: "parent", lastReadAt: "2026-09-21T16:00:00Z" },
    ],
    messages: [
      {
        senderUserId: teacherId,
        body: "Oak-only message: Niamh's reading book is due back on Friday. Greenwood families must never see this.",
        sentAt: "2026-09-21T15:10:00Z",
      },
    ],
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
  await notify(client, {
    organisationId: orgId,
    recipientUserId: niamh.userId,
    createdBy: teacherId,
    type: "learning_assigned",
    category: "homework",
    title: "New learning work",
    body: "New learning work: Oak comprehension",
  });

  await seedCharge(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Oak PE kit replacement",
    categoryKey: "uniform",
    studentProfileId: niamh.profileId,
    amountMinor: 1500,
    reference: "CHG-2026-000901",
    parentNote: "Oak-only finance row for isolation testing.",
  });
  await seedSchoolActivity(client, {
    organisationId: orgId,
    createdBy: adminId,
    title: "Oak harbour visit",
    description: "Oak Academy Year 3 visit. Greenwood must never see this activity.",
    typeKey: "visit",
    academicYearId,
    startsAt: "2026-11-18T09:00:00Z",
    endsAt: "2026-11-18T14:00:00Z",
    location: "Harbour Light visitor centre",
    consentRequired: true,
    parentNotes: "Oak-only activity for isolation testing.",
    staffNotes: "Oak internal staffing note.",
    targets: [{ targetType: "class", classId: class3.rows[0]!.id }],
    staff: [{ staffUserId: teacherId, staffRole: "lead" }],
    eligible: [
      {
        studentProfileId: niamh.profileId,
        classId: class3.rows[0]!.id,
        yearGroupId: yearGroups.get("3")!,
      },
    ],
  });

  await seedSchoolStatutory(client, {
    organisationId: orgId,
    statutoryName: "Oak Academy (synthetic demo)",
    establishmentNumber: "9902",
    localAuthorityNumber: "202",
    urn: "999002",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: niamh.profileId,
    legalForename: "Niamh",
    legalSurname: "Okonkwo",
    sex: "F",
    upn: "C202990200001",
    ethnicityCode: "BAFR",
    languageCode: "ENG",
  });
  await seedStatutoryProfile(client, {
    organisationId: orgId,
    studentProfileId: ethan.profileId,
    legalForename: "Ethan",
    legalSurname: "Cole",
    sex: "M",
    upn: "R202990200002",
    ethnicityCode: "AIND",
    languageCode: "GUJ",
  });

  await seedEngagementDemo(client, {
    organisationId: orgId,
    actorUserId: adminId,
    teacherUserId: teacherId,
    yearGroups,
    classIds: new Map([
      ["3A", class3.rows[0]!.id],
      ["5A", class5.rows[0]!.id],
    ]),
    subjects,
    houseId: null,
    ameliaId: niamh.profileId,
    variant: "oak",
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
