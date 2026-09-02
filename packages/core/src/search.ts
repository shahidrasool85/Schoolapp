import type pg from "pg";
import {
  GLOBAL_SEARCH_RECORD_MIN_QUERY,
  PARENT_SEARCH_DESTINATIONS,
  STAFF_SEARCH_DESTINATIONS,
  STUDENT_SEARCH_DESTINATIONS,
  matchSearchDestinations,
  type Actor,
  type GlobalSearchGroup,
} from "@schoolapp/domain";
import { assignedStudentIds, canListAllStudents, canReadAcademicStructure } from "./students-access.js";
import { canReadTuition } from "./tuition-access.js";
import { canReadSchoolFinance } from "./payments-access.js";

export type SearchHit = {
  id: string;
  group: GlobalSearchGroup;
  title: string;
  href: string;
  subtitle?: string | null;
};

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function destinationsFor(actor: Actor) {
  if (actor.userKind === "parent") return PARENT_SEARCH_DESTINATIONS;
  if (actor.userKind === "student") return STUDENT_SEARCH_DESTINATIONS;
  return STAFF_SEARCH_DESTINATIONS;
}

export async function globalSearch(
  client: pg.PoolClient,
  input: {
    organisationId: string;
    actor: Actor;
    query: string;
    studentsCanViewFinance?: boolean;
  },
): Promise<{ groups: Array<{ group: GlobalSearchGroup; results: SearchHit[] }> }> {
  const permissions = [...input.actor.permissions];
  const destinations = matchSearchDestinations(input.query, destinationsFor(input.actor), permissions).map(
    (destination) => ({
      id: destination.id,
      group: destination.group,
      title: destination.title,
      href: destination.href,
      subtitle: "Page",
    }),
  );
  if (
    input.actor.userKind === "student" &&
    input.studentsCanViewFinance &&
    /fee|invoice|finance|payment/i.test(input.query)
  ) {
    destinations.push({
      id: "student-finance",
      group: "pages",
      title: "My fees",
      href: "/student/finance",
      subtitle: "Page",
    });
  }

  const hits: SearchHit[] = [...destinations];
  const q = input.query.trim();
  if (q.length >= GLOBAL_SEARCH_RECORD_MIN_QUERY && input.actor.userKind === "staff") {
    const pattern = `%${escapeIlike(q)}%`;
    const canPupils =
      canListAllStudents(input.actor) || input.actor.permissions.has("students.profiles.read_assigned");
    if (canPupils) {
      const assigned = canListAllStudents(input.actor)
        ? null
        : [...(await assignedStudentIds(client, input.actor.userId, input.organisationId))];
      if (assigned === null || assigned.length > 0) {
        const pupils = await client.query<{
          id: string;
          legal_name: string;
          year_group_name: string | null;
          class_name: string | null;
        }>(
          `select sp.id, sp.legal_name, yg.name as year_group_name, c.name as class_name
             from student_profiles sp
             left join academic_years ay on ay.organisation_id = sp.organisation_id and ay.is_current
             left join student_enrolments se
               on se.student_profile_id = sp.id and se.academic_year_id = ay.id and se.is_primary and se.ended_on is null
             left join year_groups yg on yg.id = se.year_group_id
             left join lateral (
               select cl.name
                 from class_memberships cm
                 join classes cl on cl.id = cm.class_id
                where cm.student_profile_id = sp.id and cm.ended_on is null and cl.class_type = 'form'
                  and ay.id is not null and cm.academic_year_id = ay.id
                limit 1
             ) c on true
            where sp.organisation_id = $1
              and ($3::uuid[] is null or sp.id = any($3::uuid[]))
              and (sp.legal_name ilike $2 escape '\\' or coalesce(sp.admission_number, '') ilike $2 escape '\\')
            order by sp.legal_name
            limit 8`,
          [input.organisationId, pattern, assigned],
        );
        for (const row of pupils.rows) {
          hits.push({
            id: `pupil:${row.id}`,
            group: "pupils",
            title: row.legal_name,
            href: `/school/students/${row.id}`,
            subtitle: [row.year_group_name, row.class_name].filter(Boolean).join(" · ") || "Pupil",
          });
        }
      }
    }

    if (
      input.actor.permissions.has("org.members.read") ||
      input.actor.permissions.has("academic.structure.manage")
    ) {
      const staff = await client.query<{ id: string; full_name: string; job_title: string | null }>(
        `select sp.id, u.full_name, sp.job_title
           from staff_profiles sp
           join users u on u.id = sp.user_id
          where sp.organisation_id = $1
            and u.full_name ilike $2 escape '\\'
          order by u.full_name
          limit 8`,
        [input.organisationId, pattern],
      );
      for (const row of staff.rows) {
        hits.push({
          id: `staff:${row.id}`,
          group: "staff",
          title: row.full_name,
          href: `/school/staff/${row.id}`,
          subtitle: row.job_title || "Staff",
        });
      }
    }

    if (canReadAcademicStructure(input.actor) || input.actor.permissions.has("timetable.read")) {
      const classes = await client.query<{
        id: string;
        name: string;
        year_group_name: string | null;
        academic_year_name: string | null;
      }>(
        `select c.id, c.name, yg.name as year_group_name, ay.name as academic_year_name
           from classes c
           join academic_years ay on ay.id = c.academic_year_id
           left join year_groups yg on yg.id = c.year_group_id
          where c.organisation_id = $1
            and c.status = 'active'
            and (c.name ilike $2 escape '\\' or yg.name ilike $2 escape '\\' or yg.code ilike $2 escape '\\')
          order by c.name
          limit 8`,
        [input.organisationId, pattern],
      );
      for (const row of classes.rows) {
        hits.push({
          id: `class:${row.id}`,
          group: "classes",
          title: row.name,
          href: `/school/classes/${row.id}`,
          subtitle: [row.year_group_name, row.academic_year_name].filter(Boolean).join(" · ") || "Class",
        });
      }
    }

    if (canReadTuition(input.actor) || canReadSchoolFinance(input.actor)) {
      const invoices = await client.query<{
        id: string;
        reference: string;
        billing_account_name: string | null;
        status: string;
      }>(
        `select i.id, i.reference, a.name as billing_account_name, i.status
           from school_invoices i
           join school_billing_accounts a on a.id = i.billing_account_id
          where i.organisation_id = $1
            and (i.reference ilike $2 escape '\\' or a.name ilike $2 escape '\\')
          order by i.invoice_date desc
          limit 8`,
        [input.organisationId, pattern],
      );
      for (const row of invoices.rows) {
        hits.push({
          id: `invoice:${row.id}`,
          group: "finance",
          title: row.reference,
          href: `/school/finance/invoices/${row.id}`,
          subtitle: [row.billing_account_name, row.status].filter(Boolean).join(" · "),
        });
      }
      const schedules = await client.query<{ id: string; name: string }>(
        `select id, name from school_fee_schedules
          where organisation_id = $1 and name ilike $2 escape '\\'
          order by name
          limit 5`,
        [input.organisationId, pattern],
      );
      for (const row of schedules.rows) {
        hits.push({
          id: `schedule:${row.id}`,
          group: "finance",
          title: row.name,
          href: `/school/finance/fee-schedules/${row.id}`,
          subtitle: "Fee schedule",
        });
      }
    }
  }

  const order: GlobalSearchGroup[] = ["pages", "pupils", "staff", "classes", "finance"];
  return {
    groups: order
      .map((group) => ({ group, results: hits.filter((hit) => hit.group === group) }))
      .filter((item) => item.results.length > 0),
  };
}
