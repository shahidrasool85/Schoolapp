import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function createSchool(owner: ReturnType<typeof testPools>["owner"], id: string) {
  const adminId = await insertUser(owner, {
    email: `admin-${id}@example.com`,
    password: "password-12x",
    fullName: "Admin",
    kind: "staff",
  });
  const org = await owner.query<{ id: string; slug: string; name: string }>(
    "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id, slug, name",
    [`wl-${id}`, `Waitlist ${id}`],
  );
  await owner.query("insert into organisation_settings (organisation_id, contact_email) values ($1, $2)", [
    org.rows[0]!.id,
    `office-${id}@school.test`,
  ]);
  await addMembership(owner, org.rows[0]!.id, adminId, "school.admin");
  return {
    adminId,
    orgId: org.rows[0]!.id,
    slug: org.rows[0]!.slug,
    name: org.rows[0]!.name,
    adminEmail: `admin-${id}@example.com`,
  };
}

function headers(token: string, orgId: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Organisation-Id": orgId,
  };
}

async function seedYear(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>) {
  const year = await app.request("/api/v1/academic-years", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      name: "2026/27",
      startsOn: "2026-09-01",
      endsOn: "2027-07-31",
      isCurrent: true,
    }),
  });
  const yearBody = (await year.json()) as { academicYear: { id: string } };
  await app.request("/api/v1/year-groups/seed", { method: "POST", headers: hdrs, body: "{}" });
  const groups = (await (await app.request("/api/v1/year-groups", { headers: hdrs })).json()) as {
    yearGroups: Array<{ id: string; code: string }>;
  };
  const year3 = groups.yearGroups.find((g) => g.code === "3")!;
  return { yearId: yearBody.academicYear.id, yearGroupId: year3.id };
}

async function createApplication(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  structure: { yearId: string; yearGroupId: string },
  pupil: string,
) {
  const created = await app.request("/api/v1/admissions/applications", {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      pupilLegalName: pupil,
      pupilPreferredName: pupil.split(" ")[0],
      intendedAcademicYearId: structure.yearId,
      intendedYearGroupId: structure.yearGroupId,
      status: "submitted",
      contacts: [{ fullName: "Primary Parent", email: "parent@example.com", isPrimary: true, relationship: "mother" }],
    }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { application: { id: string; reference: string; status: string } };
  return body.application;
}

async function enableStatusEmail(app: ReturnType<typeof testApp>, hdrs: ReturnType<typeof headers>, key: string) {
  const enabled = await app.request(`/api/v1/onboarding/mail/templates/${key}/presentation`, {
    method: "PUT",
    headers: hdrs,
    body: JSON.stringify({ sendEnabled: true }),
  });
  expect(enabled.status).toBe(200);
}

async function makeOffer(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  applicationId: string,
  extra: Record<string, unknown> = {},
) {
  return app.request(`/api/v1/admissions/applications/${applicationId}/offers`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(extra),
  });
}

async function placeOnWaitingList(
  app: ReturnType<typeof testApp>,
  hdrs: ReturnType<typeof headers>,
  applicationId: string,
) {
  return app.request(`/api/v1/admissions/applications/${applicationId}/waiting-list`, {
    method: "POST",
    headers: hdrs,
    body: "{}",
  });
}

describe("offer made to waiting list closes the open offer", () => {
  const pools = testPools();

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  it("closes the open offer, records history, and lets a later make-offer succeed", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, "Maya Cole");
    expect((await app.request(`/api/v1/admissions/applications/${application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    })).status).toBe(200);

    const offer = await makeOffer(app, hdrs, application.id, { responseDeadline: "2026-06-01" });
    expect(offer.status).toBe(201);
    const offerBody = (await offer.json()) as { offer: { id: string; status: string } };
    expect(offerBody.offer.status).toBe("made");

    const waitlisted = await placeOnWaitingList(app, hdrs, application.id);
    expect(waitlisted.status).toBe(201);

    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${application.id}`, { headers: hdrs })
    ).json()) as {
      application: { status: string };
      history: Array<{ previousStatus: string | null; newStatus: string; reason: string | null }>;
      offers: Array<{ id: string; status: string }>;
    };
    expect(detail.application.status).toBe("waiting_list");
    expect(detail.offers.find((row) => row.id === offerBody.offer.id)?.status).toBe("withdrawn");
    expect(detail.offers.filter((row) => row.status === "made")).toHaveLength(0);
    expect(
      detail.history.some(
        (row) => row.previousStatus === "offer_made" && row.newStatus === "waiting_list" && row.reason === "Placed on waiting list",
      ),
    ).toBe(true);

    const openOffers = await pools.owner.query(
      `select id from admissions_offers where application_id = $1 and organisation_id = $2 and status = 'made'`,
      [application.id, school.orgId],
    );
    expect(openOffers.rows).toHaveLength(0);

    const again = await makeOffer(app, hdrs, application.id, { responseDeadline: "2026-07-01" });
    expect(again.status).toBe(201);
    expect(((await again.json()) as { offer: { status: string } }).offer.status).toBe("made");
  });

  it("queues B4 waitlisted mail once when enabled and queues nothing when disabled", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);

    const disabled = await createApplication(app, hdrs, structure, "Noah Cole");
    expect((await app.request(`/api/v1/admissions/applications/${disabled.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    })).status).toBe(200);
    expect((await makeOffer(app, hdrs, disabled.id)).status).toBe(201);
    expect((await placeOnWaitingList(app, hdrs, disabled.id)).status).toBe(201);
    expect(
      (
        await pools.owner.query(
          `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_status_update'`,
          [school.orgId],
        )
      ).rows,
    ).toHaveLength(0);

    await enableStatusEmail(app, hdrs, "admissions_status_waiting_list");
    const enabled = await createApplication(app, hdrs, structure, "Ivy Cole");
    expect((await app.request(`/api/v1/admissions/applications/${enabled.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    })).status).toBe(200);
    expect((await makeOffer(app, hdrs, enabled.id)).status).toBe(201);
    expect((await placeOnWaitingList(app, hdrs, enabled.id)).status).toBe(201);
    expect((await placeOnWaitingList(app, hdrs, enabled.id)).status).toBe(201);
    const queued = await pools.owner.query<{ template_key: string; idempotency_key: string }>(
      `select template_key, idempotency_key
         from mail_outbox
        where organisation_id = $1 and purpose = 'admissions_status_update'
        order by created_at`,
      [school.orgId],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.template_key).toBe("admissions_status_waiting_list");
  });

  it("rolls back offer closure and the status change when the waiting-list write fails", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, "Sam Cole");
    expect((await app.request(`/api/v1/admissions/applications/${application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    })).status).toBe(200);
    expect((await makeOffer(app, hdrs, application.id)).status).toBe(201);

    await pools.owner.query(`
      create or replace function test_fail_waitlist_insert()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'test_forced_failure' using errcode = 'P0001';
      end;
      $$;
    `);
    await pools.owner.query(`
      drop trigger if exists test_fail_waitlist_insert_tg on admissions_waiting_list_entries;
      create trigger test_fail_waitlist_insert_tg
        before insert on admissions_waiting_list_entries
        for each row execute function test_fail_waitlist_insert();
    `);
    try {
      const failed = await placeOnWaitingList(app, hdrs, application.id);
      expect(failed.status).toBeGreaterThanOrEqual(400);
      const status = await pools.owner.query<{ status: string }>(
        `select status from admissions_applications where id = $1`,
        [application.id],
      );
      expect(status.rows[0]?.status).toBe("offer_made");
      const offers = await pools.owner.query<{ status: string }>(
        `select status from admissions_offers where application_id = $1 order by created_at desc`,
        [application.id],
      );
      expect(offers.rows[0]?.status).toBe("made");
      expect(
        (
          await pools.owner.query(
            `select id from mail_outbox where organisation_id = $1 and purpose = 'admissions_status_update'`,
            [school.orgId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pools.owner.query(`drop trigger if exists test_fail_waitlist_insert_tg on admissions_waiting_list_entries`);
      await pools.owner.query(`drop function if exists test_fail_waitlist_insert()`);
    }
  });

  it("does not change anything on an illegal waiting-list transition", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, "Alex Cole");
    const illegal = await placeOnWaitingList(app, hdrs, application.id);
    expect(illegal.status).toBe(409);
    const status = await pools.owner.query<{ status: string }>(
      `select status from admissions_applications where id = $1`,
      [application.id],
    );
    expect(status.rows[0]?.status).toBe("submitted");
    expect(
      (
        await pools.owner.query(`select id from admissions_offers where application_id = $1`, [application.id])
      ).rows,
    ).toHaveLength(0);
  });

  it("keeps decline-with-waitlist on offer status declined and still allows a later offer", async () => {
    const app = testApp(pools);
    const school = await createSchool(pools.owner, suffix());
    const token = await login(app, school.adminEmail, "password-12x");
    const hdrs = headers(token, school.orgId);
    const structure = await seedYear(app, hdrs);
    const application = await createApplication(app, hdrs, structure, "Riley Cole");
    expect((await app.request(`/api/v1/admissions/applications/${application.id}/status`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ status: "under_review" }),
    })).status).toBe(200);
    const offer = await makeOffer(app, hdrs, application.id);
    expect(offer.status).toBe(201);
    const offerBody = (await offer.json()) as { offer: { id: string } };
    const declined = await app.request(`/api/v1/admissions/offers/${offerBody.offer.id}`, {
      method: "PATCH",
      headers: hdrs,
      body: JSON.stringify({ status: "declined", waitlistOnDecline: true }),
    });
    expect(declined.status).toBe(200);
    expect(((await declined.json()) as { offer: { status: string } }).offer.status).toBe("declined");
    const detail = (await (
      await app.request(`/api/v1/admissions/applications/${application.id}`, { headers: hdrs })
    ).json()) as { application: { status: string }; offers: Array<{ status: string }> };
    expect(detail.application.status).toBe("waiting_list");
    expect(detail.offers.map((row) => row.status)).toContain("declined");
    expect(detail.offers.filter((row) => row.status === "made")).toHaveLength(0);
    const next = await makeOffer(app, hdrs, application.id);
    expect(next.status).toBe(201);
  });
});
