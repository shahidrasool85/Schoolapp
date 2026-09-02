import type pg from "pg";
import {
  PERMISSIONS,
  displayPersonName,
  parentSelfCanEditField,
  profilePhotoUrl,
  staffPersonaLabel,
  staffSelfCanEditField,
  type Actor,
} from "@schoolapp/domain";
import { AppError } from "./errors.js";
import { writeAudit } from "./academic.js";
import { canReadStudentProfile, guardianChildIds } from "./students-access.js";

export const PROFILE_CONTACT_FIELDS = [
  "title",
  "preferredName",
  "phone",
  "addressLine1",
  "addressLine2",
  "addressTown",
  "addressCounty",
  "addressPostcode",
] as const;

export type ProfileContactField = (typeof PROFILE_CONTACT_FIELDS)[number];

export type PersonContact = {
  title: string | null;
  fullName: string;
  preferredName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressTown: string | null;
  addressCounty: string | null;
  addressPostcode: string | null;
  photoObjectId: string | null;
  photoUrl: string | null;
};

export type OwnProfile = PersonContact & {
  userId: string;
  userKind: string;
  jobTitle: string | null;
  employeeNumber: string | null;
  startedOn: string | null;
  staffProfileId: string | null;
  roleKeys: string[];
  personaLabel: string | null;
  membershipStatus: string | null;
  editableFields: string[];
  readOnlyFields: string[];
  assignments: Array<{
    id: string;
    classId: string;
    className: string | null;
    assignmentRole: string;
    startedOn: string | null;
    endedOn: string | null;
    subjects: unknown;
  }>;
  children: Array<{
    studentProfileId: string;
    legalName: string;
    relationship: string;
    photoObjectId: string | null;
    photoUrl: string | null;
  }>;
};

const CONTACT_COLUMN: Record<ProfileContactField, string> = {
  title: "title",
  preferredName: "preferred_name",
  phone: "phone",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  addressTown: "address_town",
  addressCounty: "address_county",
  addressPostcode: "address_postcode",
};

export const USER_CONTACT_SELECT = `
  u.title,
  u.full_name,
  u.preferred_name,
  u.email,
  u.phone,
  u.address_line1,
  u.address_line2,
  u.address_town,
  u.address_county,
  u.address_postcode
`;

export const MEMBERSHIP_PHOTO_SELECT = `
  m.profile_photo_stored_object_id
`;

export function mapPersonContact(row: Record<string, unknown>): PersonContact {
  const fullName = String(row.full_name ?? "");
  const preferredName = (row.preferred_name as string | null) ?? null;
  const title = (row.title as string | null) ?? null;
  const photoObjectId = (row.profile_photo_stored_object_id as string | null) ?? null;
  return {
    title,
    fullName,
    preferredName,
    displayName: displayPersonName({ title, fullName, preferredName }),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    addressLine1: (row.address_line1 as string | null) ?? null,
    addressLine2: (row.address_line2 as string | null) ?? null,
    addressTown: (row.address_town as string | null) ?? null,
    addressCounty: (row.address_county as string | null) ?? null,
    addressPostcode: (row.address_postcode as string | null) ?? null,
    photoObjectId,
    photoUrl: profilePhotoUrl(photoObjectId),
  };
}

export function ownEditableFields(actor: Actor, hasStaffProfile: boolean): string[] {
  if (actor.userKind === "student") return [];
  if (hasStaffProfile) return [...PROFILE_CONTACT_FIELDS, "photo"];
  if (actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN)) {
    return [...PROFILE_CONTACT_FIELDS, "photo"];
  }
  return [];
}

export function ownReadOnlyFields(editable: string[]): string[] {
  const all = [
    "fullName",
    "email",
    "jobTitle",
    "employeeNumber",
    "roleKeys",
    "membershipStatus",
    "assignments",
    "children",
    ...PROFILE_CONTACT_FIELDS,
    "photo",
  ];
  return all.filter((field) => !editable.includes(field));
}

export async function loadOwnProfile(
  client: pg.PoolClient,
  input: { actor: Actor; organisationId: string; userId: string },
): Promise<OwnProfile> {
  const row = await client.query(
    `select
        u.id,
        u.user_kind,
        ${USER_CONTACT_SELECT},
        ${MEMBERSHIP_PHOTO_SELECT},
        m.status as membership_status,
        sp.id as staff_profile_id,
        sp.job_title,
        sp.employee_number,
        sp.started_on::text
     from users u
     join organisation_memberships m
       on m.user_id = u.id and m.organisation_id = $2 and m.ended_at is null
     left join staff_profiles sp
       on sp.user_id = u.id and sp.organisation_id = $2
     where u.id = $1
     order by case m.status when 'active' then 0 when 'invited' then 1 else 2 end
     limit 1`,
    [input.userId, input.organisationId],
  );
  if (!row.rows[0]) {
    throw new AppError(404, "not_found", "Not found");
  }
  const contact = mapPersonContact(row.rows[0] as Record<string, unknown>);
  const staffProfileId = (row.rows[0].staff_profile_id as string | null) ?? null;
  const roleKeys = [...input.actor.roleKeys];
  const editable = ownEditableFields(input.actor, Boolean(staffProfileId));
  const assignments = staffProfileId
    ? await client.query(
        `select csa.id, csa.class_id, c.name as class_name, csa.assignment_role,
                csa.started_on::text, csa.ended_on::text,
                coalesce((
                  select json_agg(json_build_object('id', s.id, 'key', s.key, 'name', s.name) order by s.name)
                  from class_subjects cs
                  join subjects s on s.id = cs.subject_id
                  where cs.class_id = c.id
                ), '[]'::json) as subjects
         from class_staff_assignments csa
         join classes c on c.id = csa.class_id
         where csa.staff_profile_id = $1 and csa.organisation_id = $2
           and csa.ended_on is null
         order by c.name`,
        [staffProfileId, input.organisationId],
      )
    : { rows: [] as Array<Record<string, unknown>> };
  const children = input.actor.permissions.has(PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN)
    ? await client.query(
        `select g.student_profile_id, sp.legal_name, g.relationship,
                cm.profile_photo_stored_object_id
         from guardianships g
         join student_profiles sp on sp.id = g.student_profile_id
         left join organisation_memberships cm
           on cm.user_id = sp.user_id
          and cm.organisation_id = g.organisation_id
          and cm.ended_at is null
         where g.guardian_user_id = $1
           and g.organisation_id = $2
           and g.ended_on is null
           and g.portal_access
         order by g.priority, sp.legal_name`,
        [input.userId, input.organisationId],
      )
    : { rows: [] as Array<Record<string, unknown>> };

  return {
    ...contact,
    userId: String(row.rows[0].id),
    userKind: String(row.rows[0].user_kind),
    jobTitle: (row.rows[0].job_title as string | null) ?? null,
    employeeNumber: (row.rows[0].employee_number as string | null) ?? null,
    startedOn: (row.rows[0].started_on as string | null) ?? null,
    staffProfileId,
    roleKeys,
    personaLabel: staffProfileId ? staffPersonaLabel(roleKeys) : null,
    membershipStatus: (row.rows[0].membership_status as string | null) ?? null,
    editableFields: editable,
    readOnlyFields: ownReadOnlyFields(editable),
    assignments: assignments.rows.map((item) => ({
      id: String(item.id),
      classId: String(item.class_id),
      className: (item.class_name as string | null) ?? null,
      assignmentRole: String(item.assignment_role),
      startedOn: (item.started_on as string | null) ?? null,
      endedOn: (item.ended_on as string | null) ?? null,
      subjects: item.subjects ?? [],
    })),
    children: children.rows.map((item) => {
      const photoObjectId = (item.profile_photo_stored_object_id as string | null) ?? null;
      return {
        studentProfileId: String(item.student_profile_id),
        legalName: String(item.legal_name),
        relationship: String(item.relationship),
        photoObjectId,
        photoUrl: profilePhotoUrl(photoObjectId),
      };
    }),
  };
}

export function assertSelfCanEditContact(actor: Actor, fields: string[]): void {
  const allowed =
    actor.userKind === "student"
      ? new Set<string>()
      : actor.userKind === "parent"
        ? new Set(PROFILE_CONTACT_FIELDS.filter((field) => parentSelfCanEditField(field)))
        : new Set(PROFILE_CONTACT_FIELDS.filter((field) => staffSelfCanEditField(field)));
  const blocked = fields.filter((field) => !allowed.has(field));
  if (blocked.length > 0) {
    throw new AppError(403, "forbidden", "This field is managed by the school", {
      fieldKey: blocked[0],
    });
  }
}

export async function applyOwnContactUpdate(
  client: pg.PoolClient,
  input: {
    actor: Actor;
    organisationId: string;
    userId: string;
    data: Partial<Record<ProfileContactField, string | null>>;
  },
): Promise<void> {
  const keys = (Object.keys(input.data) as ProfileContactField[]).filter(
    (key) => input.data[key] !== undefined,
  );
  if (keys.length === 0) return;
  assertSelfCanEditContact(input.actor, keys);
  const existing = await client.query("select id from users where id = $1", [input.userId]);
  if (!existing.rows[0]) throw new AppError(404, "not_found", "Not found");
  const assignments: unknown[] = [input.userId];
  const sets: string[] = [];
  for (const key of keys) {
    assignments.push(input.data[key] === null ? null : String(input.data[key]).trim() || null);
    sets.push(`${CONTACT_COLUMN[key]} = $${assignments.length}`);
  }
  await client.query(`update users set ${sets.join(", ")} where id = $1`, assignments);
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.userId,
    action: "profile.contact.updated",
    entityType: "user",
    entityId: input.userId,
    after: { fields: keys },
  });
}

export async function applyOrgUserContactUpdate(
  client: pg.PoolClient,
  input: {
    actorUserId: string;
    organisationId: string;
    targetUserId: string;
    permission: string;
    title?: string | null;
    fullName?: string | null;
    preferredName?: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    addressTown?: string | null;
    addressCounty?: string | null;
    addressPostcode?: string | null;
  },
): Promise<void> {
  const changed: string[] = [];
  if (input.title !== undefined) changed.push("title");
  if (input.fullName !== undefined) changed.push("fullName");
  if (input.preferredName !== undefined) changed.push("preferredName");
  if (input.phone !== undefined) changed.push("phone");
  if (input.addressLine1 !== undefined) changed.push("addressLine1");
  if (input.addressLine2 !== undefined) changed.push("addressLine2");
  if (input.addressTown !== undefined) changed.push("addressTown");
  if (input.addressCounty !== undefined) changed.push("addressCounty");
  if (input.addressPostcode !== undefined) changed.push("addressPostcode");
  if (changed.length === 0) return;
  await client.query(
    `select update_org_user_contact(
       $1,$2,$3,$4,
       $5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )`,
    [
      input.actorUserId,
      input.organisationId,
      input.targetUserId,
      input.permission,
      input.title !== undefined,
      input.title ?? null,
      input.fullName !== undefined,
      input.fullName ?? null,
      input.preferredName !== undefined,
      input.preferredName ?? null,
      input.phone !== undefined,
      input.phone ?? null,
      input.addressLine1 !== undefined,
      input.addressLine1 ?? null,
      input.addressLine2 !== undefined,
      input.addressLine2 ?? null,
      input.addressTown !== undefined,
      input.addressTown ?? null,
      input.addressCounty !== undefined,
      input.addressCounty ?? null,
      input.addressPostcode !== undefined,
      input.addressPostcode ?? null,
    ],
  );
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "profile.contact.updated",
    entityType: "user",
    entityId: input.targetUserId,
    after: { fields: changed, schoolManaged: true },
  });
}

export async function setProfilePhotoPointer(
  client: pg.PoolClient,
  input: {
    actorUserId: string;
    organisationId: string;
    targetUserId: string;
    storedObjectId: string | null;
    requiredPermission: string | null;
  },
): Promise<string | null> {
  const result = await client.query<{ set_membership_profile_photo: string | null }>(
    "select set_membership_profile_photo($1,$2,$3,$4,$5) as set_membership_profile_photo",
    [
      input.actorUserId,
      input.organisationId,
      input.targetUserId,
      input.storedObjectId,
      input.requiredPermission,
    ],
  );
  const previous = result.rows[0]?.set_membership_profile_photo ?? null;
  await writeAudit(client, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.storedObjectId ? "profile.photo.replaced" : "profile.photo.removed",
    entityType: "user",
    entityId: input.targetUserId,
    after: { photo: input.storedObjectId ? "set" : "cleared" },
  });
  return previous;
}

export async function authorizeProfilePhotoDownload(
  client: pg.PoolClient,
  actor: Actor,
  organisationId: string,
  subjectUserId: string,
): Promise<boolean> {
  if (actor.userId === subjectUserId) return true;

  const staff = await client.query(
    "select 1 from staff_profiles where user_id = $1 and organisation_id = $2",
    [subjectUserId, organisationId],
  );
  if (staff.rows[0]) {
    if (
      actor.userKind === "student" ||
      actor.userKind === "parent" ||
      actor.permissions.has(PERMISSIONS.ORG_MEMBERS_READ) ||
      actor.permissions.has(PERMISSIONS.ORG_MEMBERS_MANAGE) ||
      actor.permissions.has(PERMISSIONS.ACADEMIC_STRUCTURE_MANAGE)
    ) {
      return true;
    }
  }

  const student = await client.query<{ id: string }>(
    "select id from student_profiles where user_id = $1 and organisation_id = $2",
    [subjectUserId, organisationId],
  );
  if (student.rows[0]) {
    if (await canReadStudentProfile(client, actor.userId, organisationId, student.rows[0].id, actor.permissions)) {
      return true;
    }
    if (actor.userKind === "parent") {
      const children = await guardianChildIds(client, actor.userId, organisationId);
      if (children.has(student.rows[0].id)) return true;
    }
  }

  if (
    actor.permissions.has(PERMISSIONS.GUARDIANSHIPS_MANAGE) ||
    actor.permissions.has(PERMISSIONS.ORG_MEMBERS_READ)
  ) {
    const parent = await client.query(
      `select 1 from guardianships
       where guardian_user_id = $1 and organisation_id = $2 and ended_on is null
       limit 1`,
      [subjectUserId, organisationId],
    );
    if (parent.rows[0]) return true;
  }

  return false;
}

export function assertStudentCannotManageOfficialPhoto(actor: Actor): void {
  if (actor.userKind === "student" || actor.userKind === "parent") {
    throw new AppError(403, "forbidden", "The official pupil photo is managed by the school");
  }
}

export function studentPhotoManagePermission(): string {
  return PERMISSIONS.STUDENTS_PROFILES_MANAGE;
}

export function staffPhotoManagePermission(): string {
  return PERMISSIONS.ORG_MEMBERS_MANAGE;
}

export function parentPhotoManagePermission(): string {
  return PERMISSIONS.GUARDIANSHIPS_MANAGE;
}
