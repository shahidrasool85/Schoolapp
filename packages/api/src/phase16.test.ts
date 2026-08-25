import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withTenantContext } from "@schoolapp/db";
import { createInboxNotification } from "@schoolapp/core";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
    [`p16-${id}`, `Phase16 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, adminEmail: `admin-${id}@example.com` };
}

function jsonHeaders(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    "Content-Type": "application/json",
  };
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof jsonHeaders>) {
  const year = (await (
    await app.request("/api/v1/academic-years", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "2026/27",
        startsOn: "2026-09-01",
        endsOn: "2027-07-31",
        isCurrent: true,
      }),
    })
  ).json()) as { academicYear: { id: string } };
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string }>;
  };
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  const classA = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3A",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  const classB = (await (
    await app.request("/api/v1/classes", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        name: "3B",
        academicYearId: year.academicYear.id,
        yearGroupId: year3.id,
        classType: "form",
      }),
    })
  ).json()) as { class: { id: string } };
  return { yearId: year.academicYear.id, year3Id: year3.id, classAId: classA.class.id, classBId: classB.class.id };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: { legalName: string; academicYearId: string; yearGroupId: string; classId?: string },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string } };
}

async function inviteParent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  studentId: string,
  email: string,
  portalAccess = true,
) {
  const created = await app.request(`/api/v1/students/${studentId}/guardians`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      email,
      fullName: "Pat Parent",
      relationship: "mother",
      portalAccess,
      hasParentalResponsibility: true,
    }),
  });
  const guardian = (await created.json()) as { invitationToken: string | null };
  if (guardian.invitationToken) {
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: guardian.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
    });
  }
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  id: string,
  classId: string,
) {
  const staff = (await (
    await app.request("/api/v1/staff", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        email: `teacher-${id}@example.com`,
        fullName: "Terry Teacher",
        roleKeys: ["school.teacher"],
        jobTitle: "Class teacher",
      }),
    })
  ).json()) as { staffProfileId: string; invitationToken: string };
  await app.request("/api/v1/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: staff.invitationToken,
      fullName: "Terry Teacher",
      password: "teacher-pass-1",
    }),
  });
  const assigned = await app.request(`/api/v1/classes/${classId}/staff`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      staffProfileId: staff.staffProfileId,
      assignmentRole: "form_tutor",
    }),
  });
  const body = (await assigned.json()) as { assignment: { id: string } };
  return {
    email: `teacher-${id}@example.com`,
    staffProfileId: staff.staffProfileId,
    assignmentId: body.assignment.id,
  };
}

describe("Phase 16 messaging foundation", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("creates a parent-teacher conversation, sends, marks read, and keeps messages immutable", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Amelia Message",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `parent-${id}@example.com`);
    const parentToken = await login(app, `parent-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const parentUser = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [`parent-${id}@example.com`],
    );
    const created = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        conversationType: "parent_teacher",
        subject: "Maths homework",
        relatedPupilId: pupil.student.id,
        parentUserIds: [parentUser.rows[0]!.id],
        senderUserId: parentUser.rows[0]!.id,
        body: "Please bring the worksheet tomorrow.",
      }),
    });
    expect(created.status).toBe(201);
    const thread = (await created.json()) as { conversation: { id: string; canReply: boolean } };
    expect(JSON.stringify(thread)).not.toMatch(/safeguard/i);
    const spoofCheck = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/messages`, {
      headers: hdrs,
    });
    const history = (await spoofCheck.json()) as { messages: Array<{ senderUserId: string; body: string }> };
    expect(history.messages[0]?.senderUserId).toBe(school.adminId);
    expect(history.messages[0]?.body).not.toContain("<");

    const parentList = await app.request("/api/v1/parent/messages", { headers: parentHdrs });
    const listed = (await parentList.json()) as { conversations: Array<{ id: string; unreadCount: number }> };
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.unreadCount).toBeGreaterThan(0);

    const reply = await app.request(`/api/v1/parent/messages/${thread.conversation.id}/messages`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ body: "<script>alert(1)</script>Thank you." }),
    });
    expect(reply.status).toBe(201);
    const sent = (await reply.json()) as { message: { body: string } };
    expect(sent.message.body).toBe("alert(1)Thank you.");

    await app.request(`/api/v1/parent/messages/${thread.conversation.id}/read`, {
      method: "POST",
      headers: parentHdrs,
      body: "{}",
    });
    const afterRead = (await (
      await app.request("/api/v1/parent/messages", { headers: parentHdrs })
    ).json()) as { conversations: Array<{ unreadCount: number }> };
    expect(afterRead.conversations[0]?.unreadCount).toBe(0);

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      await expect(
        client.query("update messages set body = 'edited' where conversation_id = $1", [thread.conversation.id]),
      ).rejects.toThrow(/message_immutable/);
    });
  });

  it("blocks teacher initiation for unassigned pupils and keeps history after class move", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const assignedPupil = await createStudent(app, hdrs, {
      legalName: "Assigned Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const otherPupil = await createStudent(app, hdrs, {
      legalName: "Other Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    await inviteParent(app, hdrs, assignedPupil.student.id, `p-a-${id}@example.com`);
    await inviteParent(app, hdrs, otherPupil.student.id, `p-b-${id}@example.com`);
    const teacher = await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const assignedParent = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [`p-a-${id}@example.com`],
    );
    const otherParent = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [`p-b-${id}@example.com`],
    );

    const blocked = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        conversationType: "parent_teacher",
        subject: "Should fail",
        relatedPupilId: otherPupil.student.id,
        parentUserIds: [otherParent.rows[0]!.id],
        body: "Hello",
      }),
    });
    expect(blocked.status).toBe(404);

    const recipients = await app.request(`/api/v1/messages/pupils/${otherPupil.student.id}/recipients`, {
      headers: teacherHdrs,
    });
    expect(recipients.status).toBe(404);

    const created = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        conversationType: "parent_teacher",
        subject: "Reading",
        relatedPupilId: assignedPupil.student.id,
        parentUserIds: [assignedParent.rows[0]!.id],
        body: "Please read chapter 2.",
      }),
    });
    expect(created.status).toBe(201);
    const thread = (await created.json()) as { conversation: { id: string } };

    await app.request(`/api/v1/class-staff-assignments/${teacher.assignmentId}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ endedOn: "2026-08-01" }),
    });

    const stillVisible = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}`, {
      headers: teacherHdrs,
    });
    expect(stillVisible.status).toBe(200);

    const newThread = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: teacherHdrs,
      body: JSON.stringify({
        conversationType: "parent_teacher",
        subject: "After move",
        relatedPupilId: assignedPupil.student.id,
        parentUserIds: [assignedParent.rows[0]!.id],
        body: "Should not start",
      }),
    });
    expect(newThread.status).toBe(404);

    const otherTeacher = await inviteTeacher(app, hdrs, `${id}b`, seeded.classBId);
    const otherToken = await login(app, otherTeacher.email, "teacher-pass-1");
    const otherHdrs = jsonHeaders(otherToken, school.orgId);
    const peek = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}`, {
      headers: otherHdrs,
    });
    expect(peek.status).toBe(404);
  });

  it("closes threads, blocks parent replies, and redacts without deleting history", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Closed Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `closed-${id}@example.com`);
    const parentToken = await login(app, `closed-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    const parentUser = await pools.owner.query<{ id: string }>(
      "select id from users where email = $1",
      [`closed-${id}@example.com`],
    );
    const created = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        conversationType: "parent_school",
        subject: "Office",
        relatedPupilId: pupil.student.id,
        parentUserIds: [parentUser.rows[0]!.id],
        body: "Please collect the form.",
      }),
    });
    const thread = (await created.json()) as { conversation: { id: string } };
    const closed = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/close`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(closed.status).toBe(200);
    const reply = await app.request(`/api/v1/parent/messages/${thread.conversation.id}/messages`, {
      method: "POST",
      headers: parentHdrs,
      body: JSON.stringify({ body: "Still trying to reply" }),
    });
    expect(reply.status).toBe(409);
    const teacher = await inviteTeacher(app, hdrs, id, seeded.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const teacherHdrs = jsonHeaders(teacherToken, school.orgId);
    const history = (await (
      await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/messages`, { headers: hdrs })
    ).json()) as { messages: Array<{ id: string; body: string }> };
    const userMessage = history.messages.find((row) => row.body.includes("collect the form"))!;
    const teacherRedact = await app.request(
      `/api/v1/messages/conversations/${thread.conversation.id}/messages/${userMessage.id}/redact`,
      { method: "POST", headers: teacherHdrs, body: "{}" },
    );
    expect(teacherRedact.status).toBe(404);
    const teacherList = (await (
      await app.request("/api/v1/messages/conversations", { headers: teacherHdrs })
    ).json()) as { conversations: Array<{ id: string }> };
    expect(teacherList.conversations.some((row) => row.id === thread.conversation.id)).toBe(false);
    const redacted = await app.request(
      `/api/v1/messages/conversations/${thread.conversation.id}/messages/${userMessage.id}/redact`,
      { method: "POST", headers: hdrs, body: "{}" },
    );
    expect(redacted.status).toBe(200);
    const after = (await (
      await app.request(`/api/v1/parent/messages/${thread.conversation.id}/messages`, { headers: parentHdrs })
    ).json()) as { messages: Array<{ body: string; redacted: boolean }> };
    expect(after.messages.some((row) => row.redacted && row.body === "Message removed by authorised staff")).toBe(true);
    const reopened = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/reopen`, {
      method: "POST",
      headers: hdrs,
      body: "{}",
    });
    expect(reopened.status).toBe(200);
  });

  it("enforces portal_access, guardianship, parent initiation targets, and IDOR 404s", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const childA = await createStudent(app, hdrs, {
      legalName: "Child A",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const childB = await createStudent(app, hdrs, {
      legalName: "Child B",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classBId,
    });
    await inviteParent(app, hdrs, childA.student.id, `ga-${id}@example.com`);
    await inviteParent(app, hdrs, childB.student.id, `gb-${id}@example.com`);
    await inviteTeacher(app, hdrs, id, seeded.classAId);
    const parentAToken = await login(app, `ga-${id}@example.com`, "parent-pass-1");
    const parentBToken = await login(app, `gb-${id}@example.com`, "parent-pass-1");
    const parentAHdrs = jsonHeaders(parentAToken, school.orgId);
    const parentBHdrs = jsonHeaders(parentBToken, school.orgId);
    const parentA = await pools.owner.query<{ id: string }>("select id from users where email = $1", [
      `ga-${id}@example.com`,
    ]);
    const created = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        conversationType: "parent_teacher",
        subject: "Child A only",
        relatedPupilId: childA.student.id,
        parentUserIds: [parentA.rows[0]!.id],
        body: "Hello",
      }),
    });
    const thread = (await created.json()) as { conversation: { id: string } };
    const idor = await app.request(`/api/v1/parent/messages/${thread.conversation.id}`, { headers: parentBHdrs });
    expect(idor.status).toBe(404);

    const contacts = await app.request(
      `/api/v1/parent/messages/contacts?studentId=${childA.student.id}`,
      { headers: parentAHdrs },
    );
    expect(contacts.status).toBe(200);
    const contactBody = (await contacts.json()) as {
      contacts: Array<{ contactPoint: string; teachers: Array<{ userId: string }> }>;
    };
    const teacherId = contactBody.contacts.find((row) => row.contactPoint === "class_teacher")?.teachers[0]?.userId;
    const foreignStaff = await app.request("/api/v1/parent/messages", {
      method: "POST",
      headers: parentAHdrs,
      body: JSON.stringify({
        studentId: childA.student.id,
        contactPoint: "class_teacher",
        teacherUserId: school.adminId,
        subject: "No",
        body: "Should fail",
      }),
    });
    expect(foreignStaff.status).toBe(400);
    const started = await app.request("/api/v1/parent/messages", {
      method: "POST",
      headers: parentAHdrs,
      body: JSON.stringify({
        studentId: childA.student.id,
        contactPoint: "class_teacher",
        teacherUserId: teacherId,
        subject: "Reading book",
        body: "Please confirm the book is due Friday.",
      }),
    });
    expect(started.status).toBe(201);

    await pools.owner.query("update guardianships set portal_access = false where student_profile_id = $1", [
      childA.student.id,
    ]);
    const revoked = await app.request("/api/v1/parent/messages", { headers: parentAHdrs });
    const revokedBody = (await revoked.json()) as { conversations: unknown[] };
    expect(revokedBody.conversations).toEqual([]);
    const revokedDetail = await app.request(`/api/v1/parent/messages/${thread.conversation.id}`, {
      headers: parentAHdrs,
    });
    expect(revokedDetail.status).toBe(404);
  });

  it("isolates tenants, attachments, rate limits, length, notifications, and inactive membership", async () => {
    const id = suffix();
    const school = await createSchool(pools.owner, id);
    const other = await createSchool(pools.owner, `${id}oak`);
    const token = await login(app, school.adminEmail, "password-12x");
    const otherToken = await login(app, other.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const otherHdrs = jsonHeaders(otherToken, other.orgId);
    const seeded = await seedYear(app, hdrs);
    const pupil = await createStudent(app, hdrs, {
      legalName: "Iso Child",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    await inviteParent(app, hdrs, pupil.student.id, `iso-${id}@example.com`);
    const parentUser = await pools.owner.query<{ id: string }>("select id from users where email = $1", [
      `iso-${id}@example.com`,
    ]);
    const created = await app.request("/api/v1/messages/conversations", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        conversationType: "parent_school",
        subject: "Isolation",
        relatedPupilId: pupil.student.id,
        parentUserIds: [parentUser.rows[0]!.id],
        body: "Greenwood only",
      }),
    });
    const thread = (await created.json()) as { conversation: { id: string } };
    const cross = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}`, {
      headers: otherHdrs,
    });
    expect(cross.status).toBe(404);

    const long = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/messages`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ body: "x".repeat(8001) }),
    });
    expect(long.status).toBe(400);

    const sent = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}/messages`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ body: "Please see the attached letter." }),
    });
    const message = (await sent.json()) as { message: { id: string } };
    const form = new FormData();
    form.append("file", new Blob([PDF], { type: "application/pdf" }), "letter.pdf");
    const uploaded = await app.request(
      `/api/v1/messages/conversations/${thread.conversation.id}/messages/${message.message.id}/attachments`,
      { method: "POST", headers: { Authorization: hdrs.Authorization, "X-Organisation-Id": school.orgId }, body: form },
    );
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()) as { attachment: { storedObjectId: string; downloadPath: string } };
    const stolen = await app.request(attachment.attachment.downloadPath, { headers: otherHdrs });
    expect(stolen.status).toBe(404);

    const notes = await pools.owner.query<{ n: string }>(
      `select count(*)::text as n from notifications
       where organisation_id = $1 and type = 'message_received' and recipient_user_id = $2`,
      [school.orgId, parentUser.rows[0]!.id],
    );
    expect(Number(notes.rows[0]?.n)).toBeGreaterThan(0);
    const sample = await pools.owner.query<{ body: string }>(
      `select body from notifications
       where organisation_id = $1 and type = 'message_received' and recipient_user_id = $2
       limit 1`,
      [school.orgId, parentUser.rows[0]!.id],
    );
    expect(sample.rows[0]?.body).not.toContain("Greenwood only");
    expect(sample.rows[0]?.body).not.toContain("Please see the attached");

    await withTenantContext(pools.app, school.adminId, school.orgId, async (client) => {
      const before = await client.query<{ n: string }>(
        `select count(*)::text as n from notifications
         where organisation_id = $1 and type = 'message_received' and recipient_user_id = $2
           and idempotency_key = $3`,
        [school.orgId, parentUser.rows[0]!.id, `message:received:${message.message.id}:${parentUser.rows[0]!.id}`],
      );
      expect(Number(before.rows[0]?.n)).toBe(1);
      await createInboxNotification(client, {
        organisationId: school.orgId,
        recipientUserId: parentUser.rows[0]!.id,
        actorUserId: school.adminId,
        title: "New message",
        body: "You have a new message from Greenwood Academy.",
        type: "message_received",
        category: "messaging",
        idempotencyKey: `message:received:${message.message.id}:${parentUser.rows[0]!.id}`,
      });
      const after = await client.query<{ n: string }>(
        `select count(*)::text as n from notifications
         where organisation_id = $1 and type = 'message_received' and recipient_user_id = $2
           and idempotency_key = $3`,
        [school.orgId, parentUser.rows[0]!.id, `message:received:${message.message.id}:${parentUser.rows[0]!.id}`],
      );
      expect(Number(after.rows[0]?.n)).toBe(1);
    });

    const parentToken = await login(app, `iso-${id}@example.com`, "parent-pass-1");
    const parentHdrs = jsonHeaders(parentToken, school.orgId);
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const res = await app.request(`/api/v1/parent/messages/${thread.conversation.id}/messages`, {
        method: "POST",
        headers: parentHdrs,
        body: JSON.stringify({ body: `Ping ${i}` }),
      });
      if (res.status === 429) {
        limited = res.status;
        break;
      }
    }
    expect(limited).toBe(429);

    await pools.owner.query(
      "update organisation_memberships set status = 'inactive' where user_id = $1 and organisation_id = $2",
      [school.adminId, school.orgId],
    );
    const inactive = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}`, { headers: hdrs });
    expect([401, 403]).toContain(inactive.status);

    const platformId = suffix();
    await insertUser(pools.owner, {
      email: `platform-${platformId}@example.com`,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const platformToken = await login(app, `platform-${platformId}@example.com`, "password-12x");
    const platformPeek = await app.request(`/api/v1/messages/conversations/${thread.conversation.id}`, {
      headers: jsonHeaders(platformToken, school.orgId),
    });
    expect([403, 404]).toContain(platformPeek.status);
  });
});
