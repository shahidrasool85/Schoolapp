import { z } from "zod";
import { PERMISSIONS, isPersonTitle } from "@schoolapp/domain";
import {
  AppError,
  applyOwnContactUpdate,
  applyOrgUserContactUpdate,
  assertPermission,
  loadOwnProfile,
  mapPersonContact,
  parentPhotoManagePermission,
  setProfilePhotoPointer,
  staffPhotoManagePermission,
  studentPhotoManagePermission,
} from "@schoolapp/core";
import { assertProfilePhotoDimensions, validateUpload } from "@schoolapp/storage";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { withSchoolActor } from "../school-context";
import {
  insertPendingObject,
  profileForDomain,
  putAndActivateObject,
  readUploadedFile,
  retireStoredObject,
  runUpload,
  scannerOf,
  storageErrorToAppError,
  storageOf,
} from "../file-service";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .nullable();

const selfContactSchema = z
  .object({
    title: z
      .string()
      .max(20)
      .nullable()
      .refine((value) => value == null || value === "" || isPersonTitle(value.trim()), {
        message: "Choose a recognised title",
      })
      .optional(),
    preferredName: z.string().max(80).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    addressLine1: z.string().max(120).nullable().optional(),
    addressLine2: z.string().max(120).nullable().optional(),
    addressTown: z.string().max(80).nullable().optional(),
    addressCounty: z.string().max(80).nullable().optional(),
    addressPostcode: z.string().max(16).nullable().optional(),
    fullName: optionalText(120).optional(),
    email: z.string().optional(),
    jobTitle: z.string().optional(),
    employeeNumber: z.string().optional(),
    roleKeys: z.array(z.string()).optional(),
  })
  .strict();

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function firstFieldError(parsed: z.SafeParseError<unknown>): { fieldKey?: string; message: string } {
  const issue = parsed.error.issues[0];
  const fieldKey = issue?.path[0] ? String(issue.path[0]) : undefined;
  return { fieldKey, message: issue?.message ?? "Invalid profile payload" };
}

async function uploadProfilePhoto(input: {
  c: Parameters<typeof storageOf>[0];
  client: Parameters<typeof insertPendingObject>[0];
  orgId: string;
  userId: string;
  targetUserId: string;
  requiredPermission: string | null;
}) {
  const uploaded = await readUploadedFile(input.c);
  const profile = profileForDomain("profile_photo");
  let validated;
  try {
    validated = validateUpload({
      filename: uploaded.filename,
      declaredMime: uploaded.mime,
      bytes: uploaded.bytes,
      profile,
    });
    assertProfilePhotoDimensions({ bytes: uploaded.bytes, kind: validated.kind });
  } catch (error) {
    throw storageErrorToAppError(error);
  }
  const stored = await runUpload(storageOf(input.c), async (track) => {
    const pending = await insertPendingObject(input.client, {
      organisationId: input.orgId,
      domain: "profile_photo",
      ownerRecordId: input.targetUserId,
      storage: storageOf(input.c),
      validated,
      uploadedBy: input.userId,
    });
    track(pending.storageKey);
    await putAndActivateObject(input.client, storageOf(input.c), scannerOf(input.c), {
      organisationId: input.orgId,
      objectId: pending.id,
      storageKey: pending.storageKey,
      bytes: uploaded.bytes,
      contentType: validated.storedContentType,
      filename: validated.originalFilename,
      actorUserId: input.userId,
      domain: "profile_photo",
    });
    const previous = await setProfilePhotoPointer(input.client, {
      actorUserId: input.userId,
      organisationId: input.orgId,
      targetUserId: input.targetUserId,
      storedObjectId: pending.id,
      requiredPermission: input.requiredPermission,
    });
    await retireStoredObject(input.client, storageOf(input.c), input.orgId, previous);
    return pending;
  });
  return stored;
}

async function removeProfilePhoto(input: {
  c: Parameters<typeof storageOf>[0];
  client: Parameters<typeof insertPendingObject>[0];
  orgId: string;
  userId: string;
  targetUserId: string;
  requiredPermission: string | null;
}) {
  const previous = await setProfilePhotoPointer(input.client, {
    actorUserId: input.userId,
    organisationId: input.orgId,
    targetUserId: input.targetUserId,
    storedObjectId: null,
    requiredPermission: input.requiredPermission,
  });
  await retireStoredObject(input.client, storageOf(input.c), input.orgId, previous);
}

export function registerProfileRoutes(app: SchoolappApi) {
  app.get("/me/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const profile = await loadOwnProfile(client, { actor, organisationId: orgId, userId });
      return c.json({ profile });
    }),
  );

  app.patch("/me/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (actor.userKind === "student") {
        throw new AppError(403, "forbidden", "Student profile details are managed by the school");
      }
      const parsed = selfContactSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        const detail = firstFieldError(parsed);
        throw new AppError(400, "validation_failed", detail.message, { fieldKey: detail.fieldKey });
      }
      const forbidden = ["fullName", "email", "jobTitle", "employeeNumber", "roleKeys"] as const;
      for (const key of forbidden) {
        if (parsed.data[key] !== undefined) {
          throw new AppError(403, "forbidden", "This field is managed by the school", { fieldKey: key });
        }
      }
      await applyOwnContactUpdate(client, {
        actor,
        organisationId: orgId,
        userId,
        data: {
          title: emptyToNull(parsed.data.title ?? undefined),
          preferredName: emptyToNull(parsed.data.preferredName ?? undefined),
          phone: emptyToNull(parsed.data.phone ?? undefined),
          addressLine1: emptyToNull(parsed.data.addressLine1 ?? undefined),
          addressLine2: emptyToNull(parsed.data.addressLine2 ?? undefined),
          addressTown: emptyToNull(parsed.data.addressTown ?? undefined),
          addressCounty: emptyToNull(parsed.data.addressCounty ?? undefined),
          addressPostcode: emptyToNull(parsed.data.addressPostcode ?? undefined),
        },
      });
      const profile = await loadOwnProfile(client, { actor, organisationId: orgId, userId });
      return c.json({ profile });
    }),
  );

  app.post("/me/profile/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (actor.userKind === "student") {
        throw new AppError(403, "forbidden", "The official pupil photo is managed by the school");
      }
      await uploadProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: userId,
        requiredPermission: null,
      });
      const profile = await loadOwnProfile(client, { actor, organisationId: orgId, userId });
      return c.json({ profile }, 201);
    }),
  );

  app.delete("/me/profile/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      if (actor.userKind === "student") {
        throw new AppError(403, "forbidden", "The official pupil photo is managed by the school");
      }
      await removeProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: userId,
        requiredPermission: null,
      });
      const profile = await loadOwnProfile(client, { actor, organisationId: orgId, userId });
      return c.json({ profile });
    }),
  );

  app.get("/parent/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const profile = await loadOwnProfile(client, { actor, organisationId: orgId, userId });
      return c.json({ profile });
    }),
  );

  app.patch("/parent/profile", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      const parsed = selfContactSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        const detail = firstFieldError(parsed);
        throw new AppError(400, "validation_failed", detail.message, { fieldKey: detail.fieldKey });
      }
      const relationshipKeys = [
        "relationship",
        "hasParentalResponsibility",
        "isEmergencyContact",
        "portalAccess",
        "priority",
      ];
      const body = parsed.data as Record<string, unknown>;
      for (const key of relationshipKeys) {
        if (body[key] !== undefined) {
          throw new AppError(403, "forbidden", "Guardian relationship details are managed by the school", {
            fieldKey: key,
          });
        }
      }
      if (parsed.data.fullName !== undefined || parsed.data.email !== undefined) {
        throw new AppError(403, "forbidden", "This field is managed by the school");
      }
      await applyOwnContactUpdate(client, {
        actor,
        organisationId: orgId,
        userId,
        data: {
          title: emptyToNull(parsed.data.title ?? undefined),
          preferredName: emptyToNull(parsed.data.preferredName ?? undefined),
          phone: emptyToNull(parsed.data.phone ?? undefined),
          addressLine1: emptyToNull(parsed.data.addressLine1 ?? undefined),
          addressLine2: emptyToNull(parsed.data.addressLine2 ?? undefined),
          addressTown: emptyToNull(parsed.data.addressTown ?? undefined),
          addressCounty: emptyToNull(parsed.data.addressCounty ?? undefined),
          addressPostcode: emptyToNull(parsed.data.addressPostcode ?? undefined),
        },
      });
      return c.json({ profile: await loadOwnProfile(client, { actor, organisationId: orgId, userId }) });
    }),
  );

  app.post("/parent/profile/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      await uploadProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: userId,
        requiredPermission: null,
      });
      return c.json({ profile: await loadOwnProfile(client, { actor, organisationId: orgId, userId }) }, 201);
    }),
  );

  app.delete("/parent/profile/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_READ_OWN_CHILDREN);
      await removeProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: userId,
        requiredPermission: null,
      });
      return c.json({ profile: await loadOwnProfile(client, { actor, organisationId: orgId, userId }) });
    }),
  );

  app.post("/staff/:id/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_MEMBERS_MANAGE);
      const staff = await client.query<{ user_id: string }>(
        "select user_id from staff_profiles where id = $1 and organisation_id = $2",
        [c.req.param("id"), orgId],
      );
      if (!staff.rows[0]) throw new AppError(404, "not_found", "Not found");
      await uploadProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: staff.rows[0].user_id,
        requiredPermission: staffPhotoManagePermission(),
      });
      return c.json({ ok: true }, 201);
    }),
  );

  app.delete("/staff/:id/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.ORG_MEMBERS_MANAGE);
      const staff = await client.query<{ user_id: string }>(
        "select user_id from staff_profiles where id = $1 and organisation_id = $2",
        [c.req.param("id"), orgId],
      );
      if (!staff.rows[0]) throw new AppError(404, "not_found", "Not found");
      await removeProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: staff.rows[0].user_id,
        requiredPermission: staffPhotoManagePermission(),
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/students/:id/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const student = await client.query<{ user_id: string }>(
        "select user_id from student_profiles where id = $1 and organisation_id = $2",
        [c.req.param("id"), orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      await uploadProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: student.rows[0].user_id,
        requiredPermission: studentPhotoManagePermission(),
      });
      return c.json({ ok: true }, 201);
    }),
  );

  app.delete("/students/:id/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.STUDENTS_PROFILES_MANAGE);
      const student = await client.query<{ user_id: string }>(
        "select user_id from student_profiles where id = $1 and organisation_id = $2",
        [c.req.param("id"), orgId],
      );
      if (!student.rows[0]) throw new AppError(404, "not_found", "Not found");
      await removeProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId: student.rows[0].user_id,
        requiredPermission: studentPhotoManagePermission(),
      });
      return c.json({ ok: true });
    }),
  );

  app.get("/guardians/users/:userId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const rows = await client.query(
        `select u.id as user_id, u.title, u.full_name, u.preferred_name, u.email, u.phone,
                u.address_line1, u.address_line2, u.address_town, u.address_county, u.address_postcode,
                m.profile_photo_stored_object_id, m.status as membership_status
         from users u
         join organisation_memberships m
           on m.user_id = u.id and m.organisation_id = $2 and m.ended_at is null
         where u.id = $1`,
        [c.req.param("userId"), orgId],
      );
      if (!rows.rows[0]) throw new AppError(404, "not_found", "Not found");
      const children = await client.query(
        `select g.id, g.student_profile_id, sp.legal_name, g.relationship,
                g.has_parental_responsibility, g.portal_access, g.priority
         from guardianships g
         join student_profiles sp on sp.id = g.student_profile_id
         where g.guardian_user_id = $1 and g.organisation_id = $2
         order by g.priority, sp.legal_name`,
        [c.req.param("userId"), orgId],
      );
      return c.json({
        guardian: {
          ...mapPersonContact(rows.rows[0] as Record<string, unknown>),
          userId: rows.rows[0].user_id,
          membershipStatus: rows.rows[0].membership_status,
        },
        children: children.rows.map((row) => ({
          guardianshipId: row.id,
          studentProfileId: row.student_profile_id,
          legalName: row.legal_name,
          relationship: row.relationship,
          hasParentalResponsibility: row.has_parental_responsibility,
          portalAccess: row.portal_access,
          priority: row.priority,
        })),
      });
    }),
  );

  app.patch("/guardians/users/:userId", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const parsed = selfContactSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        const detail = firstFieldError(parsed);
        throw new AppError(400, "validation_failed", detail.message, { fieldKey: detail.fieldKey });
      }
      if (parsed.data.roleKeys !== undefined) {
        throw new AppError(403, "forbidden", "Guardian relationship details are managed by the school");
      }
      await applyOrgUserContactUpdate(client, {
        actorUserId: userId,
        organisationId: orgId,
        targetUserId: c.req.param("userId"),
        permission: parentPhotoManagePermission(),
        title: emptyToNull(parsed.data.title ?? undefined),
        fullName: emptyToNull(parsed.data.fullName ?? undefined),
        preferredName: emptyToNull(parsed.data.preferredName ?? undefined),
        phone: emptyToNull(parsed.data.phone ?? undefined),
        addressLine1: emptyToNull(parsed.data.addressLine1 ?? undefined),
        addressLine2: emptyToNull(parsed.data.addressLine2 ?? undefined),
        addressTown: emptyToNull(parsed.data.addressTown ?? undefined),
        addressCounty: emptyToNull(parsed.data.addressCounty ?? undefined),
        addressPostcode: emptyToNull(parsed.data.addressPostcode ?? undefined),
      });
      return c.json({ ok: true });
    }),
  );

  app.post("/guardians/users/:userId/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const targetUserId = c.req.param("userId");
      const membership = await client.query(
        `select 1
         from organisation_memberships m
         where m.user_id = $1 and m.organisation_id = $2 and m.ended_at is null`,
        [targetUserId, orgId],
      );
      if (!membership.rows[0]) throw new AppError(404, "not_found", "Not found");
      await uploadProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId,
        requiredPermission: parentPhotoManagePermission(),
      });
      return c.json({ ok: true }, 201);
    }),
  );

  app.delete("/guardians/users/:userId/photo", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      assertPermission(actor, PERMISSIONS.GUARDIANSHIPS_MANAGE);
      const targetUserId = c.req.param("userId");
      const membership = await client.query(
        `select 1
         from organisation_memberships m
         where m.user_id = $1 and m.organisation_id = $2 and m.ended_at is null`,
        [targetUserId, orgId],
      );
      if (!membership.rows[0]) throw new AppError(404, "not_found", "Not found");
      await removeProfilePhoto({
        c,
        client,
        orgId,
        userId,
        targetUserId,
        requiredPermission: parentPhotoManagePermission(),
      });
      return c.json({ ok: true });
    }),
  );
}
