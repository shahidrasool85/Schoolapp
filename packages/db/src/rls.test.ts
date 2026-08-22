import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools, withTenantContext } from "./client.js";
import { migrate } from "./migrate.js";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_test";

describe("RLS catalog", () => {
  const pools = createPools({ appUrl, ownerUrl });

  beforeAll(async () => {
    await migrate(ownerUrl);
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("forces row level security on tenant tables", async () => {
    const result = await pools.owner.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select c.relname, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'student_profiles', 'organisations', 'audit_events', 'organisation_memberships',
           'user_login_aliases', 'class_memberships', 'student_enrolments', 'guardianships',
           'staff_profiles', 'classes', 'class_staff_assignments', 'class_subjects',
           'subjects', 'houses', 'year_groups', 'academic_years', 'notifications',
           'admissions_enquiries', 'admissions_applications', 'admissions_application_contacts',
           'admissions_application_status_history', 'admissions_assessments',
           'admissions_waiting_list_entries', 'admissions_offers', 'admissions_documents',
           'admissions_counters', 'organisation_hostnames', 'organisation_slug_history',
           'reserved_subdomains', 'attendance_session_types', 'attendance_codes',
           'attendance_marks', 'attendance_mark_revisions', 'student_documents',
           'student_portal_policies', 'student_portal_year_group_overrides',
           'student_portal_class_overrides', 'student_portal_student_overrides',
           'learning_work_types', 'learning_assignments', 'learning_assignment_status_history',
           'learning_assignment_targets', 'learning_assignment_recipients',
           'learning_resources', 'learning_assignment_resources', 'learning_submissions',
           'learning_submission_revisions', 'learning_submission_attachments', 'learning_marks',
           'academic_assessment_types', 'academic_grade_schemes', 'academic_grade_scheme_levels',
           'academic_reporting_periods', 'academic_assessments', 'academic_assessment_status_history',
           'academic_assessment_classes', 'academic_assessment_inclusions', 'academic_results',
           'academic_result_revisions', 'academic_targets', 'academic_reports',
           'academic_report_sections', 'academic_report_status_history', 'academic_report_publications'
         )`,
    );
    expect(result.rows.length).toBe(64);
    for (const row of result.rows) {
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });

  it("does not give the app role BYPASSRLS", async () => {
    const result = await pools.owner.query<{ rolbypassrls: boolean }>(
      "select rolbypassrls from pg_roles where rolname = 'schoolapp_app'",
    );
    expect(result.rows[0]?.rolbypassrls).toBe(false);
  });

  it("keeps system roles and other users protected from the app role", async () => {
    const id = randomUUID().slice(0, 8);
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'RLS User', 'staff', 'active') returning id`,
      [`rls-user-${id}@example.com`],
    );
    const other = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Other', 'staff', 'active') returning id`,
      [`rls-other-${id}@example.com`],
    );
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-${id}`, "RLS School"],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active')`,
      [org.rows[0]!.id, user.rows[0]!.id],
    );

    await withTenantContext(pools.app, user.rows[0]!.id, org.rows[0]!.id, async (client) => {
      await expect(
        client.query("update roles set name = 'hacked' where organisation_id is null and key = 'school.admin'"),
      ).rejects.toThrow();
      await expect(client.query("delete from users where id = $1", [other.rows[0]!.id])).rejects.toThrow();
      await expect(
        client.query(
          `insert into invitations (
             organisation_id, email, intended_role_keys, token_hash, expires_at
           ) values ($1, $2, array['school.teacher']::text[], $3, now() + interval '1 day')`,
          [org.rows[0]!.id, `sneaky-${id}@example.com`, `hash-${id}`],
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects custom roles from another organisation on a membership", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-a-${id}`, "A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-b-${id}`, "B"],
    );
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Member', 'staff', 'active') returning id`,
      [`rls-m-${id}@example.com`],
    );
    const membership = await pools.owner.query<{ id: string }>(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active') returning id`,
      [orgA.rows[0]!.id, user.rows[0]!.id],
    );
    const roleB = await pools.owner.query<{ id: string }>(
      `insert into roles (organisation_id, key, name) values ($1, 'custom', 'Custom B') returning id`,
      [orgB.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        "insert into membership_roles (membership_id, role_id) values ($1, $2)",
        [membership.rows[0]!.id, roleB.rows[0]!.id],
      ),
    ).rejects.toThrow(/membership_role_org_mismatch/);
  });

  it("allows only one linked student profile per user per organisation", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-stu-${id}`, "Students"],
    );
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Pupil', 'student', 'active') returning id`,
      [`rls-stu-${id}@example.com`],
    );
    await pools.owner.query(
      "insert into student_profiles (organisation_id, user_id, legal_name) values ($1, $2, 'One')",
      [org.rows[0]!.id, user.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        "insert into student_profiles (organisation_id, user_id, legal_name) values ($1, $2, 'Two')",
        [org.rows[0]!.id, user.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("allows a new guardianship after the previous link has ended", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-g-${id}`, "Guardians"],
    );
    const guardian = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Guardian', 'parent', 'active') returning id`,
      [`rls-g-${id}@example.com`],
    );
    const student = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Child') returning id",
      [org.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, started_on, ended_on
       ) values ($1, $2, $3, '2024-01-01', '2024-12-31')`,
      [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into guardianships (
         organisation_id, student_profile_id, guardian_user_id, started_on
       ) values ($1, $2, $3, '2025-01-01')`,
      [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into guardianships (
           organisation_id, student_profile_id, guardian_user_id, started_on
         ) values ($1, $2, $3, '2025-02-01')`,
        [org.rows[0]!.id, student.rows[0]!.id, guardian.rows[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("keeps login aliases isolated to the current organisation", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-alias-a-${id}`, "Alias A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-alias-b-${id}`, "Alias B"],
    );
    const userA = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Alias A', 'student', 'active') returning id`,
      [`rls-alias-a-${id}@example.com`],
    );
    const userB = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Alias B', 'student', 'active') returning id`,
      [`rls-alias-b-${id}@example.com`],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active'), ($3, $4, 'active')`,
      [orgA.rows[0]!.id, userA.rows[0]!.id, orgB.rows[0]!.id, userB.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into user_login_aliases (organisation_id, user_id, alias)
       values ($1, $2, 'same.alias'), ($3, $4, 'same.alias')`,
      [orgA.rows[0]!.id, userA.rows[0]!.id, orgB.rows[0]!.id, userB.rows[0]!.id],
    );

    const visible = await withTenantContext(pools.app, userA.rows[0]!.id, orgA.rows[0]!.id, async (client) => {
      const rows = await client.query<{ organisation_id: string; alias: string }>(
        "select organisation_id, alias from user_login_aliases",
      );
      return rows.rows;
    });
    expect(visible).toEqual([{ organisation_id: orgA.rows[0]!.id, alias: "same.alias" }]);
  });

  it("keeps in-app notifications isolated by tenant and recipient", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-note-a-${id}`, "Notes A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-note-b-${id}`, "Notes B"],
    );
    const userA = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Parent A', 'parent', 'active') returning id`,
      [`rls-note-a-${id}@example.com`],
    );
    const userB = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Parent B', 'parent', 'active') returning id`,
      [`rls-note-b-${id}@example.com`],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active'), ($1, $3, 'active'), ($4, $2, 'active')`,
      [orgA.rows[0]!.id, userA.rows[0]!.id, userB.rows[0]!.id, orgB.rows[0]!.id],
    );
    const noteA = await pools.owner.query<{ id: string }>(
      `insert into notifications (organisation_id, recipient_user_id, type, category, title, body)
       values ($1, $2, 'general', 'general', 'For A in A', 'Hello A') returning id`,
      [orgA.rows[0]!.id, userA.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into notifications (organisation_id, recipient_user_id, type, category, title, body)
       values ($1, $2, 'general', 'general', 'For B in A', 'Hello B'),
              ($3, $4, 'general', 'general', 'For A in B', 'Other school')`,
      [orgA.rows[0]!.id, userB.rows[0]!.id, orgB.rows[0]!.id, userA.rows[0]!.id],
    );

    const visible = await withTenantContext(pools.app, userA.rows[0]!.id, orgA.rows[0]!.id, async (client) => {
      const rows = await client.query<{ id: string; title: string }>(
        "select id, title from notifications order by title",
      );
      return rows.rows;
    });
    expect(visible).toEqual([{ id: noteA.rows[0]!.id, title: "For A in A" }]);

    await withTenantContext(pools.app, userA.rows[0]!.id, orgA.rows[0]!.id, async (client) => {
      const updated = await client.query(
        "update notifications set read_at = now() where id = $1 returning id",
        [noteA.rows[0]!.id],
      );
      expect(updated.rows).toHaveLength(1);
      await expect(
        client.query("update notifications set title = 'hacked' where id = $1", [noteA.rows[0]!.id]),
      ).rejects.toThrow();
    });
  });

  it("keeps admissions tables tenant-isolated and rejects cross-school relationships", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-adm-a-${id}`, "Admissions A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-adm-b-${id}`, "Admissions B"],
    );
    const userA = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Admissions A', 'staff', 'active') returning id`,
      [`rls-adm-a-${id}@example.com`],
    );
    const userB = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Admissions B', 'staff', 'active') returning id`,
      [`rls-adm-b-${id}@example.com`],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active'), ($3, $4, 'active')`,
      [orgA.rows[0]!.id, userA.rows[0]!.id, orgB.rows[0]!.id, userB.rows[0]!.id],
    );
    const enquiryA = await pools.owner.query<{ id: string }>(
      `insert into admissions_enquiries (
         organisation_id, reference, pupil_legal_name, guardian_full_name
       ) values ($1, 'ENQ-A', 'Pupil A', 'Parent A') returning id`,
      [orgA.rows[0]!.id],
    );
    const enquiryB = await pools.owner.query<{ id: string }>(
      `insert into admissions_enquiries (
         organisation_id, reference, pupil_legal_name, guardian_full_name
       ) values ($1, 'ENQ-B', 'Pupil B', 'Parent B') returning id`,
      [orgB.rows[0]!.id],
    );
    const appA = await pools.owner.query<{ id: string }>(
      `insert into admissions_applications (
         organisation_id, reference, pupil_legal_name, status
       ) values ($1, 'APP-A', 'Pupil A', 'draft') returning id`,
      [orgA.rows[0]!.id],
    );
    const appB = await pools.owner.query<{ id: string }>(
      `insert into admissions_applications (
         organisation_id, reference, pupil_legal_name, status
       ) values ($1, 'APP-B', 'Pupil B', 'draft') returning id`,
      [orgB.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into admissions_assessments (organisation_id, application_id, assessment_type)
       values ($1, $2, 'school_visit')`,
      [orgB.rows[0]!.id, appB.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into admissions_offers (organisation_id, application_id)
       values ($1, $2)`,
      [orgB.rows[0]!.id, appB.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into admissions_waiting_list_entries (organisation_id, application_id)
       values ($1, $2)`,
      [orgB.rows[0]!.id, appB.rows[0]!.id],
    );

    const visible = await withTenantContext(pools.app, userA.rows[0]!.id, orgA.rows[0]!.id, async (client) => {
      const enquiries = await client.query("select reference from admissions_enquiries");
      const applications = await client.query("select reference from admissions_applications");
      const assessments = await client.query("select id from admissions_assessments");
      const offers = await client.query("select id from admissions_offers");
      const waiting = await client.query("select id from admissions_waiting_list_entries");
      return {
        enquiries: enquiries.rows.map((row) => row.reference),
        applications: applications.rows.map((row) => row.reference),
        assessments: assessments.rowCount,
        offers: offers.rowCount,
        waiting: waiting.rowCount,
      };
    });
    expect(visible).toEqual({
      enquiries: ["ENQ-A"],
      applications: ["APP-A"],
      assessments: 0,
      offers: 0,
      waiting: 0,
    });

    await expect(
      pools.owner.query(
        `insert into admissions_assessments (organisation_id, application_id, assessment_type)
         values ($1, $2, 'school_visit')`,
        [orgA.rows[0]!.id, appB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
    await expect(
      pools.owner.query(
        `insert into admissions_offers (organisation_id, application_id) values ($1, $2)`,
        [orgA.rows[0]!.id, appB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
    await expect(
      pools.owner.query(
        `insert into admissions_waiting_list_entries (organisation_id, application_id) values ($1, $2)`,
        [orgA.rows[0]!.id, appB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
    await expect(
      pools.owner.query(
        `insert into admissions_applications (
           organisation_id, reference, enquiry_id, pupil_legal_name
         ) values ($1, 'APP-X', $2, 'Nope')`,
        [orgA.rows[0]!.id, enquiryB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
    void enquiryA;
  });

  it("rejects invalid application status transitions at the database", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-st-${id}`, "Status"],
    );
    const app = await pools.owner.query<{ id: string }>(
      `insert into admissions_applications (
         organisation_id, reference, pupil_legal_name, status
       ) values ($1, 'APP-ST', 'Pupil', 'draft') returning id`,
      [org.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        "update admissions_applications set status = 'enrolled' where id = $1",
        [app.rows[0]!.id],
      ),
    ).rejects.toThrow(/invalid_status_transition|admissions_enrolment_required/);
    await expect(
      pools.owner.query(
        "update admissions_applications set status = 'accepted' where id = $1",
        [app.rows[0]!.id],
      ),
    ).rejects.toThrow(/invalid_status_transition/);
  });

  it("rejects cross-organisation attendance and portal-policy links", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-att-a-${id}`, "Att A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-att-b-${id}`, "Att B"],
    );
    const yearA = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [orgA.rows[0]!.id],
    );
    const pupilB = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Oak Child') returning id",
      [orgB.rows[0]!.id],
    );
    const sessionA = await pools.owner.query<{ id: string }>(
      "select id from attendance_session_types where organisation_id = $1 and key = 'am'",
      [orgA.rows[0]!.id],
    );
    const codeA = await pools.owner.query<{ id: string }>(
      "select id from attendance_codes where organisation_id = $1 and code = 'present'",
      [orgA.rows[0]!.id],
    );
    const actor = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Marker', 'staff', 'active') returning id`,
      [`rls-att-${id}@example.com`],
    );
    await expect(
      pools.owner.query(
        `insert into attendance_marks (
           organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
           attendance_code_id, recorded_by
         ) values ($1, $2, $3, $4, '2026-09-01', $5, $6)`,
        [
          orgA.rows[0]!.id,
          pupilB.rows[0]!.id,
          yearA.rows[0]!.id,
          sessionA.rows[0]!.id,
          codeA.rows[0]!.id,
          actor.rows[0]!.id,
        ],
      ),
    ).rejects.toThrow(/organisation_mismatch/);

    const yearB = await pools.owner.query<{ id: string }>(
      "insert into year_groups (organisation_id, code, name) values ($1, '3', 'Year 3') returning id",
      [orgB.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into student_portal_year_group_overrides (organisation_id, year_group_id, enabled)
         values ($1, $2, true)`,
        [orgA.rows[0]!.id, yearB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
  });

  it("keeps FORCE RLS from leaking attendance marks across tenants", async () => {
    const id = randomUUID().slice(0, 8);
    const userA = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Admin A', 'staff', 'active') returning id`,
      [`rls-att-admin-a-${id}@example.com`],
    );
    const userB = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Admin B', 'staff', 'active') returning id`,
      [`rls-att-admin-b-${id}@example.com`],
    );
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-att-iso-a-${id}`, "Iso A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-att-iso-b-${id}`, "Iso B"],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active'), ($3, $4, 'active')`,
      [orgA.rows[0]!.id, userA.rows[0]!.id, orgB.rows[0]!.id, userB.rows[0]!.id],
    );
    const yearA = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [orgA.rows[0]!.id],
    );
    const yearB = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [orgB.rows[0]!.id],
    );
    const pupilA = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Child A') returning id",
      [orgA.rows[0]!.id],
    );
    const pupilB = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Child B') returning id",
      [orgB.rows[0]!.id],
    );
    const sessionA = await pools.owner.query<{ id: string }>(
      "select id from attendance_session_types where organisation_id = $1 and key = 'am'",
      [orgA.rows[0]!.id],
    );
    const sessionB = await pools.owner.query<{ id: string }>(
      "select id from attendance_session_types where organisation_id = $1 and key = 'am'",
      [orgB.rows[0]!.id],
    );
    const codeA = await pools.owner.query<{ id: string }>(
      "select id from attendance_codes where organisation_id = $1 and code = 'present'",
      [orgA.rows[0]!.id],
    );
    const codeB = await pools.owner.query<{ id: string }>(
      "select id from attendance_codes where organisation_id = $1 and code = 'present'",
      [orgB.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into attendance_marks (
         organisation_id, student_profile_id, academic_year_id, session_type_id, mark_date,
         attendance_code_id, recorded_by
       ) values ($1,$2,$3,$4,'2026-09-01',$5,$6), ($7,$8,$9,$10,'2026-09-01',$11,$12)`,
      [
        orgA.rows[0]!.id,
        pupilA.rows[0]!.id,
        yearA.rows[0]!.id,
        sessionA.rows[0]!.id,
        codeA.rows[0]!.id,
        userA.rows[0]!.id,
        orgB.rows[0]!.id,
        pupilB.rows[0]!.id,
        yearB.rows[0]!.id,
        sessionB.rows[0]!.id,
        codeB.rows[0]!.id,
        userB.rows[0]!.id,
      ],
    );

    await withTenantContext(pools.app, userA.rows[0]!.id, orgA.rows[0]!.id, async (client) => {
      const seen = await client.query<{ student_profile_id: string }>(
        "select student_profile_id from attendance_marks",
      );
      expect(seen.rows.map((row) => row.student_profile_id)).toEqual([pupilA.rows[0]!.id]);
    });
  });

  it("rejects cross-organisation learning assignment targets and submissions", async () => {
    const id = randomUUID().slice(0, 8);
    const orgA = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-lms-a-${id}`, "Lms A"],
    );
    const orgB = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-lms-b-${id}`, "Lms B"],
    );
    const yearA = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [orgA.rows[0]!.id],
    );
    const yearB = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [orgB.rows[0]!.id],
    );
    const classB = await pools.owner.query<{ id: string }>(
      `insert into classes (organisation_id, academic_year_id, name, class_type)
       values ($1, $2, '3A', 'form') returning id`,
      [orgB.rows[0]!.id, yearB.rows[0]!.id],
    );
    const workType = await pools.owner.query<{ id: string }>(
      "select id from learning_work_types where organisation_id = $1 and key = 'homework'",
      [orgA.rows[0]!.id],
    );
    const actor = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Teacher', 'staff', 'active') returning id`,
      [`rls-lms-${id}@example.com`],
    );
    const assignment = await pools.owner.query<{ id: string }>(
      `insert into learning_assignments (
         organisation_id, title, work_type_id, academic_year_id, created_by
       ) values ($1, 'Fractions', $2, $3, $4) returning id`,
      [orgA.rows[0]!.id, workType.rows[0]!.id, yearA.rows[0]!.id, actor.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into learning_assignment_targets (
           organisation_id, assignment_id, target_type, class_id
         ) values ($1, $2, 'class', $3)`,
        [orgA.rows[0]!.id, assignment.rows[0]!.id, classB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);

    const pupilB = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Oak Child') returning id",
      [orgB.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into learning_assignment_recipients (
           organisation_id, assignment_id, student_profile_id
         ) values ($1, $2, $3)`,
        [orgA.rows[0]!.id, assignment.rows[0]!.id, pupilB.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);
  });

  it("rejects invalid assignment status transitions and out-of-range scores", async () => {
    const id = randomUUID().slice(0, 8);
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`rls-lms-st-${id}`, "Status"],
    );
    const year = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [org.rows[0]!.id],
    );
    const workType = await pools.owner.query<{ id: string }>(
      "select id from learning_work_types where organisation_id = $1 and key = 'homework'",
      [org.rows[0]!.id],
    );
    const actor = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Teacher', 'staff', 'active') returning id`,
      [`rls-lms-st-${id}@example.com`],
    );
    const assignment = await pools.owner.query<{ id: string }>(
      `insert into learning_assignments (
         organisation_id, title, work_type_id, academic_year_id, created_by, maximum_marks
       ) values ($1, 'Draft work', $2, $3, $4, 10) returning id`,
      [org.rows[0]!.id, workType.rows[0]!.id, year.rows[0]!.id, actor.rows[0]!.id],
    );
    await expect(
      pools.owner.query("update learning_assignments set status = 'closed' where id = $1", [
        assignment.rows[0]!.id,
      ]),
    ).rejects.toThrow(/invalid_status_transition/);
    await pools.owner.query("update learning_assignments set status = 'published' where id = $1", [
      assignment.rows[0]!.id,
    ]);
    await expect(
      pools.owner.query("update learning_assignments set status = 'draft' where id = $1", [
        assignment.rows[0]!.id,
      ]),
    ).rejects.toThrow(/invalid_status_transition/);

    const pupil = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Marked Child') returning id",
      [org.rows[0]!.id],
    );
    await pools.owner.query(
      `insert into learning_assignment_recipients (
         organisation_id, assignment_id, student_profile_id
       ) values ($1, $2, $3)`,
      [org.rows[0]!.id, assignment.rows[0]!.id, pupil.rows[0]!.id],
    );
    const submission = await pools.owner.query<{ id: string }>(
      `insert into learning_submissions (
         organisation_id, assignment_id, student_profile_id, status
       ) values ($1, $2, $3, 'submitted') returning id`,
      [org.rows[0]!.id, assignment.rows[0]!.id, pupil.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into learning_marks (
           organisation_id, submission_id, score, maximum_marks, marked_by
         ) values ($1, $2, 11, 10, $3)`,
        [org.rows[0]!.id, submission.rows[0]!.id, actor.rows[0]!.id],
      ),
    ).rejects.toThrow(/learning_score_out_of_range/);
    await expect(
      pools.owner.query(
        `insert into learning_marks (
           organisation_id, submission_id, score, maximum_marks, marked_by
         ) values ($1, $2, 5, 20, $3)`,
        [org.rows[0]!.id, submission.rows[0]!.id, actor.rows[0]!.id],
      ),
    ).rejects.toThrow(/learning_score_out_of_range/);
  });

  it("enforces Phase 8 same-org, inclusion, score, and status rules", async () => {
    const id = randomUUID().slice(0, 8);
    const user = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Phase8 Actor', 'staff', 'active') returning id`,
      [`p8-actor-${id}@example.com`],
    );
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`p8-${id}`, "Phase8 School"],
    );
    const other = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`p8o-${id}`, "Phase8 Other"],
    );
    const year = await pools.owner.query<{ id: string }>(
      `insert into academic_years (organisation_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/27', '2026-09-01', '2027-07-31', true) returning id`,
      [org.rows[0]!.id],
    );
    const group = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name)
       values ($1, '3', 'Year 3') returning id`,
      [org.rows[0]!.id],
    );
    const subject = await pools.owner.query<{ id: string }>(
      "insert into subjects (organisation_id, key, name) values ($1, 'mathematics', 'Mathematics') returning id",
      [org.rows[0]!.id],
    );
    const type = await pools.owner.query<{ id: string }>(
      "select id from academic_assessment_types where organisation_id = $1 and key = 'class_test'",
      [org.rows[0]!.id],
    );
    const assessment = await pools.owner.query<{ id: string }>(
      `insert into academic_assessments (
         organisation_id, academic_year_id, title, subject_id, year_group_id,
         assessment_type_id, assessment_date, maximum_marks, created_by
       ) values ($1,$2,'Test',$3,$4,$5,'2026-10-01',10,$6)
       returning id`,
      [org.rows[0]!.id, year.rows[0]!.id, subject.rows[0]!.id, group.rows[0]!.id, type.rows[0]!.id, user.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into academic_assessments (
           organisation_id, academic_year_id, title, subject_id, year_group_id,
           assessment_type_id, assessment_date, created_by
         ) values ($1,$2,'Cross',$3,$4,$5,'2026-10-01',$6)`,
        [other.rows[0]!.id, year.rows[0]!.id, subject.rows[0]!.id, group.rows[0]!.id, type.rows[0]!.id, user.rows[0]!.id],
      ),
    ).rejects.toThrow(/organisation_mismatch/);

    const pupil = await pools.owner.query<{ id: string }>(
      "insert into student_profiles (organisation_id, legal_name) values ($1, 'Result Child') returning id",
      [org.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into academic_results (
           organisation_id, assessment_id, student_profile_id, raw_score, entered_by
         ) values ($1,$2,$3,5,$4)`,
        [org.rows[0]!.id, assessment.rows[0]!.id, pupil.rows[0]!.id, user.rows[0]!.id],
      ),
    ).rejects.toThrow(/assessment_pupil_not_included/);

    await pools.owner.query(
      `insert into academic_assessment_inclusions (organisation_id, assessment_id, student_profile_id)
       values ($1,$2,$3)`,
      [org.rows[0]!.id, assessment.rows[0]!.id, pupil.rows[0]!.id],
    );
    await expect(
      pools.owner.query(
        `insert into academic_results (
           organisation_id, assessment_id, student_profile_id, raw_score, maximum_score, entered_by
         ) values ($1,$2,$3,12,10,$4)`,
        [org.rows[0]!.id, assessment.rows[0]!.id, pupil.rows[0]!.id, user.rows[0]!.id],
      ),
    ).rejects.toThrow(/academic_score_out_of_range/);

    await expect(
      pools.owner.query("update academic_assessments set status = 'published' where id = $1", [
        assessment.rows[0]!.id,
      ]),
    ).rejects.toThrow(/invalid_status_transition/);

    const outsider = await pools.owner.query<{ id: string }>(
      `insert into users (email, full_name, user_kind, status)
       values ($1, 'Phase8 Outsider', 'staff', 'active') returning id`,
      [`p8-out-${id}@example.com`],
    );
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active')`,
      [other.rows[0]!.id, outsider.rows[0]!.id],
    );
    await withTenantContext(pools.app, outsider.rows[0]!.id, other.rows[0]!.id, async (client) => {
      await expect(
        client.query("select snapshot_academic_assessment_inclusions($1)", [assessment.rows[0]!.id]),
      ).rejects.toThrow(/organisation_mismatch/);
    });
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active')`,
      [org.rows[0]!.id, user.rows[0]!.id],
    );
    await withTenantContext(pools.app, user.rows[0]!.id, org.rows[0]!.id, async (client) => {
      await expect(
        client.query("select snapshot_academic_assessment_inclusions($1)", [assessment.rows[0]!.id]),
      ).rejects.toThrow(/forbidden/);
    });
  });
});
