import { PERMISSIONS } from "@schoolapp/domain";
import { AppError, assertPermission, guardianChildIds } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor, routeParam } from "../school-context";
import { mapStudent } from "../serialize";

export function registerParentRoutes(app: SchoolappApi) {
  app.get("/parent/children", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const childIds = await guardianChildIds(client, userId, orgId);
      if (childIds.size === 0) {
        return c.json({ children: [] });
      }
      const rows = await client.query(
        `select
           sp.id,
           sp.user_id,
           sp.legal_name,
           u.preferred_name,
           u.date_of_birth::text,
           sp.admission_number,
           sp.enrolment_status,
           se.academic_year_id,
           se.year_group_id,
           yg.name as year_group_name,
           form.id as form_class_id,
           form.name as form_class_name
         from student_profiles sp
         left join users u on u.id = sp.user_id
         left join academic_years ay
           on ay.organisation_id = sp.organisation_id and ay.is_current
         left join student_enrolments se
           on se.student_profile_id = sp.id
          and se.academic_year_id = ay.id
          and se.is_primary
          and se.ended_on is null
         left join year_groups yg on yg.id = se.year_group_id
         left join lateral (
           select c.id, c.name
           from class_memberships cm
           join classes c on c.id = cm.class_id
           where cm.student_profile_id = sp.id
             and cm.ended_on is null
             and c.class_type = 'form'
             and (ay.id is null or cm.academic_year_id = ay.id)
           limit 1
         ) form on true
         where sp.organisation_id = $1
           and sp.id = any ($2::uuid[])
         order by sp.legal_name`,
        [orgId, [...childIds]],
      );
      return c.json({
        children: rows.rows.map((row) => {
          const student = mapStudent(row);
          return {
            id: student.id,
            legalName: student.legalName,
            preferredName: student.preferredName,
            currentYearGroupName: student.currentYearGroupName,
            currentFormClassName: student.currentFormClassName,
          };
        }),
      });
    }),
  );

  app.get("/parent/children/:studentId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const childIds = await guardianChildIds(client, userId, orgId);
      const studentId = routeParam(c, "studentId");
      if (!childIds.has(studentId)) {
        throw new AppError(404, "not_found", "Not found");
      }
      const rows = await client.query(
        `select
           sp.id, sp.user_id, sp.legal_name, u.preferred_name, u.date_of_birth::text,
           sp.admission_number, sp.enrolment_status, se.academic_year_id, se.year_group_id,
           yg.name as year_group_name, form.id as form_class_id, form.name as form_class_name
         from student_profiles sp
         left join users u on u.id = sp.user_id
         left join academic_years ay
           on ay.organisation_id = sp.organisation_id and ay.is_current
         left join student_enrolments se
           on se.student_profile_id = sp.id
          and se.academic_year_id = ay.id
          and se.is_primary and se.ended_on is null
         left join year_groups yg on yg.id = se.year_group_id
         left join lateral (
           select c.id, c.name
           from class_memberships cm
           join classes c on c.id = cm.class_id
           where cm.student_profile_id = sp.id and cm.ended_on is null and c.class_type = 'form'
             and (ay.id is null or cm.academic_year_id = ay.id)
           limit 1
         ) form on true
         where sp.id = $1 and sp.organisation_id = $2`,
        [studentId, orgId],
      );
      if (!rows.rows[0]) throw new AppError(404, "not_found", "Not found");
      const student = mapStudent(rows.rows[0]);
      return c.json({
        child: {
          id: student.id,
          legalName: student.legalName,
          preferredName: student.preferredName,
          currentYearGroupName: student.currentYearGroupName,
          currentFormClassName: student.currentFormClassName,
        },
      });
    }),
  );
}
