import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools } from "@schoolapp/db";
import { sha256Hex } from "@schoolapp/storage";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  loginAlias,
  testApp,
  testObjectStorage,
  testPools,
} from "./test-helpers";
import { cleanupStoredObjects } from "./stored-object-cleanup";

const suffix = () => randomUUID().slice(0, 8);
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<>\n%%EOF\n");

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string, prefix = "p13") {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug",
    [`${prefix}-${id}`, `Phase13 ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id) values ($1)", [org.rows[0]!.id]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    adminEmail: `admin-${id}@example.com`,
  };
}

function headers(token: string, orgId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    ...extra,
  };
}

function jsonHeaders(token: string, orgId: string) {
  return { ...headers(token, orgId), "Content-Type": "application/json" };
}

function schoolHeaders(slug: string, extra: Record<string, string> = {}) {
  return { Host: `${slug}.localhost`, ...extra };
}

function pdfForm(fields: Record<string, string>, filename = "report.pdf") {
  const form = new FormData();
  form.append("file", new Blob([PDF], { type: "application/pdf" }), filename);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
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
  await app.request(`/api/v1/year-groups/${year3.id}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ studentLoginEnabled: true }),
  });
  const subject = (await (
    await app.request("/api/v1/subjects", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ key: `maths-${suffix()}`, name: "Mathematics" }),
    })
  ).json()) as { subject: { id: string } };
  return {
    yearId: year.academicYear.id,
    year3Id: year3.id,
    classAId: classA.class.id,
    subjectId: subject.subject.id,
  };
}

async function createStudent(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  input: {
    legalName: string;
    academicYearId: string;
    yearGroupId: string;
    classId?: string;
    loginAlias?: string;
    password?: string;
  },
) {
  const created = await app.request("/api/v1/students", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { student: { id: string } };
}

async function inviteTeacher(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof jsonHeaders>,
  id: string,
  classId?: string,
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
  if (classId) {
    await app.request(`/api/v1/classes/${classId}/staff`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        staffProfileId: staff.staffProfileId,
        assignmentRole: "form_tutor",
      }),
    });
  }
  return { email: `teacher-${id}@example.com` };
}

describe("Phase 13 object storage and documents", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("reports storage health without secrets", async () => {
    const res = await app.request("/api/v1/health/storage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; driver: string; writable: boolean };
    expect(body.configured).toBe(true);
    expect(body.driver).toBe("filesystem");
    expect(body.writable).toBe(true);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("secret");
  });

  it("uploads a public Greenwood application document that only authorised staff can download", async () => {
    const gw = await createSchool(pools.owner, suffix(), "gw");
    const oak = await createSchool(pools.owner, suffix(), "oak");
    const gwToken = await login(app, gw.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const gwH = jsonHeaders(gwToken, gw.orgId);
    const oakH = jsonHeaders(oakToken, oak.orgId);
    const structure = await seedYear(app, gwH);

    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({ formType: "application", name: "Apply", slug: "year-3-application" }),
    });
    expect(created.status).toBe(201);
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/definition`, {
      method: "PUT",
      headers: gwH,
      body: JSON.stringify({
        sections: [
          {
            sectionKey: "child",
            title: "Child",
            fields: [
              { fieldKind: "canonical", canonicalKey: "child.legal_name", questionType: "short_text", label: "Name", required: true },
              { fieldKind: "canonical", canonicalKey: "child.date_of_birth", questionType: "date", label: "DOB", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_academic_year_id", questionType: "single_choice", label: "Year", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_year_group_id", questionType: "single_choice", label: "Group", required: true },
            ],
          },
          {
            sectionKey: "guardians",
            title: "Guardians",
            fields: [{ fieldKind: "canonical", canonicalKey: "guardians", questionType: "guardian_group", label: "Guardians", required: true }],
          },
          {
            sectionKey: "evidence",
            title: "Evidence",
            fields: [
              {
                fieldKind: "custom",
                fieldKey: "supporting_evidence",
                questionType: "file",
                label: "Supporting document",
                required: true,
              },
            ],
          },
        ],
      }),
    });
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: gwH });

    const answers = {
      "child.legal_name": "Greenwood Applicant",
      "child.date_of_birth": "2017-01-01",
      "child.intended_academic_year_id": structure.yearId,
      "child.intended_year_group_id": structure.year3Id,
      guardians: [{ fullName: "Greenwood Parent", email: "g.parent@example.com", primaryContact: true }],
    };
    const draft = await app.request("/api/v1/public/admissions/forms/application/year-3-application/submissions", {
      method: "POST",
      headers: { ...schoolHeaders(gw.slug), "Content-Type": "application/json" },
      body: JSON.stringify({ draft: true, answers }),
    });
    expect(draft.status).toBe(200);
    const draftBody = (await draft.json()) as { submission: { continuationToken: string; publicId: string } };

    const invalid = await app.request("/api/v1/public/admissions/forms/application/year-3-application/documents", {
      method: "POST",
      headers: schoolHeaders(gw.slug),
      body: pdfForm({
        fieldKey: "supporting_evidence",
        continuationToken: "not-a-valid-token",
        publicId: draftBody.submission.publicId,
      }),
    });
    expect(invalid.status).toBeGreaterThanOrEqual(400);

    const exe = new FormData();
    exe.append("file", new Blob([Buffer.from("MZ")], { type: "application/x-msdownload" }), "payload.exe");
    exe.append("fieldKey", "supporting_evidence");
    exe.append("continuationToken", draftBody.submission.continuationToken);
    exe.append("publicId", draftBody.submission.publicId);
    const blocked = await app.request("/api/v1/public/admissions/forms/application/year-3-application/documents", {
      method: "POST",
      headers: schoolHeaders(gw.slug),
      body: exe,
    });
    expect(blocked.status).toBe(400);
    const blockedBody = (await blocked.json()) as { error?: { message?: string; code?: string } };
    expect(JSON.stringify(blockedBody).toLowerCase()).not.toContain("s3");
    expect(blockedBody.error?.message ?? "").not.toMatch(/bucket|stack|access key/i);

    const huge = Buffer.concat([Buffer.from("%PDF-1.1\n"), Buffer.alloc(8 * 1024 * 1024 + 64, 65)]);
    const oversizedForm = new FormData();
    oversizedForm.append("file", new Blob([huge], { type: "application/pdf" }), "huge.pdf");
    oversizedForm.append("fieldKey", "supporting_evidence");
    oversizedForm.append("continuationToken", draftBody.submission.continuationToken);
    oversizedForm.append("publicId", draftBody.submission.publicId);
    const oversized = await app.request("/api/v1/public/admissions/forms/application/year-3-application/documents", {
      method: "POST",
      headers: schoolHeaders(gw.slug),
      body: oversizedForm,
    });
    expect(oversized.status).toBe(400);

    const uploaded = await app.request("/api/v1/public/admissions/forms/application/year-3-application/documents", {
      method: "POST",
      headers: schoolHeaders(gw.slug),
      body: pdfForm({
        fieldKey: "supporting_evidence",
        continuationToken: draftBody.submission.continuationToken,
        publicId: draftBody.submission.publicId,
      }),
    });
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as { document: { id: string; filename: string } };
    expect(uploadedBody.document.filename).toBe("report.pdf");
    expect(JSON.stringify(uploadedBody)).not.toContain("storageKey");

    const finalise = await app.request("/api/v1/public/admissions/forms/application/year-3-application/submissions", {
      method: "POST",
      headers: { ...schoolHeaders(gw.slug), "Content-Type": "application/json" },
      body: JSON.stringify({
        continuationToken: draftBody.submission.continuationToken,
        publicId: draftBody.submission.publicId,
        answers: {
          ...answers,
          supporting_evidence: {
            documentId: uploadedBody.document.id,
            filename: "report.pdf",
            contentType: "application/pdf",
            byteSize: PDF.byteLength,
          },
        },
      }),
    });
    expect(finalise.status).toBe(201);

    const listed = (await (await app.request("/api/v1/admissions/applications", { headers: gwH })).json()) as {
      applications: Array<{ id: string; pupilLegalName: string }>;
    };
    const application = listed.applications.find((row) => row.pupilLegalName === "Greenwood Applicant");
    expect(application).toBeTruthy();
    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${application!.id}`, { headers: gwH })
    ).json()) as {
      documents: Array<{ filename: string; downloadPath: string | null; status: string | null }>;
    };
    expect(detail.documents[0]?.filename).toBe("report.pdf");
    expect(detail.documents[0]?.downloadPath).toMatch(/^\/api\/v1\/files\//);
    expect(JSON.stringify(detail)).not.toContain("org/");

    const download = await app.request(detail.documents[0]!.downloadPath!, { headers: headers(gwToken, gw.orgId) });
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toMatch(/private/);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(sha256Hex(bytes)).toBe(sha256Hex(PDF));

    const oakDownload = await app.request(detail.documents[0]!.downloadPath!, { headers: headers(oakToken, oak.orgId) });
    expect(oakDownload.status).toBe(404);

    const anon = await app.request(detail.documents[0]!.downloadPath!);
    expect(anon.status).toBe(401);

    await pools.owner.query(
      `update admissions_form_submissions set draft_expires_at = now() - interval '1 hour'
       where public_id = $1`,
      [draftBody.submission.publicId],
    );
  });

  it("rejects uploads for expired public drafts", async () => {
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const created = await app.request("/api/v1/admissions/forms", {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ formType: "application", name: "Expire", slug: "expire-apply" }),
    });
    const form = (await created.json()) as { form: { id: string } };
    await app.request(`/api/v1/admissions/forms/${form.form.id}/definition`, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify({
        sections: [
          {
            sectionKey: "child",
            title: "Child",
            fields: [
              { fieldKind: "canonical", canonicalKey: "child.legal_name", questionType: "short_text", label: "Name", required: true },
              { fieldKind: "canonical", canonicalKey: "child.date_of_birth", questionType: "date", label: "DOB", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_academic_year_id", questionType: "single_choice", label: "Year", required: true },
              { fieldKind: "canonical", canonicalKey: "child.intended_year_group_id", questionType: "single_choice", label: "Group", required: true },
            ],
          },
          {
            sectionKey: "guardians",
            title: "Guardians",
            fields: [{ fieldKind: "canonical", canonicalKey: "guardians", questionType: "guardian_group", label: "Guardians", required: true }],
          },
          {
            sectionKey: "evidence",
            title: "Evidence",
            fields: [{ fieldKind: "custom", fieldKey: "supporting_evidence", questionType: "file", label: "Evidence" }],
          },
        ],
      }),
    });
    await app.request(`/api/v1/admissions/forms/${form.form.id}/publish`, { method: "POST", headers: hdrs });
    const draft = await app.request("/api/v1/public/admissions/forms/application/expire-apply/submissions", {
      method: "POST",
      headers: { ...schoolHeaders(school.slug), "Content-Type": "application/json" },
      body: JSON.stringify({
        draft: true,
        answers: {
          "child.legal_name": "Expired Child",
          "child.date_of_birth": "2017-01-01",
          "child.intended_academic_year_id": structure.yearId,
          "child.intended_year_group_id": structure.year3Id,
          guardians: [{ fullName: "Parent", email: "e.parent@example.com", primaryContact: true }],
        },
      }),
    });
    const draftBody = (await draft.json()) as { submission: { continuationToken: string; publicId: string } };
    await pools.owner.query(
      `update admissions_form_submissions set draft_expires_at = now() - interval '1 hour' where public_id = $1`,
      [draftBody.submission.publicId],
    );
    const expired = await app.request("/api/v1/public/admissions/forms/application/expire-apply/documents", {
      method: "POST",
      headers: schoolHeaders(school.slug),
      body: pdfForm({
        fieldKey: "supporting_evidence",
        continuationToken: draftBody.submission.continuationToken,
        publicId: draftBody.submission.publicId,
      }),
    });
    expect(expired.status).toBeGreaterThanOrEqual(400);
  });

  it("lets teachers attach resources and students submit files, without parent submit or cross-tenant access", async () => {
    const gw = await createSchool(pools.owner, suffix(), "lms");
    const oak = await createSchool(pools.owner, suffix(), "lmso");
    const gwToken = await login(app, gw.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const gwH = jsonHeaders(gwToken, gw.orgId);
    const oakH = jsonHeaders(oakToken, oak.orgId);
    const seeded = await seedYear(app, gwH);
    await seedYear(app, oakH);
    const alias = `sam.${suffix()}`;
    const parentEmail = `parent-${suffix()}@example.com`;
    const pupil = await createStudent(app, gwH, {
      legalName: "Sam Student",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: alias,
      password: "student-pass-1",
    });
    const parentInvite = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: gwH,
        body: JSON.stringify({
          email: parentEmail,
          fullName: "Pat Parent",
          relationship: "mother",
        }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: parentInvite.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
    });
    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const studentToken = await loginAlias(app, gw.slug, alias, "student-pass-1");

    const created = await app.request("/api/v1/learning/assignments", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        title: "Worksheet",
        description: "Complete the PDF",
        workTypeKey: "homework",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ targetType: "class", classId: seeded.classAId }],
      }),
    });
    expect(created.status).toBe(201);
    const assignment = (await created.json()) as { assignment: { id: string } };
    const resource = await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/resources`, {
      method: "POST",
      headers: headers(gwToken, gw.orgId),
      body: pdfForm({ title: "Worksheet PDF", resourceKind: "pdf" }, "worksheet.pdf"),
    });
    expect(resource.status).toBe(201);
    await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/publish`, {
      method: "POST",
      headers: gwH,
      body: "{}",
    });

    const studentView = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}`, {
      headers: headers(studentToken, gw.orgId),
    });
    expect(studentView.status).toBe(200);
    const studentBody = (await studentView.json()) as {
      assignment: { resources: Array<{ downloadPath: string | null }> };
    };
    expect(studentBody.assignment.resources[0]?.downloadPath).toMatch(/^\/api\/v1\/files\//);
    const resourceDownload = await app.request(studentBody.assignment.resources[0]!.downloadPath!, {
      headers: headers(studentToken, gw.orgId),
    });
    expect(resourceDownload.status).toBe(200);

    const attached = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}/attachments`, {
      method: "POST",
      headers: headers(studentToken, gw.orgId),
      body: pdfForm({}, "homework.pdf"),
    });
    expect(attached.status).toBe(201);
    const submit = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}/submissions`, {
      method: "POST",
      headers: jsonHeaders(studentToken, gw.orgId),
      body: JSON.stringify({ textResponse: "Done", submit: true }),
    });
    expect([200, 201]).toContain(submit.status);

    const submissions = (await (
      await app.request(`/api/v1/learning/assignments/${assignment.assignment.id}/submissions`, { headers: gwH })
    ).json()) as { submissions: Array<{ submissionId: string | null }> };
    const submissionId = submissions.submissions.find((row) => row.submissionId)?.submissionId;
    expect(submissionId).toBeTruthy();
    const marked = (await (
      await app.request(`/api/v1/learning/submissions/${submissionId}`, { headers: gwH })
    ).json()) as {
      submission: { revisions: Array<{ attachments: Array<{ downloadPath: string | null; filename: string }> }> };
    };
    const teacherFile = marked.submission.revisions.flatMap((rev) => rev.attachments).find((file) => file.downloadPath);
    expect(teacherFile?.filename).toBe("homework.pdf");
    const teacherDownload = await app.request(teacherFile!.downloadPath!, { headers: headers(gwToken, gw.orgId) });
    expect(teacherDownload.status).toBe(200);

    const parentSubmit = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}/submissions`, {
      method: "POST",
      headers: jsonHeaders(parentToken, gw.orgId),
      body: JSON.stringify({ textResponse: "Nope", submit: true }),
    });
    expect(parentSubmit.status).toBeGreaterThanOrEqual(400);
    const parentAttach = await app.request(`/api/v1/student/assignments/${assignment.assignment.id}/attachments`, {
      method: "POST",
      headers: headers(parentToken, gw.orgId),
      body: pdfForm({}, "parent.pdf"),
    });
    expect(parentAttach.status).toBeGreaterThanOrEqual(400);

    const oakDownload = await app.request(teacherFile!.downloadPath!, { headers: headers(oakToken, oak.orgId) });
    expect(oakDownload.status).toBe(404);
  });

  it("enforces pupil document visibility for staff, parents, and students", async () => {
    const school = await createSchool(pools.owner, suffix(), "doc");
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = jsonHeaders(token, school.orgId);
    const seeded = await seedYear(app, hdrs);
    const teacher = await inviteTeacher(app, hdrs, suffix());
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const alias = `pupil.${suffix()}`;
    const parentEmail = `doc-parent-${suffix()}@example.com`;
    const otherParentEmail = `other-parent-${suffix()}@example.com`;
    const pupil = await createStudent(app, hdrs, {
      legalName: "Doc Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: alias,
      password: "student-pass-1",
    });
    const other = await createStudent(app, hdrs, {
      legalName: "Other Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
    });
    const parentInvite = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ email: parentEmail, fullName: "Doc Parent", relationship: "mother" }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: parentInvite.invitationToken, fullName: "Doc Parent", password: "parent-pass-1" }),
    });
    const otherInvite = (await (
      await app.request(`/api/v1/students/${other.student.id}/guardians`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ email: otherParentEmail, fullName: "Other Parent", relationship: "father" }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: otherInvite.invitationToken, fullName: "Other Parent", password: "parent-pass-1" }),
    });
    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const otherParentToken = await login(app, otherParentEmail, "parent-pass-1");
    const studentToken = await loginAlias(app, school.slug, alias, "student-pass-1");

    async function uploadDoc(visibility: string, title: string) {
      const form = pdfForm({ title, documentType: "letter", visibility }, `${title}.pdf`);
      const res = await app.request(`/api/v1/students/${pupil.student.id}/documents`, {
        method: "POST",
        headers: headers(token, school.orgId),
        body: form,
      });
      expect(res.status).toBe(201);
      return (await res.json()) as { document: { id: string; downloadPath: string | null } };
    }
    const staffOnly = await uploadDoc("staff", "internal");
    const parentVisible = await uploadDoc("staff_and_parents", "welcome");
    const studentVisible = await uploadDoc("staff_parents_and_student", "self");
    expect(staffOnly.document.downloadPath).toBeTruthy();

    const adminDl = await app.request(staffOnly.document.downloadPath!, { headers: headers(token, school.orgId) });
    expect(adminDl.status).toBe(200);
    const teacherDl = await app.request(staffOnly.document.downloadPath!, {
      headers: headers(teacherToken, school.orgId),
    });
    expect(teacherDl.status).toBe(404);

    const parentList = (await (
      await app.request(`/api/v1/parent/children/${pupil.student.id}/documents`, {
        headers: headers(parentToken, school.orgId),
      })
    ).json()) as { documents: Array<{ title: string; downloadPath: string | null }> };
    expect(parentList.documents.map((row) => row.title).sort()).toEqual(["self", "welcome"]);
    const parentStaff = await app.request(staffOnly.document.downloadPath!, {
      headers: headers(parentToken, school.orgId),
    });
    expect(parentStaff.status).toBe(404);
    const parentOk = await app.request(parentVisible.document.downloadPath!, {
      headers: headers(parentToken, school.orgId),
    });
    expect(parentOk.status).toBe(200);

    const studentList = (await (
      await app.request("/api/v1/student/documents", { headers: headers(studentToken, school.orgId) })
    ).json()) as { documents: Array<{ title: string }> };
    expect(studentList.documents.map((row) => row.title)).toEqual(["self"]);
    const studentStaff = await app.request(parentVisible.document.downloadPath!, {
      headers: headers(studentToken, school.orgId),
    });
    expect(studentStaff.status).toBe(404);
    const studentOk = await app.request(studentVisible.document.downloadPath!, {
      headers: headers(studentToken, school.orgId),
    });
    expect(studentOk.status).toBe(200);

    const otherList = await app.request(`/api/v1/parent/children/${pupil.student.id}/documents`, {
      headers: headers(otherParentToken, school.orgId),
    });
    expect(otherList.status).toBe(404);
    const otherDl = await app.request(parentVisible.document.downloadPath!, {
      headers: headers(otherParentToken, school.orgId),
    });
    expect(otherDl.status).toBe(404);
  });

  it("keeps safeguarding files private from teachers, parents, students, platform admins, and other tenants", async () => {
    const gw = await createSchool(pools.owner, suffix(), "sg");
    const oak = await createSchool(pools.owner, suffix(), "sgo");
    const gwToken = await login(app, gw.adminEmail, "password-12x");
    const oakToken = await login(app, oak.adminEmail, "password-12x");
    const gwH = jsonHeaders(gwToken, gw.orgId);
    const oakH = jsonHeaders(oakToken, oak.orgId);
    const seeded = await seedYear(app, gwH);
    const oakSeeded = await seedYear(app, oakH);
    const teacher = await inviteTeacher(app, gwH, suffix(), seeded.classAId);
    const teacherToken = await login(app, teacher.email, "teacher-pass-1");
    const alias = `sg.${suffix()}`;
    const parentEmail = `sg-parent-${suffix()}@example.com`;
    const pupil = await createStudent(app, gwH, {
      legalName: "Assigned Pupil",
      academicYearId: seeded.yearId,
      yearGroupId: seeded.year3Id,
      classId: seeded.classAId,
      loginAlias: alias,
      password: "student-pass-1",
    });
    await createStudent(app, oakH, {
      legalName: "Oak Pupil",
      academicYearId: oakSeeded.yearId,
      yearGroupId: oakSeeded.year3Id,
      classId: oakSeeded.classAId,
    });
    const parentInvite = (await (
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: gwH,
        body: JSON.stringify({ email: parentEmail, fullName: "Pat Parent", relationship: "mother" }),
      })
    ).json()) as { invitationToken: string };
    await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: parentInvite.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
    });
    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const studentToken = await loginAlias(app, gw.slug, alias, "student-pass-1");
    const platformEmail = `platform-${suffix()}@example.com`;
    await insertUser(pools.owner, {
      email: platformEmail,
      password: "password-12x",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const platformToken = await login(app, platformEmail, "password-12x");

    const categories = (await (await app.request("/api/v1/safeguarding/categories", { headers: gwH })).json()) as {
      categories: Array<{ id: string; key: string }>;
    };
    const categoryId = categories.categories.find((row) => row.key === "general_concern")!.id;
    const concern = await app.request("/api/v1/safeguarding/concerns", {
      method: "POST",
      headers: gwH,
      body: JSON.stringify({
        studentProfileId: pupil.student.id,
        aroseAt: "2026-09-17T15:00:00Z",
        categoryId,
        factualDescription: "Neutral factual note for DSL review.",
      }),
    });
    expect(concern.status).toBe(201);
    const sg = (await concern.json()) as { concern: { id: string } };
    const uploaded = await app.request(`/api/v1/safeguarding/concerns/${sg.concern.id}/attachments`, {
      method: "POST",
      headers: headers(gwToken, gw.orgId),
      body: pdfForm({ title: "Evidence" }, "evidence.pdf"),
    });
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as { attachment: { downloadPath: string } };
    expect(uploadedBody.attachment.downloadPath).toMatch(/^\/api\/v1\/files\//);

    const dsl = await app.request(uploadedBody.attachment.downloadPath, { headers: headers(gwToken, gw.orgId) });
    expect(dsl.status).toBe(200);
    expect(dsl.headers.get("content-disposition") ?? "").toMatch(/attachment/i);

    const teacherDl = await app.request(uploadedBody.attachment.downloadPath, {
      headers: headers(teacherToken, gw.orgId),
    });
    expect(teacherDl.status).toBe(404);
    const parentDl = await app.request(uploadedBody.attachment.downloadPath, {
      headers: headers(parentToken, gw.orgId),
    });
    expect(parentDl.status).toBe(404);
    const studentDl = await app.request(uploadedBody.attachment.downloadPath, {
      headers: headers(studentToken, gw.orgId),
    });
    expect(studentDl.status).toBe(404);
    const oakDl = await app.request(uploadedBody.attachment.downloadPath, { headers: headers(oakToken, oak.orgId) });
    expect(oakDl.status).toBe(404);
    const platformDl = await app.request(uploadedBody.attachment.downloadPath, {
      headers: headers(platformToken, gw.orgId),
    });
    expect(platformDl.status).toBeGreaterThanOrEqual(400);
    expect(platformDl.status).not.toBe(200);
    const keyAlone = await app.request(uploadedBody.attachment.downloadPath);
    expect(keyAlone.status).toBe(401);
  });

  it("cleans expired pending objects and never auto-deletes safeguarding", async () => {
    const school = await createSchool(pools.owner, suffix(), "cln");
    const pendingId = randomUUID();
    const safeguardingId = randomUUID();
    const ownerId = randomUUID();
    const pendingKey = `org/${school.orgId}/admissions/forms/${ownerId}/${pendingId}`;
    const sgKey = `org/${school.orgId}/safeguarding/${ownerId}/${safeguardingId}`;
    await testObjectStorage.putObject({ key: pendingKey, body: PDF, contentType: "application/pdf" });
    await testObjectStorage.putObject({ key: sgKey, body: PDF, contentType: "application/pdf" });
    await pools.owner.query(
      `insert into stored_objects (
         id, organisation_id, domain, owner_record_id, storage_backend, storage_key,
         original_filename, content_type, byte_size, status, scan_status, sensitivity, expires_at
       ) values
       ($1,$2,'admissions_form',$3,'filesystem',$4,'draft.pdf','application/pdf',$5,'pending','unscanned','confidential', now() - interval '1 hour'),
       ($6,$2,'safeguarding',$3,'filesystem',$7,'secret.pdf','application/pdf',$5,'pending','unscanned','safeguarding', now() - interval '1 hour')`,
      [pendingId, school.orgId, ownerId, pendingKey, PDF.byteLength, safeguardingId, sgKey],
    );
    const result = await cleanupStoredObjects({ owner: pools.owner, storage: testObjectStorage });
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await testObjectStorage.getObject(pendingKey)).toBeNull();
    expect(await testObjectStorage.getObject(sgKey)).not.toBeNull();
    const remaining = await pools.owner.query<{ status: string }>(
      "select status from stored_objects where id = $1",
      [safeguardingId],
    );
    expect(remaining.rows[0]?.status).toBe("pending");
  });
});
