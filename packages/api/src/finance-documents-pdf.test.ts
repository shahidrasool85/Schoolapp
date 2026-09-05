import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { extractPdfText } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import {
  addMembership,
  ensureMigrated,
  insertUser,
  login,
  testApp,
  testPools,
} from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function imageForm(bytes: Uint8Array, filename = "logo.png") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  return form;
}

async function createSchool(
  owner: ReturnType<typeof testPools>["owner"],
  id: string,
  name: string,
) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string }>(
    "insert into organisations (slug, name, legal_name, status) values ($1, $2, $3, 'active') returning id",
    [`pdf-${id}`, name, `${name} Ltd`],
  );
  await owner.query(
    `insert into organisation_settings (
       organisation_id, contact_telephone, contact_email, website, address_line_1, city, postcode
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [org.rows[0]!.id, "0121 111 1111", `office@${id}.test`, `www.${id}.test`, "1 School Road", "Solihull", "B90 1AA"],
  );
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return { adminId, orgId: org.rows[0]!.id, adminEmail: `admin-${id}@example.com`, name };
}

function headers(token: string, orgId: string, json = true) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Organisation-Id": orgId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("Finance invoice and receipt PDFs", () => {
  const pools = testPools();
  const app = testApp(pools);

  beforeAll(async () => {
    await ensureMigrated();
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("isolates branding, bank details, snapshots and parent downloads", async () => {
    const idA = suffix();
    const idB = suffix();
    const schoolA = await createSchool(pools.owner, idA, `Riverside ${idA}`);
    const schoolB = await createSchool(pools.owner, idB, `Oakfield ${idB}`);
    const tokenA = await login(app, schoolA.adminEmail, "password-12x");
    const tokenB = await login(app, schoolB.adminEmail, "password-12x");
    const hdrsA = headers(tokenA, schoolA.orgId);
    const hdrsB = headers(tokenB, schoolB.orgId);

    const saved = await json<{ settings: { bankName: string | null; financeEmail: string | null } }>(
      await app.request("/api/v1/finance/settings", {
        method: "PATCH",
        headers: hdrsA,
        body: JSON.stringify({
          tuitionEnabled: true,
          invoicePrefix: "RIV-INV",
          receiptPrefix: "RIV-RCT",
          financeEmail: "bursar@riverside.test",
          bankName: "Riverside Bank",
          bankAccountName: "Riverside School",
          bankAccountNumber: "11112222",
          bankSortCode: "11-22-33",
          paymentInstructions: "Quote the invoice number.",
          invoiceFooter: "Company registered in England.",
        }),
      }),
    );
    expect(saved.settings.bankName).toBe("Riverside Bank");
    expect(saved.settings.financeEmail).toBe("bursar@riverside.test");

    const otherSettings = await json<{ settings: { bankName: string | null } }>(
      await app.request("/api/v1/finance/settings", { headers: hdrsB }),
    );
    expect(otherSettings.settings.bankName).toBeNull();

    const logo = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: headers(tokenA, schoolA.orgId, false),
      body: imageForm(solidPng(64, 48, [20, 90, 160])),
    });
    expect(logo.status).toBe(201);

    const year = await json<{ academicYear: { id: string } }>(
      await app.request("/api/v1/academic-years", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({
          name: "2026/27",
          startsOn: "2026-09-01",
          endsOn: "2027-07-31",
          isCurrent: true,
        }),
      }),
    );
    await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrsA, body: "{}" });
    const groups = await json<{ yearGroups: Array<{ id: string; code: string }> }>(
      await app.request("/api/v1/year-groups", { headers: hdrsA }),
    );
    const year3 = groups.yearGroups.find((group) => group.code === "3")!;
    const pupil = await json<{ student: { id: string } }>(
      await app.request("/api/v1/students", {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({
          legalName: "Shahid Rasool",
          academicYearId: year.academicYear.id,
          yearGroupId: year3.id,
        }),
      }),
    );
    const parentEmail = `parent-${idA}@example.com`;
    const guardian = await json<{ invitationToken: string | null }>(
      await app.request(`/api/v1/students/${pupil.student.id}/guardians`, {
        method: "POST",
        headers: hdrsA,
        body: JSON.stringify({
          email: parentEmail,
          fullName: "Pat Parent",
          relationship: "father",
          portalAccess: true,
          hasParentalResponsibility: true,
        }),
      }),
    );
    if (guardian.invitationToken) {
      await app.request("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: guardian.invitationToken, fullName: "Pat Parent", password: "parent-pass-1" }),
      });
    }
    await pools.owner.query(
      `update users
          set address_line1 = '14 Oak Road', address_town = 'Birmingham', address_postcode = 'B13 9AA'
        where email = $1`,
      [parentEmail],
    );

    const schedule = await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        name: "Year 3 tuition",
        academicYearId: year.academicYear.id,
        amountMinor: 200000,
        billingFrequency: "monthly",
        effectiveFrom: "2026-01-01",
      }),
    });
    expect(schedule.status).toBe(201);
    const preview = await app.request("/api/v1/finance/billing-runs/preview", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        academicYearId: year.academicYear.id,
        frequency: "monthly",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        dueOn: "2026-09-15",
      }),
    });
    expect(preview.status).toBe(201);
    const run = await json<{ run: { id: string } }>(preview);
    const confirmed = await app.request(`/api/v1/finance/billing-runs/${run.run.id}/confirm`, {
      method: "POST",
      headers: hdrsA,
      body: "{}",
    });
    expect(confirmed.status).toBe(200);
    const invoices = await json<{ invoices: Array<{ id: string; reference: string; totalMinor: number }> }>(
      await app.request("/api/v1/finance/invoices", { headers: hdrsA }),
    );
    expect(invoices.invoices).toHaveLength(1);
    const invoice = invoices.invoices[0]!;
    expect(invoice.reference.startsWith("RIV-INV-")).toBe(true);
    const originalTotal = invoice.totalMinor;

    await app.request("/api/v1/finance/fee-schedules", {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({
        name: "Should not rewrite issued invoices",
        academicYearId: year.academicYear.id,
        amountMinor: 999999,
        billingFrequency: "monthly",
        effectiveFrom: "2026-10-01",
      }),
    });

    const pdf = await app.request(`/api/v1/finance/invoices/${invoice.id}/pdf`, { headers: hdrsA });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain(`${invoice.reference}.pdf`);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const text = extractPdfText(bytes);
    expect(text).toContain(schoolA.name);
    expect(text).toContain("Riverside Bank");
    expect(text).toContain("11112222");
    expect(text).toContain("bursar@riverside.test");
    expect(text).toContain("Pat Parent");
    expect(text).toContain("14 Oak Road");
    expect(text).toContain("INVOICE");
    expect(text).toContain("£");
    expect(text).not.toContain("Oakfield");
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");
    expect(text).not.toContain("9,999.99");
    expect(originalTotal).toBe(200000);

    const partPay = await app.request(`/api/v1/finance/invoices/${invoice.id}/payments`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ amountMinor: 50000, method: "bank_transfer", receivedOn: "2026-09-05" }),
    });
    expect(partPay.status).toBe(201);
    const partialPdf = extractPdfText(
      new Uint8Array(await (await app.request(`/api/v1/finance/invoices/${invoice.id}/pdf`, { headers: hdrsA })).arrayBuffer()),
    );
    expect(partialPdf).toContain("PARTIALLY PAID");

    const cardPay = await app.request(`/api/v1/finance/invoices/${invoice.id}/payments`, {
      method: "POST",
      headers: hdrsA,
      body: JSON.stringify({ amountMinor: 150000, method: "card", receivedOn: "2026-09-06" }),
    });
    expect(cardPay.status).toBe(201);
    const paidPdf = extractPdfText(
      new Uint8Array(await (await app.request(`/api/v1/finance/invoices/${invoice.id}/pdf`, { headers: hdrsA })).arrayBuffer()),
    );
    expect(paidPdf).toContain("PAID");

    const receipts = await json<{ receipts: Array<{ id: string; reference: string }> }>(
      await app.request("/api/v1/finance/receipts", { headers: hdrsA }),
    );
    expect(receipts.receipts.length).toBeGreaterThanOrEqual(2);
    const bankReceipt = receipts.receipts.find((row) => row.reference.startsWith("RIV-RCT-"))!;
    const receiptPdf = await app.request(`/api/v1/finance/receipts/${bankReceipt.id}/pdf`, { headers: hdrsA });
    expect(receiptPdf.status).toBe(200);
    expect(receiptPdf.headers.get("content-type")).toContain("application/pdf");
    expect(receiptPdf.headers.get("content-disposition")).toContain(`${bankReceipt.reference}.pdf`);
    const receiptText = extractPdfText(new Uint8Array(await receiptPdf.arrayBuffer()));
    expect(receiptText).toContain("RECEIPT");
    expect(receiptText).toMatch(/Bank transfer|Stripe \/ Card/);
    expect(receiptText).toContain(invoice.reference);
    expect(receiptText).not.toContain("pi_");

    const issuedSnapshot = await pools.owner.query<{ display_snapshot: Record<string, unknown> }>(
      `select display_snapshot from school_invoices where id = $1 and organisation_id = $2`,
      [invoice.id, schoolA.orgId],
    );
    const issued = issuedSnapshot.rows[0]!.display_snapshot;
    expect(issued.schoolName).toBe(schoolA.name);
    expect(issued.schoolLegalName).toBe(`${schoolA.name} Ltd`);
    expect(issued.schoolAddress).toContain("1 School Road");
    expect(issued.schoolPhone).toBe("0121 111 1111");
    expect(issued.schoolEmail).toBe("bursar@riverside.test");
    expect(issued.schoolWebsite).toBe(`www.${idA}.test`);
    expect(issued.bankName).toBe("Riverside Bank");
    expect(issued.bankAccountName).toBe("Riverside School");
    expect(issued.bankAccountNumber).toBe("11112222");
    expect(issued.bankSortCode).toBe("11-22-33");
    expect(issued.paymentInstructions).toBe("Quote the invoice number.");
    expect(issued.footer).toBe("Company registered in England.");
    expect(issued.logoObjectId).toBeTruthy();
    const issuedLogoId = String(issued.logoObjectId);

    const receiptRow = await pools.owner.query<{ snapshot: Record<string, unknown> }>(
      `select snapshot from school_payment_receipts where id = $1 and organisation_id = $2`,
      [bankReceipt.id, schoolA.orgId],
    );
    const issuedReceipt = receiptRow.rows[0]!.snapshot;
    expect(issuedReceipt.schoolName).toBe(schoolA.name);
    expect(issuedReceipt.bankName).toBe("Riverside Bank");
    expect(issuedReceipt.schoolEmail).toBe("bursar@riverside.test");
    expect(issuedReceipt.logoObjectId).toBe(issuedLogoId);

    await pools.owner.query(`update organisations set name = 'Changed School', legal_name = 'Changed Ltd' where id = $1`, [
      schoolA.orgId,
    ]);
    await pools.owner.query(
      `update organisation_settings
          set address_line_1 = '99 New Road', contact_telephone = '0000 000 0000',
              contact_email = 'office@changed.test', website = 'www.changed.test'
        where organisation_id = $1`,
      [schoolA.orgId],
    );
    const changedSettings = await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: hdrsA,
      body: JSON.stringify({
        financeEmail: "new@changed.test",
        bankName: "New Bank",
        bankAccountName: "New Account",
        bankAccountNumber: "99999999",
        bankSortCode: "00-00-00",
        paymentInstructions: "New payment instructions",
        invoiceFooter: "Changed footer",
      }),
    });
    expect(changedSettings.status).toBe(200);
    const newLogo = await app.request("/api/v1/onboarding/branding/logo", {
      method: "POST",
      headers: headers(tokenA, schoolA.orgId, false),
      body: imageForm(solidPng(64, 48, [200, 20, 20])),
    });
    expect(newLogo.status).toBe(201);

    const reprintText = extractPdfText(
      new Uint8Array(await (await app.request(`/api/v1/finance/invoices/${invoice.id}/pdf`, { headers: hdrsA })).arrayBuffer()),
    );
    expect(reprintText).toContain(schoolA.name);
    expect(reprintText).toContain("1 School Road");
    expect(reprintText).toContain("0121 111 1111");
    expect(reprintText).toContain("bursar@riverside.test");
    expect(reprintText).toContain(`www.${idA}.test`);
    expect(reprintText).toContain("Riverside Bank");
    expect(reprintText).toContain("11112222");
    expect(reprintText).toContain("11-22-33");
    expect(reprintText).toContain("Company registered in England.");
    expect(reprintText).not.toContain("Changed School");
    expect(reprintText).not.toContain("99 New Road");
    expect(reprintText).not.toContain("New Bank");
    expect(reprintText).not.toContain("new@changed.test");
    expect(reprintText).not.toContain("Changed footer");

    const reprintReceipt = extractPdfText(
      new Uint8Array(
        await (await app.request(`/api/v1/finance/receipts/${bankReceipt.id}/pdf`, { headers: hdrsA })).arrayBuffer(),
      ),
    );
    expect(reprintReceipt).toContain(schoolA.name);
    expect(reprintReceipt).toContain("Riverside Bank");
    expect(reprintReceipt).toContain("bursar@riverside.test");
    expect(reprintReceipt).not.toContain("Changed School");
    expect(reprintReceipt).not.toContain("New Bank");

    const currentLogo = await pools.owner.query<{ logo_object_id: string | null }>(
      `select logo_object_id from organisation_settings where organisation_id = $1`,
      [schoolA.orgId],
    );
    expect(currentLogo.rows[0]!.logo_object_id).toBeTruthy();
    expect(currentLogo.rows[0]!.logo_object_id).not.toBe(issuedLogoId);

    const stolen = await app.request(`/api/v1/finance/invoices/${invoice.id}/pdf`, { headers: hdrsB });
    expect(stolen.status).toBe(404);

    const parentToken = await login(app, parentEmail, "parent-pass-1");
    const parentPdf = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/pdf`, {
      headers: headers(parentToken, schoolA.orgId),
    });
    expect(parentPdf.status).toBe(200);
    const otherParent = await insertUser(pools.owner, {
      email: `other-${idA}@example.com`,
      password: "password-12x",
      fullName: "Other Parent",
      kind: "parent",
    });
    await addMembership(pools.owner, schoolA.orgId, otherParent, "school.parent");
    const otherToken = await login(app, `other-${idA}@example.com`, "password-12x");
    const denied = await app.request(`/api/v1/parent/finance/invoices/${invoice.id}/pdf`, {
      headers: headers(otherToken, schoolA.orgId),
    });
    expect(denied.status).toBe(404);

    const teacherId = await insertUser(pools.owner, {
      email: `teacher-${idA}@example.com`,
      password: "password-12x",
      fullName: "Teacher",
      kind: "staff",
    });
    await addMembership(pools.owner, schoolA.orgId, teacherId, "school.teacher");
    const teacherToken = await login(app, `teacher-${idA}@example.com`, "password-12x");
    const teacherPatch = await app.request("/api/v1/finance/settings", {
      method: "PATCH",
      headers: headers(teacherToken, schoolA.orgId),
      body: JSON.stringify({ bankName: "Stolen Bank" }),
    });
    expect(teacherPatch.status).toBe(403);
  });
});
