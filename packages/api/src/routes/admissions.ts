import type pg from "pg";
import { z } from "zod";
import {
  APPLICATION_STATUSES,
  ASSESSMENT_RECOMMENDATIONS,
  ASSESSMENT_STATUSES,
  ASSESSMENT_TYPES,
  ENQUIRY_STATUSES,
  OFFER_STATUSES,
  WAITING_LIST_STATUSES,
  type ApplicationStatus,
} from "@schoolapp/domain";
import {
  AppError,
  assertApplicationStatusTransition,
  canConvertAdmissions,
  canDecideAdmissions,
  canManageApplications,
  canManageEnquiries,
  canManageOffers,
  canReadAdmissions,
  createInboxNotification,
  writeAudit,
} from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  mapApplication,
  mapApplicationContact,
  mapApplicationHistory,
  mapAssessment,
  mapEnquiry,
  mapOffer,
  mapWaitingListEntry,
} from "../serialize";

const enquirySchema = z.object({
  pupilLegalName: z.string().min(1).max(120),
  pupilPreferredName: z.string().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  intendedAcademicYearId: z.string().uuid().optional(),
  intendedYearGroupId: z.string().uuid().optional(),
  guardianFullName: z.string().min(1).max(120),
  guardianEmail: z.string().email().optional(),
  guardianTelephone: z.string().max(40).optional(),
  enquiryDate: z.string().date().optional(),
  source: z.string().max(120).optional(),
  notes: z.string().max(4000).optional(),
  assignedStaffProfileId: z.string().uuid().optional(),
  status: z.enum(ENQUIRY_STATUSES).optional(),
});

const contactSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().optional(),
  telephone: z.string().max(40).optional(),
  relationship: z.string().min(1).max(40).default("other"),
  isPrimary: z.boolean().optional(),
  hasParentalResponsibility: z.boolean().optional(),
});

const applicationSchema = z.object({
  enquiryId: z.string().uuid().optional(),
  pupilLegalName: z.string().min(1).max(120),
  pupilPreferredName: z.string().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  intendedAcademicYearId: z.string().uuid().optional(),
  intendedYearGroupId: z.string().uuid().optional(),
  intendedEntryDate: z.string().date().optional(),
  previousSchool: z.string().max(200).optional(),
  currentSchool: z.string().max(200).optional(),
  applicationDate: z.string().date().optional(),
  source: z.string().max(120).optional(),
  internalNotes: z.string().max(4000).optional(),
  assignedStaffProfileId: z.string().uuid().optional(),
  status: z.enum(["enquiry", "draft", "submitted"]).optional(),
  contacts: z.array(contactSchema).optional(),
});

const ENQUIRY_SQL = `
  select e.id, e.reference, e.status, e.pupil_legal_name, e.pupil_preferred_name,
         e.date_of_birth::text, e.intended_academic_year_id, ay.name as intended_academic_year_name,
         e.intended_year_group_id, yg.name as intended_year_group_name,
         e.guardian_full_name, e.guardian_email, e.guardian_telephone, e.enquiry_date::text,
         e.source, e.notes, e.assigned_staff_profile_id, u.full_name as assigned_staff_name,
         e.converted_application_id, e.created_at, e.updated_at
  from admissions_enquiries e
  left join academic_years ay on ay.id = e.intended_academic_year_id
  left join year_groups yg on yg.id = e.intended_year_group_id
  left join staff_profiles sp on sp.id = e.assigned_staff_profile_id
  left join users u on u.id = sp.user_id
  where e.organisation_id = $1
`;

const APPLICATION_SQL = `
  select a.id, a.reference, a.status, a.enquiry_id, a.pupil_legal_name, a.pupil_preferred_name,
         a.date_of_birth::text, a.intended_academic_year_id, ay.name as intended_academic_year_name,
         a.intended_year_group_id, yg.name as intended_year_group_name, a.intended_entry_date::text,
         a.previous_school, a.current_school, a.application_date::text, a.submitted_at,
         a.source, a.internal_notes, a.assigned_staff_profile_id, u.full_name as assigned_staff_name,
         a.converted_student_profile_id, a.converted_at, a.created_at, a.updated_at
  from admissions_applications a
  left join academic_years ay on ay.id = a.intended_academic_year_id
  left join year_groups yg on yg.id = a.intended_year_group_id
  left join staff_profiles sp on sp.id = a.assigned_staff_profile_id
  left join users u on u.id = sp.user_id
  where a.organisation_id = $1
`;

const ASSESSMENT_SQL = `
  select s.id, s.application_id, a.reference as application_reference, a.pupil_legal_name,
         s.assessment_type, s.status, s.scheduled_at, s.completed_at,
         s.assigned_staff_profile_id, u.full_name as assigned_staff_name,
         s.notes, s.outcome, s.recommendation, s.created_at
  from admissions_assessments s
  join admissions_applications a on a.id = s.application_id
  left join staff_profiles sp on sp.id = s.assigned_staff_profile_id
  left join users u on u.id = sp.user_id
  where s.organisation_id = $1
`;

const WAITING_SQL = `
  select w.id, w.application_id, a.reference as application_reference, a.pupil_legal_name,
         a.status as application_status, w.intended_academic_year_id, ay.name as intended_academic_year_name,
         w.intended_year_group_id, yg.name as intended_year_group_name,
         w.status, w.priority, w.notes, w.added_at
  from admissions_waiting_list_entries w
  join admissions_applications a on a.id = w.application_id
  left join academic_years ay on ay.id = w.intended_academic_year_id
  left join year_groups yg on yg.id = w.intended_year_group_id
  where w.organisation_id = $1
`;

const OFFER_SQL = `
  select o.id, o.application_id, a.reference as application_reference, a.pupil_legal_name,
         o.status, o.offered_academic_year_id, ay.name as offered_academic_year_name,
         o.offered_year_group_id, yg.name as offered_year_group_name,
         o.intended_start_date::text, o.offer_made_on::text, o.response_deadline::text,
         o.accepted_at, o.declined_at, o.notes, o.created_at
  from admissions_offers o
  join admissions_applications a on a.id = o.application_id
  left join academic_years ay on ay.id = o.offered_academic_year_id
  left join year_groups yg on yg.id = o.offered_year_group_id
  where o.organisation_id = $1
`;

async function requireAdmissionsRead(actor: Parameters<typeof canReadAdmissions>[0]) {
  if (!canReadAdmissions(actor)) {
    throw new AppError(403, "forbidden", "Missing permission");
  }
}

async function loadApplication(client: pg.PoolClient, orgId: string, id: string) {
  const listed = await client.query(`${APPLICATION_SQL} and a.id = $2`, [orgId, id]);
  if (!listed.rows[0]) throw new AppError(404, "not_found", "Not found");
  return listed.rows[0] as Record<string, unknown>;
}

async function setTransitionReason(client: pg.PoolClient, reason: string | null) {
  await client.query("select set_config('app.admissions_transition_reason', $1, true)", [reason ?? ""]);
}

async function notifyApplicationContacts(
  client: Parameters<typeof createInboxNotification>[0],
  orgId: string,
  actorUserId: string,
  applicationId: string,
  title: string,
  body: string,
) {
  const contacts = await client.query<{ user_id: string }>(
    `select distinct user_id
     from admissions_application_contacts
     where application_id = $1 and organisation_id = $2 and user_id is not null`,
    [applicationId, orgId],
  );
  for (const row of contacts.rows) {
    await createInboxNotification(client, {
      organisationId: orgId,
      recipientUserId: row.user_id,
      actorUserId,
      title,
      body,
      actionTarget: { resourceType: "admissions_application", resourceId: applicationId },
    });
  }
}

async function insertContacts(
  client: pg.PoolClient,
  orgId: string,
  applicationId: string,
  contacts: z.infer<typeof contactSchema>[],
) {
  for (const contact of contacts) {
    const existingUser = contact.email
      ? await client.query<{ id: string }>(
          `select u.id
           from users u
           join organisation_memberships m on m.user_id = u.id
           where u.email = $1
             and m.organisation_id = $2
             and m.status in ('active', 'invited')
             and m.ended_at is null
           limit 1`,
          [contact.email.toLowerCase(), orgId],
        )
      : { rows: [] as Array<{ id: string }> };
    await client.query(
      `insert into admissions_application_contacts (
         organisation_id, application_id, full_name, email, telephone, relationship,
         is_primary, has_parental_responsibility, user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orgId,
        applicationId,
        contact.fullName,
        contact.email?.toLowerCase() ?? null,
        contact.telephone ?? null,
        contact.relationship,
        contact.isPrimary ?? false,
        contact.hasParentalResponsibility ?? false,
        existingUser.rows[0]?.id ?? null,
      ],
    );
  }
}

export function registerAdmissionsRoutes(app: SchoolappApi) {
  app.get("/admissions/dashboard", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const counts = await client.query<{ key: string; n: number }>(
        `select 'enquiries_new' as key, count(*)::int as n from admissions_enquiries
           where organisation_id = $1 and status = 'open'
         union all
         select 'applications_started', count(*)::int from admissions_applications
           where organisation_id = $1 and status in ('enquiry', 'draft')
         union all
         select 'applications_submitted', count(*)::int from admissions_applications
           where organisation_id = $1 and status = 'submitted'
         union all
         select 'awaiting_review', count(*)::int from admissions_applications
           where organisation_id = $1 and status in ('submitted', 'under_review', 'information_required')
         union all
         select 'assessments_due', count(*)::int from admissions_assessments
           where organisation_id = $1 and status = 'scheduled'
         union all
         select 'waiting_list', count(*)::int from admissions_waiting_list_entries
           where organisation_id = $1 and status = 'active'
         union all
         select 'offers_made', count(*)::int from admissions_offers
           where organisation_id = $1 and status in ('made', 'accepted')
         union all
         select 'offers_awaiting_response', count(*)::int from admissions_offers
           where organisation_id = $1 and status = 'made'
         union all
         select 'offers_accepted', count(*)::int from admissions_offers
           where organisation_id = $1 and status = 'accepted'
         union all
         select 'rejected', count(*)::int from admissions_applications
           where organisation_id = $1 and status = 'rejected'
         union all
         select 'withdrawn', count(*)::int from admissions_applications
           where organisation_id = $1 and status = 'withdrawn'
         union all
         select 'recently_enrolled', count(*)::int from admissions_applications
           where organisation_id = $1 and status = 'enrolled'
             and converted_at >= now() - interval '30 days'`,
        [orgId],
      );
      const byKey = Object.fromEntries(counts.rows.map((row) => [row.key, row.n]));
      return c.json({
        counts: {
          newEnquiries: byKey.enquiries_new ?? 0,
          applicationsStarted: byKey.applications_started ?? 0,
          applicationsSubmitted: byKey.applications_submitted ?? 0,
          awaitingReview: byKey.awaiting_review ?? 0,
          assessmentsDue: byKey.assessments_due ?? 0,
          waitingList: byKey.waiting_list ?? 0,
          offersMade: byKey.offers_made ?? 0,
          offersAwaitingResponse: byKey.offers_awaiting_response ?? 0,
          offersAccepted: byKey.offers_accepted ?? 0,
          rejected: byKey.rejected ?? 0,
          withdrawn: byKey.withdrawn ?? 0,
          recentlyEnrolled: byKey.recently_enrolled ?? 0,
        },
        links: {
          newEnquiries: "/school/admissions/enquiries?status=open",
          applicationsStarted: "/school/admissions/applications?status=draft",
          applicationsSubmitted: "/school/admissions/applications?status=submitted",
          awaitingReview: "/school/admissions/applications?status=under_review",
          assessmentsDue: "/school/admissions/assessments?status=scheduled",
          waitingList: "/school/admissions/waiting-list",
          offersMade: "/school/admissions/offers?status=made",
          offersAwaitingResponse: "/school/admissions/offers?status=made",
          offersAccepted: "/school/admissions/offers?status=accepted",
          rejected: "/school/admissions/applications?status=rejected",
          withdrawn: "/school/admissions/applications?status=withdrawn",
          recentlyEnrolled: "/school/admissions/applications?status=enrolled",
        },
      });
    }),
  );

  app.get("/admissions/enquiries", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const q = c.req.query("q")?.trim() || null;
      const status = c.req.query("status") || null;
      const rows = await client.query(
        `${ENQUIRY_SQL}
         and ($2::text is null or e.status = $2)
         and ($3::text is null or e.pupil_legal_name ilike '%' || $3 || '%'
              or e.guardian_full_name ilike '%' || $3 || '%'
              or e.reference ilike '%' || $3 || '%'
              or e.guardian_email ilike '%' || $3 || '%')
         order by e.enquiry_date desc, e.created_at desc`,
        [orgId, status, q],
      );
      return c.json({ enquiries: rows.rows.map(mapEnquiry) });
    }),
  );

  app.post("/admissions/enquiries", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageEnquiries(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = enquirySchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid enquiry payload");
      const reference = await client.query<{ next_admissions_reference: string }>(
        "select next_admissions_reference($1, 'enquiry')",
        [orgId],
      );
      const inserted = await client.query(
        `insert into admissions_enquiries (
           organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
           intended_academic_year_id, intended_year_group_id, guardian_full_name, guardian_email,
           guardian_telephone, enquiry_date, source, notes, assigned_staff_profile_id, created_by
         ) values (
           $1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, coalesce($12::date, current_date),
           $13, $14, $15, $16
         ) returning id`,
        [
          orgId,
          reference.rows[0]!.next_admissions_reference,
          parsed.data.status ?? "open",
          parsed.data.pupilLegalName,
          parsed.data.pupilPreferredName ?? null,
          parsed.data.dateOfBirth ?? null,
          parsed.data.intendedAcademicYearId ?? null,
          parsed.data.intendedYearGroupId ?? null,
          parsed.data.guardianFullName,
          parsed.data.guardianEmail?.toLowerCase() ?? null,
          parsed.data.guardianTelephone ?? null,
          parsed.data.enquiryDate ?? null,
          parsed.data.source ?? null,
          parsed.data.notes ?? null,
          parsed.data.assignedStaffProfileId ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.enquiry.created",
        entityType: "admissions_enquiry",
        entityId: inserted.rows[0]!.id,
        after: parsed.data,
      });
      const listed = await client.query(`${ENQUIRY_SQL} and e.id = $2`, [orgId, inserted.rows[0]!.id]);
      return c.json({ enquiry: mapEnquiry(listed.rows[0]!) }, 201);
    }),
  );

  app.get("/admissions/enquiries/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const id = uuidRouteParam(c, "id");
      const listed = await client.query(`${ENQUIRY_SQL} and e.id = $2`, [orgId, id]);
      if (!listed.rows[0]) throw new AppError(404, "not_found", "Not found");
      return c.json({ enquiry: mapEnquiry(listed.rows[0]) });
    }),
  );

  app.patch("/admissions/enquiries/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageEnquiries(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = enquirySchema.partial().safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid enquiry payload");
      const existing = await client.query(`${ENQUIRY_SQL} and e.id = $2`, [orgId, id]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.status === "converted" && !existing.rows[0].converted_application_id) {
        throw new AppError(
          400,
          "validation_failed",
          "Convert the enquiry with the dedicated convert endpoint",
        );
      }
      const updated = await client.query(
        `update admissions_enquiries
         set pupil_legal_name = coalesce($3, pupil_legal_name),
             pupil_preferred_name = coalesce($4, pupil_preferred_name),
             date_of_birth = coalesce($5::date, date_of_birth),
             intended_academic_year_id = coalesce($6, intended_academic_year_id),
             intended_year_group_id = coalesce($7, intended_year_group_id),
             guardian_full_name = coalesce($8, guardian_full_name),
             guardian_email = coalesce($9, guardian_email),
             guardian_telephone = coalesce($10, guardian_telephone),
             enquiry_date = coalesce($11::date, enquiry_date),
             source = coalesce($12, source),
             notes = coalesce($13, notes),
             assigned_staff_profile_id = coalesce($14, assigned_staff_profile_id),
             status = coalesce($15, status)
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          parsed.data.pupilLegalName ?? null,
          parsed.data.pupilPreferredName ?? null,
          parsed.data.dateOfBirth ?? null,
          parsed.data.intendedAcademicYearId ?? null,
          parsed.data.intendedYearGroupId ?? null,
          parsed.data.guardianFullName ?? null,
          parsed.data.guardianEmail?.toLowerCase() ?? null,
          parsed.data.guardianTelephone ?? null,
          parsed.data.enquiryDate ?? null,
          parsed.data.source ?? null,
          parsed.data.notes ?? null,
          parsed.data.assignedStaffProfileId ?? null,
          parsed.data.status ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.enquiry.updated",
        entityType: "admissions_enquiry",
        entityId: id,
        before: mapEnquiry(existing.rows[0]),
        after: parsed.data,
      });
      const listed = await client.query(`${ENQUIRY_SQL} and e.id = $2`, [orgId, id]);
      return c.json({ enquiry: mapEnquiry(listed.rows[0]!) });
    }),
  );

  app.post("/admissions/enquiries/:id/convert", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageEnquiries(actor) && !canManageApplications(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const enquiry = await client.query(`${ENQUIRY_SQL} and e.id = $2`, [orgId, id]);
      if (!enquiry.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (enquiry.rows[0].converted_application_id) {
        const existing = await client.query(`${APPLICATION_SQL} and a.id = $2`, [
          orgId,
          enquiry.rows[0].converted_application_id,
        ]);
        return c.json({ application: mapApplication(existing.rows[0]!) });
      }
      const reference = await client.query<{ next_admissions_reference: string }>(
        "select next_admissions_reference($1, 'application')",
        [orgId],
      );
      await setTransitionReason(client, "Converted from enquiry");
      const inserted = await client.query(
        `insert into admissions_applications (
           organisation_id, reference, enquiry_id, status, pupil_legal_name, pupil_preferred_name,
           date_of_birth, intended_academic_year_id, intended_year_group_id, source,
           assigned_staff_profile_id, created_by, application_date
         ) values (
           $1, $2, $3, 'draft', $4, $5, $6::date, $7, $8, $9, $10, $11, current_date
         ) returning id`,
        [
          orgId,
          reference.rows[0]!.next_admissions_reference,
          id,
          enquiry.rows[0].pupil_legal_name,
          enquiry.rows[0].pupil_preferred_name,
          enquiry.rows[0].date_of_birth,
          enquiry.rows[0].intended_academic_year_id,
          enquiry.rows[0].intended_year_group_id,
          enquiry.rows[0].source,
          enquiry.rows[0].assigned_staff_profile_id,
          userId,
        ],
      );
      const applicationId = inserted.rows[0]!.id as string;
      await insertContacts(client, orgId, applicationId, [
        {
          fullName: String(enquiry.rows[0].guardian_full_name),
          email: enquiry.rows[0].guardian_email ? String(enquiry.rows[0].guardian_email) : undefined,
          telephone: enquiry.rows[0].guardian_telephone ? String(enquiry.rows[0].guardian_telephone) : undefined,
          relationship: "other",
          isPrimary: true,
          hasParentalResponsibility: true,
        },
      ]);
      await client.query(
        `update admissions_enquiries
         set status = 'converted', converted_application_id = $3
         where id = $1 and organisation_id = $2`,
        [id, orgId, applicationId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.enquiry.converted",
        entityType: "admissions_enquiry",
        entityId: id,
        after: { applicationId },
      });
      const listed = await client.query(`${APPLICATION_SQL} and a.id = $2`, [orgId, applicationId]);
      return c.json({ application: mapApplication(listed.rows[0]!) }, 201);
    }),
  );

  app.get("/admissions/applications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const q = c.req.query("q")?.trim() || null;
      const status = c.req.query("status") || null;
      const yearGroupId = c.req.query("yearGroupId") || null;
      const academicYearId = c.req.query("academicYearId") || null;
      const rows = await client.query(
        `${APPLICATION_SQL}
         and ($2::text is null or a.status = $2)
         and ($3::uuid is null or a.intended_year_group_id = $3)
         and ($4::uuid is null or a.intended_academic_year_id = $4)
         and ($5::text is null or a.pupil_legal_name ilike '%' || $5 || '%'
              or a.reference ilike '%' || $5 || '%'
              or a.previous_school ilike '%' || $5 || '%')
         order by a.created_at desc`,
        [orgId, status, yearGroupId, academicYearId, q],
      );
      return c.json({ applications: rows.rows.map(mapApplication) });
    }),
  );

  app.post("/admissions/applications", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageApplications(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const parsed = applicationSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid application payload");
      const reference = await client.query<{ next_admissions_reference: string }>(
        "select next_admissions_reference($1, 'application')",
        [orgId],
      );
      const status = parsed.data.status ?? "draft";
      await setTransitionReason(client, "Application created");
      const inserted = await client.query(
        `insert into admissions_applications (
           organisation_id, reference, enquiry_id, status, pupil_legal_name, pupil_preferred_name,
           date_of_birth, intended_academic_year_id, intended_year_group_id, intended_entry_date,
           previous_school, current_school, application_date, source, internal_notes,
           assigned_staff_profile_id, created_by, submitted_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10::date, $11, $12,
           coalesce($13::date, current_date), $14, $15, $16, $17,
           case when $4 = 'submitted' then now() else null end
         ) returning id`,
        [
          orgId,
          reference.rows[0]!.next_admissions_reference,
          parsed.data.enquiryId ?? null,
          status,
          parsed.data.pupilLegalName,
          parsed.data.pupilPreferredName ?? null,
          parsed.data.dateOfBirth ?? null,
          parsed.data.intendedAcademicYearId ?? null,
          parsed.data.intendedYearGroupId ?? null,
          parsed.data.intendedEntryDate ?? null,
          parsed.data.previousSchool ?? null,
          parsed.data.currentSchool ?? null,
          parsed.data.applicationDate ?? null,
          parsed.data.source ?? null,
          parsed.data.internalNotes ?? null,
          parsed.data.assignedStaffProfileId ?? null,
          userId,
        ],
      );
      const applicationId = inserted.rows[0]!.id as string;
      if (parsed.data.contacts?.length) {
        await insertContacts(client, orgId, applicationId, parsed.data.contacts);
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.application.created",
        entityType: "admissions_application",
        entityId: applicationId,
        after: { reference: reference.rows[0]!.next_admissions_reference, status },
      });
      const listed = await client.query(`${APPLICATION_SQL} and a.id = $2`, [orgId, applicationId]);
      return c.json({ application: mapApplication(listed.rows[0]!) }, 201);
    }),
  );

  app.get("/admissions/applications/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const id = uuidRouteParam(c, "id");
      const application = await loadApplication(client, orgId, id);
      const contacts = await client.query(
        `select id, application_id, full_name, email, telephone, relationship,
                is_primary, has_parental_responsibility, user_id
         from admissions_application_contacts
         where application_id = $1 and organisation_id = $2
         order by is_primary desc, full_name`,
        [id, orgId],
      );
      const history = await client.query(
        `select h.id, h.previous_status, h.new_status, h.reason, h.actor_user_id,
                u.full_name as actor_name, h.created_at
         from admissions_application_status_history h
         left join users u on u.id = h.actor_user_id
         where h.application_id = $1 and h.organisation_id = $2
         order by h.created_at`,
        [id, orgId],
      );
      const assessments = await client.query(`${ASSESSMENT_SQL} and s.application_id = $2 order by s.scheduled_at nulls last, s.created_at`, [
        orgId,
        id,
      ]);
      const waiting = await client.query(`${WAITING_SQL} and w.application_id = $2 order by w.added_at`, [
        orgId,
        id,
      ]);
      const offers = await client.query(`${OFFER_SQL} and o.application_id = $2 order by o.offer_made_on desc, o.created_at desc`, [
        orgId,
        id,
      ]);
      return c.json({
        application: mapApplication(application),
        contacts: contacts.rows.map(mapApplicationContact),
        history: history.rows.map(mapApplicationHistory),
        assessments: assessments.rows.map(mapAssessment),
        waitingList: waiting.rows.map(mapWaitingListEntry),
        offers: offers.rows.map(mapOffer),
      });
    }),
  );

  app.patch("/admissions/applications/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageApplications(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = applicationSchema
        .omit({ contacts: true, status: true, enquiryId: true })
        .partial()
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid application payload");
      const existing = await loadApplication(client, orgId, id);
      const updated = await client.query(
        `update admissions_applications
         set pupil_legal_name = coalesce($3, pupil_legal_name),
             pupil_preferred_name = coalesce($4, pupil_preferred_name),
             date_of_birth = coalesce($5::date, date_of_birth),
             intended_academic_year_id = coalesce($6, intended_academic_year_id),
             intended_year_group_id = coalesce($7, intended_year_group_id),
             intended_entry_date = coalesce($8::date, intended_entry_date),
             previous_school = coalesce($9, previous_school),
             current_school = coalesce($10, current_school),
             application_date = coalesce($11::date, application_date),
             source = coalesce($12, source),
             internal_notes = coalesce($13, internal_notes),
             assigned_staff_profile_id = coalesce($14, assigned_staff_profile_id)
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          parsed.data.pupilLegalName ?? null,
          parsed.data.pupilPreferredName ?? null,
          parsed.data.dateOfBirth ?? null,
          parsed.data.intendedAcademicYearId ?? null,
          parsed.data.intendedYearGroupId ?? null,
          parsed.data.intendedEntryDate ?? null,
          parsed.data.previousSchool ?? null,
          parsed.data.currentSchool ?? null,
          parsed.data.applicationDate ?? null,
          parsed.data.source ?? null,
          parsed.data.internalNotes ?? null,
          parsed.data.assignedStaffProfileId ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.application.updated",
        entityType: "admissions_application",
        entityId: id,
        before: mapApplication(existing),
        after: parsed.data,
      });
      return c.json({ application: mapApplication(await loadApplication(client, orgId, id)) });
    }),
  );

  app.post("/admissions/applications/:id/status", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const parsed = z
        .object({
          status: z.enum(APPLICATION_STATUSES),
          reason: z.string().max(500).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid status payload");
      const existing = await loadApplication(client, orgId, id);
      const from = existing.status as ApplicationStatus;
      assertApplicationStatusTransition(actor, from, parsed.data.status);
      await setTransitionReason(client, parsed.data.reason ?? null);
      const updated = await client.query(
        `update admissions_applications
         set status = $3,
             submitted_at = case when $3 = 'submitted' then coalesce(submitted_at, now()) else submitted_at end
         where id = $1 and organisation_id = $2
         returning id`,
        [id, orgId, parsed.data.status],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.application.status_changed",
        entityType: "admissions_application",
        entityId: id,
        before: { status: from },
        after: { status: parsed.data.status, reason: parsed.data.reason ?? null },
      });
      if (["rejected", "withdrawn", "accepted"].includes(parsed.data.status)) {
        await notifyApplicationContacts(
          client,
          orgId,
          userId,
          id,
          `Application ${existing.reference}`,
          `Your application is now ${parsed.data.status.replaceAll("_", " ")}.`,
        );
      }
      return c.json({ application: mapApplication(await loadApplication(client, orgId, id)) });
    }),
  );

  app.post("/admissions/applications/:id/contacts", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      if (!canManageApplications(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      await loadApplication(client, orgId, id);
      const parsed = contactSchema.safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid contact payload");
      await insertContacts(client, orgId, id, [parsed.data]);
      const contacts = await client.query(
        `select id, application_id, full_name, email, telephone, relationship,
                is_primary, has_parental_responsibility, user_id
         from admissions_application_contacts
         where application_id = $1 and organisation_id = $2
         order by is_primary desc, full_name`,
        [id, orgId],
      );
      return c.json({ contacts: contacts.rows.map(mapApplicationContact) }, 201);
    }),
  );

  app.get("/admissions/assessments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const status = c.req.query("status") || null;
      const applicationId = c.req.query("applicationId") || null;
      const rows = await client.query(
        `${ASSESSMENT_SQL}
         and ($2::text is null or s.status = $2)
         and ($3::uuid is null or s.application_id = $3)
         order by s.scheduled_at nulls last, s.created_at desc`,
        [orgId, status, applicationId],
      );
      return c.json({ assessments: rows.rows.map(mapAssessment) });
    }),
  );

  app.post("/admissions/applications/:id/assessments", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageApplications(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const applicationId = uuidRouteParam(c, "id");
      await loadApplication(client, orgId, applicationId);
      const parsed = z
        .object({
          assessmentType: z.enum(ASSESSMENT_TYPES),
          status: z.enum(ASSESSMENT_STATUSES).optional(),
          scheduledAt: z.string().min(1).optional(),
          assignedStaffProfileId: z.string().uuid().optional(),
          notes: z.string().max(4000).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assessment payload");
      const inserted = await client.query(
        `insert into admissions_assessments (
           organisation_id, application_id, assessment_type, status, scheduled_at,
           assigned_staff_profile_id, notes, created_by
         ) values ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         returning id`,
        [
          orgId,
          applicationId,
          parsed.data.assessmentType,
          parsed.data.status ?? "scheduled",
          parsed.data.scheduledAt ?? null,
          parsed.data.assignedStaffProfileId ?? null,
          parsed.data.notes ?? null,
          userId,
        ],
      );
      const application = await loadApplication(client, orgId, applicationId);
      if (application.status === "under_review" || application.status === "submitted") {
        await setTransitionReason(client, "Assessment scheduled");
        await client.query(
          `update admissions_applications set status = 'assessment_pending'
           where id = $1 and organisation_id = $2 and status in ('under_review', 'submitted')`,
          [applicationId, orgId],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.assessment.created",
        entityType: "admissions_assessment",
        entityId: inserted.rows[0]!.id,
        after: parsed.data,
      });
      const listed = await client.query(`${ASSESSMENT_SQL} and s.id = $2`, [orgId, inserted.rows[0]!.id]);
      return c.json({ assessment: mapAssessment(listed.rows[0]!) }, 201);
    }),
  );

  app.patch("/admissions/assessments/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageApplications(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = z
        .object({
          status: z.enum(ASSESSMENT_STATUSES).optional(),
          scheduledAt: z.string().min(1).nullable().optional(),
          assignedStaffProfileId: z.string().uuid().nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
          outcome: z.string().max(4000).nullable().optional(),
          recommendation: z.enum(ASSESSMENT_RECOMMENDATIONS).nullable().optional(),
          completedAt: z.string().min(1).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid assessment payload");
      const existing = await client.query(`${ASSESSMENT_SQL} and s.id = $2`, [orgId, id]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const completed =
        parsed.data.status === "completed"
          ? parsed.data.completedAt ?? new Date().toISOString()
          : parsed.data.completedAt ?? null;
      const updated = await client.query(
        `update admissions_assessments
         set status = coalesce($3, status),
             scheduled_at = case when $4::boolean then $5::timestamptz else scheduled_at end,
             assigned_staff_profile_id = case when $6::boolean then $7 else assigned_staff_profile_id end,
             notes = case when $8::boolean then $9 else notes end,
             outcome = case when $10::boolean then $11 else outcome end,
             recommendation = case when $12::boolean then $13 else recommendation end,
             completed_at = case
               when $3 = 'completed' then coalesce($14::timestamptz, completed_at, now())
               when $14::timestamptz is not null then $14::timestamptz
               else completed_at
             end
         where id = $1 and organisation_id = $2
         returning id, application_id`,
        [
          id,
          orgId,
          parsed.data.status ?? null,
          parsed.data.scheduledAt !== undefined,
          parsed.data.scheduledAt ?? null,
          parsed.data.assignedStaffProfileId !== undefined,
          parsed.data.assignedStaffProfileId ?? null,
          parsed.data.notes !== undefined,
          parsed.data.notes ?? null,
          parsed.data.outcome !== undefined,
          parsed.data.outcome ?? null,
          parsed.data.recommendation !== undefined,
          parsed.data.recommendation ?? null,
          completed,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      if (parsed.data.status === "completed") {
        await setTransitionReason(client, "Assessment completed");
        await client.query(
          `update admissions_applications set status = 'assessment_completed'
           where id = $1 and organisation_id = $2 and status = 'assessment_pending'`,
          [updated.rows[0].application_id, orgId],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.assessment.updated",
        entityType: "admissions_assessment",
        entityId: id,
        after: parsed.data,
      });
      const listed = await client.query(`${ASSESSMENT_SQL} and s.id = $2`, [orgId, id]);
      return c.json({ assessment: mapAssessment(listed.rows[0]!) });
    }),
  );

  app.get("/admissions/waiting-list", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const status = c.req.query("status") || "active";
      const yearGroupId = c.req.query("yearGroupId") || null;
      const academicYearId = c.req.query("academicYearId") || null;
      const rows = await client.query(
        `${WAITING_SQL}
         and ($2::text is null or w.status = $2)
         and ($3::uuid is null or w.intended_year_group_id = $3)
         and ($4::uuid is null or w.intended_academic_year_id = $4)
         order by w.priority nulls last, w.added_at`,
        [orgId, status === "all" ? null : status, yearGroupId, academicYearId],
      );
      return c.json({ entries: rows.rows.map(mapWaitingListEntry) });
    }),
  );

  app.post("/admissions/applications/:id/waiting-list", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canDecideAdmissions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const application = await loadApplication(client, orgId, id);
      const parsed = z
        .object({
          priority: z.number().int().min(1).max(9999).optional(),
          notes: z.string().max(4000).optional(),
        })
        .safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid waiting-list payload");
      assertApplicationStatusTransition(actor, application.status as ApplicationStatus, "waiting_list");
      await setTransitionReason(client, "Placed on waiting list");
      if (application.status !== "waiting_list") {
        await client.query(
          `update admissions_applications set status = 'waiting_list'
           where id = $1 and organisation_id = $2`,
          [id, orgId],
        );
      }
      const entry = await client.query(
        `insert into admissions_waiting_list_entries (
           organisation_id, application_id, intended_academic_year_id, intended_year_group_id,
           status, priority, notes, created_by
         ) values ($1, $2, $3, $4, 'active', $5, $6, $7)
         on conflict (application_id) where status = 'active' do update
           set priority = coalesce(excluded.priority, admissions_waiting_list_entries.priority),
               notes = coalesce(excluded.notes, admissions_waiting_list_entries.notes)
         returning id`,
        [
          orgId,
          id,
          application.intended_academic_year_id,
          application.intended_year_group_id,
          parsed.data.priority ?? null,
          parsed.data.notes ?? null,
          userId,
        ],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.waiting_list.added",
        entityType: "admissions_waiting_list_entry",
        entityId: entry.rows[0]!.id,
        after: { applicationId: id },
      });
      const listed = await client.query(`${WAITING_SQL} and w.id = $2`, [orgId, entry.rows[0]!.id]);
      return c.json({ entry: mapWaitingListEntry(listed.rows[0]!) }, 201);
    }),
  );

  app.patch("/admissions/waiting-list/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canDecideAdmissions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const parsed = z
        .object({
          status: z.enum(WAITING_LIST_STATUSES).optional(),
          priority: z.number().int().min(1).max(9999).nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid waiting-list payload");
      const updated = await client.query(
        `update admissions_waiting_list_entries
         set status = coalesce($3, status),
             priority = case when $4::boolean then $5 else priority end,
             notes = case when $6::boolean then $7 else notes end
         where id = $1 and organisation_id = $2
         returning id`,
        [
          id,
          orgId,
          parsed.data.status ?? null,
          parsed.data.priority !== undefined,
          parsed.data.priority ?? null,
          parsed.data.notes !== undefined,
          parsed.data.notes ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.waiting_list.updated",
        entityType: "admissions_waiting_list_entry",
        entityId: id,
        after: parsed.data,
      });
      const listed = await client.query(`${WAITING_SQL} and w.id = $2`, [orgId, id]);
      return c.json({ entry: mapWaitingListEntry(listed.rows[0]!) });
    }),
  );

  app.get("/admissions/offers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      await requireAdmissionsRead(actor);
      const status = c.req.query("status") || null;
      const rows = await client.query(
        `${OFFER_SQL}
         and ($2::text is null or o.status = $2)
         order by o.offer_made_on desc, o.created_at desc`,
        [orgId, status],
      );
      return c.json({ offers: rows.rows.map(mapOffer) });
    }),
  );

  app.post("/admissions/applications/:id/offers", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageOffers(actor) && !canDecideAdmissions(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const application = await loadApplication(client, orgId, id);
      const parsed = z
        .object({
          offeredAcademicYearId: z.string().uuid().optional(),
          offeredYearGroupId: z.string().uuid().optional(),
          intendedStartDate: z.string().date().optional(),
          offerMadeOn: z.string().date().optional(),
          responseDeadline: z.string().date().optional(),
          notes: z.string().max(4000).optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid offer payload");
      assertApplicationStatusTransition(actor, application.status as ApplicationStatus, "offer_made");
      const inserted = await client.query(
        `insert into admissions_offers (
           organisation_id, application_id, status, offered_academic_year_id, offered_year_group_id,
           intended_start_date, offer_made_on, response_deadline, notes, created_by
         ) values (
           $1, $2, 'made', coalesce($3::uuid, $8::uuid), coalesce($4::uuid, $9::uuid), $5::date,
           coalesce($6::date, current_date), $7::date, $10, $11
         ) returning id`,
        [
          orgId,
          id,
          parsed.data.offeredAcademicYearId ?? null,
          parsed.data.offeredYearGroupId ?? null,
          parsed.data.intendedStartDate ?? null,
          parsed.data.offerMadeOn ?? null,
          parsed.data.responseDeadline ?? null,
          application.intended_academic_year_id,
          application.intended_year_group_id,
          parsed.data.notes ?? null,
          userId,
        ],
      );
      await setTransitionReason(client, "Offer made");
      await client.query(
        `update admissions_applications set status = 'offer_made'
         where id = $1 and organisation_id = $2`,
        [id, orgId],
      );
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: "admissions.offer.made",
        entityType: "admissions_offer",
        entityId: inserted.rows[0]!.id,
        after: parsed.data,
      });
      await notifyApplicationContacts(
        client,
        orgId,
        userId,
        id,
        `Offer ${application.reference}`,
        "An admissions offer has been recorded for this application.",
      );
      const listed = await client.query(`${OFFER_SQL} and o.id = $2`, [orgId, inserted.rows[0]!.id]);
      return c.json({ offer: mapOffer(listed.rows[0]!) }, 201);
    }),
  );

  app.patch("/admissions/offers/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canManageOffers(actor) && !canDecideAdmissions(actor)) {
        throw new AppError(403, "forbidden", "Missing permission");
      }
      const id = uuidRouteParam(c, "id");
      const parsed = z
        .object({
          status: z.enum(OFFER_STATUSES).optional(),
          responseDeadline: z.string().date().nullable().optional(),
          intendedStartDate: z.string().date().nullable().optional(),
          notes: z.string().max(4000).nullable().optional(),
          waitlistOnDecline: z.boolean().optional(),
        })
        .safeParse(await c.req.json());
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid offer payload");
      const existing = await client.query(`${OFFER_SQL} and o.id = $2`, [orgId, id]);
      if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
      const nextStatus = parsed.data.status;
      const updated = await client.query(
        `update admissions_offers
         set status = coalesce($3, status),
             response_deadline = case when $4::boolean then $5::date else response_deadline end,
             intended_start_date = case when $6::boolean then $7::date else intended_start_date end,
             notes = case when $8::boolean then $9 else notes end,
             accepted_at = case when $3 = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
             declined_at = case when $3 in ('declined', 'expired', 'withdrawn') then coalesce(declined_at, now()) else declined_at end
         where id = $1 and organisation_id = $2
         returning id, application_id, status`,
        [
          id,
          orgId,
          nextStatus ?? null,
          parsed.data.responseDeadline !== undefined,
          parsed.data.responseDeadline ?? null,
          parsed.data.intendedStartDate !== undefined,
          parsed.data.intendedStartDate ?? null,
          parsed.data.notes !== undefined,
          parsed.data.notes ?? null,
        ],
      );
      if (!updated.rows[0]) throw new AppError(404, "not_found", "Not found");
      const applicationId = updated.rows[0].application_id as string;
      const application = await loadApplication(client, orgId, applicationId);
      if (nextStatus === "accepted") {
        assertApplicationStatusTransition(actor, application.status as ApplicationStatus, "accepted");
        await setTransitionReason(client, "Offer accepted");
        await client.query(
          `update admissions_applications set status = 'accepted'
           where id = $1 and organisation_id = $2`,
          [applicationId, orgId],
        );
      } else if (nextStatus === "declined") {
        const to = parsed.data.waitlistOnDecline ? "waiting_list" : "rejected";
        assertApplicationStatusTransition(actor, application.status as ApplicationStatus, to);
        await setTransitionReason(client, parsed.data.waitlistOnDecline ? "Offer declined; waiting list" : "Offer declined");
        await client.query(
          `update admissions_applications set status = $3
           where id = $1 and organisation_id = $2`,
          [applicationId, orgId, to],
        );
      } else if (nextStatus === "expired" || nextStatus === "withdrawn") {
        await setTransitionReason(client, `Offer ${nextStatus}`);
        await client.query(
          `update admissions_applications set status = 'withdrawn'
           where id = $1 and organisation_id = $2 and status = 'offer_made'`,
          [applicationId, orgId],
        );
      }
      await writeAudit(client, {
        organisationId: orgId,
        actorUserId: userId,
        action: `admissions.offer.${nextStatus ?? "updated"}`,
        entityType: "admissions_offer",
        entityId: id,
        after: parsed.data,
      });
      if (nextStatus === "accepted" || nextStatus === "declined") {
        await notifyApplicationContacts(
          client,
          orgId,
          userId,
          applicationId,
          `Offer ${application.reference}`,
          nextStatus === "accepted" ? "The admissions offer was accepted." : "The admissions offer was declined.",
        );
      }
      const listed = await client.query(`${OFFER_SQL} and o.id = $2`, [orgId, id]);
      return c.json({ offer: mapOffer(listed.rows[0]!) });
    }),
  );

  app.post("/admissions/applications/:id/enrol", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (!canConvertAdmissions(actor)) throw new AppError(403, "forbidden", "Missing permission");
      const id = uuidRouteParam(c, "id");
      const application = await loadApplication(client, orgId, id);
      const parsed = z
        .object({
          academicYearId: z.string().uuid().optional(),
          yearGroupId: z.string().uuid().optional(),
          classId: z.string().uuid().optional(),
          admissionNumber: z.string().max(40).optional(),
          existingStudentProfileId: z.string().uuid().optional(),
          guardianLinks: z
            .array(
              z.object({
                contactId: z.string().uuid(),
                portalAccess: z.boolean().optional(),
              }),
            )
            .optional(),
        })
        .safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid enrolment payload");
      if (application.status !== "accepted" && application.status !== "enrolled") {
        throw new AppError(409, "conflict", "Only an accepted application can be enrolled");
      }
      const alreadyEnrolled = application.status === "enrolled" && application.converted_student_profile_id;
      const converted = await client.query<{ enrol_admitted_applicant: string }>(
        `select enrol_admitted_applicant($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          userId,
          orgId,
          id,
          parsed.data.academicYearId ?? application.intended_academic_year_id ?? null,
          parsed.data.yearGroupId ?? application.intended_year_group_id ?? null,
          parsed.data.classId ?? null,
          parsed.data.admissionNumber ?? null,
          parsed.data.existingStudentProfileId ?? null,
          JSON.stringify(
            (parsed.data.guardianLinks ?? []).map((link) => ({
              contactId: link.contactId,
              portalAccess: link.portalAccess ?? false,
            })),
          ),
        ],
      );
      if (!alreadyEnrolled) {
        await notifyApplicationContacts(
          client,
          orgId,
          userId,
          id,
          `Enrolment ${application.reference}`,
          "The applicant has been enrolled at the school.",
        );
      }
      const listed = await client.query(`${APPLICATION_SQL} and a.id = $2`, [orgId, id]);
      return c.json({
        application: mapApplication(listed.rows[0]!),
        studentProfileId: converted.rows[0]!.enrol_admitted_applicant,
      });
    }),
  );
}
