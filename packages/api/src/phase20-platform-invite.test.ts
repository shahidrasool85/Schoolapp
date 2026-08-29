import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolInviteUrl } from "@schoolapp/core";
import { closePools } from "@schoolapp/db";
import { ensureMigrated, insertUser, login, testApp, testPools } from "./test-helpers";

const suffix = () => randomUUID().slice(0, 8);
const PRODUCTION_DOMAIN = "luvlearn.co.uk";

type SchoolAdminState = {
  invitationStatus: string;
  canReissue: boolean;
  invitationId: string | null;
  email: string | null;
  fullName: string | null;
  membershipStatus: string | null;
};

type OrgList = {
  organisations: Array<{
    id: string;
    slug: string;
    schoolAdmin: SchoolAdminState;
  }>;
};

describe("Platform Admin School Admin invitation reissue", () => {
  const pools = testPools();
  const app = testApp(pools);
  const prodApp = testApp(pools, { platformDomain: PRODUCTION_DOMAIN });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await closePools(pools);
  });

  async function provisionSchool(options?: { app?: ReturnType<typeof testApp>; slug?: string; host?: string }) {
    const id = suffix();
    const api = options?.app ?? app;
    const platformEmail = `platform-reissue-${id}@example.com`;
    await insertUser(pools.owner, {
      email: platformEmail,
      password: "platform-pass-1",
      fullName: "Platform",
      kind: "platform_admin",
      platformAdmin: true,
    });
    const token = await login(api, platformEmail, "platform-pass-1");
    const slug = options?.slug ?? `kw-${id}`;
    const created = await api.request("/api/v1/platform/organisations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options?.host ? { Host: options.host } : {}),
      },
      body: JSON.stringify({
        name: `Kingswood ${id}`,
        slug,
        adminEmail: `admin-${id}@example.com`,
        adminFullName: "Ada Admin",
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      organisationId: string;
      invitationId: string;
      invitationToken: string;
      slug: string;
    };
    return {
      id,
      token,
      platformEmail,
      slug: body.slug,
      organisationId: body.organisationId,
      invitationId: body.invitationId,
      invitationToken: body.invitationToken,
      adminEmail: `admin-${id}@example.com`,
      adminFullName: "Ada Admin",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options?.host ? { Host: options.host } : {}),
      },
    };
  }

  it("reissues an outstanding School Admin invitation and invalidates the previous token", async () => {
    const school = await provisionSchool();

    const listed = (await (
      await app.request("/api/v1/platform/organisations", { headers: school.headers })
    ).json()) as OrgList;
    const listedJson = JSON.stringify(listed);
    expect(listedJson).not.toContain("token_hash");
    expect(listedJson).not.toContain(school.invitationToken);
    const row = listed.organisations.find((org) => org.id === school.organisationId);
    expect(row?.schoolAdmin.invitationStatus).toBe("outstanding");
    expect(row?.schoolAdmin.canReissue).toBe(true);
    expect(row?.schoolAdmin.email).toBe(school.adminEmail);
    expect(row?.schoolAdmin.fullName).toBe("Ada Admin");
    expect(row?.schoolAdmin.invitationId).toBe(school.invitationId);

    const reissued = await app.request(
      `/api/v1/platform/organisations/${school.organisationId}/school-admin-invitation/reissue`,
      { method: "POST", headers: school.headers },
    );
    expect(reissued.status).toBe(201);
    const issued = (await reissued.json()) as {
      invitationId: string;
      invitationToken: string;
      invitationUrl: string;
      email: string;
      fullName: string;
    };
    expect(issued.email).toBe(school.adminEmail);
    expect(issued.fullName).toBe("Ada Admin");
    expect(issued.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.invitationToken).not.toBe(school.invitationToken);
    expect(issued.invitationId).not.toBe(school.invitationId);
    expect(issued.invitationUrl).toBe(
      schoolInviteUrl(school.slug, "localhost", issued.invitationToken),
    );
    expect(JSON.stringify(issued)).not.toContain("token_hash");

    const previous = await pools.owner.query<{ revoked_at: Date | null; token_hash: string }>(
      "select revoked_at, token_hash from invitations where id = $1",
      [school.invitationId],
    );
    expect(previous.rows[0]?.revoked_at).toBeTruthy();
    expect(previous.rows[0]?.token_hash).not.toBe(school.invitationToken);
    expect(previous.rows[0]?.token_hash).not.toBe(issued.invitationToken);

    const stored = await pools.owner.query<{
      intended_role_keys: string[];
      email: string;
      token_hash: string;
    }>("select intended_role_keys, email, token_hash from invitations where id = $1", [
      issued.invitationId,
    ]);
    expect(stored.rows[0]?.email).toBe(school.adminEmail);
    expect(stored.rows[0]?.intended_role_keys).toEqual(["school.admin"]);
    expect(stored.rows[0]?.token_hash).not.toBe(issued.invitationToken);

    const oldAccept = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: school.invitationToken,
        fullName: "Ada Admin",
        password: "admin-pass-12",
      }),
    });
    expect([400, 404]).toContain(oldAccept.status);

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: issued.invitationToken,
        fullName: "Ada Admin",
        password: "admin-pass-12",
      }),
    });
    expect(accepted.status).toBe(200);
  });

  it("generates the production school-host invitation URL", async () => {
    const school = await provisionSchool({
      app: prodApp,
      slug: `kingswood-${suffix()}`,
      host: "app.luvlearn.co.uk",
    });
    const reissued = await prodApp.request(
      `/api/v1/platform/organisations/${school.organisationId}/school-admin-invitation/reissue`,
      { method: "POST", headers: school.headers },
    );
    expect(reissued.status).toBe(201);
    const issued = (await reissued.json()) as { invitationToken: string; invitationUrl: string };
    expect(issued.invitationUrl).toBe(
      `https://${school.slug}.luvlearn.co.uk/invite?token=${issued.invitationToken}`,
    );
    expect(schoolInviteUrl("kingswood", PRODUCTION_DOMAIN, "one-time-token")).toBe(
      "https://kingswood.luvlearn.co.uk/invite?token=one-time-token",
    );
  });

  it("does not reissue an accepted School Admin invitation and shows account state instead", async () => {
    const school = await provisionSchool();
    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: school.invitationToken,
        fullName: "Ada Admin",
        password: "admin-pass-12",
      }),
    });
    expect(accepted.status).toBe(200);

    const listed = (await (
      await app.request("/api/v1/platform/organisations", { headers: school.headers })
    ).json()) as OrgList;
    const row = listed.organisations.find((org) => org.id === school.organisationId);
    expect(row?.schoolAdmin.invitationStatus).toBe("accepted");
    expect(row?.schoolAdmin.canReissue).toBe(false);
    expect(row?.schoolAdmin.email).toBe(school.adminEmail);
    expect(row?.schoolAdmin.fullName).toBe("Ada Admin");
    expect(row?.schoolAdmin.membershipStatus).toBe("active");

    const reissued = await app.request(
      `/api/v1/platform/organisations/${school.organisationId}/school-admin-invitation/reissue`,
      { method: "POST", headers: school.headers },
    );
    expect(reissued.status).toBe(409);
    expect(((await reissued.json()) as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("denies school-host and non-platform actors", async () => {
    const school = await provisionSchool();
    const path = `/api/v1/platform/organisations/${school.organisationId}/school-admin-invitation/reissue`;

    const schoolHost = await app.request(path, {
      method: "POST",
      headers: {
        ...school.headers,
        Host: `${school.slug}.localhost`,
      },
    });
    expect(schoolHost.status).toBe(404);

    const accepted = await app.request("/api/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: school.invitationToken,
        fullName: "Ada Admin",
        password: "admin-pass-12",
      }),
    });
    expect(accepted.status).toBe(200);
    const adminToken = await login(app, school.adminEmail, "admin-pass-12");
    const asSchoolAdmin = await app.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
    });
    expect(asSchoolAdmin.status).toBe(403);

    const otherId = suffix();
    const otherOrg = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`other-${otherId}`, `Other ${otherId}`],
    );
    const otherAdminId = await insertUser(pools.owner, {
      email: `other-admin-${otherId}@example.com`,
      password: "password-12x",
      fullName: "Other Admin",
      kind: "staff",
    });
    await pools.owner.query(
      `insert into organisation_memberships (organisation_id, user_id, status)
       values ($1, $2, 'active')`,
      [otherOrg.rows[0]!.id, otherAdminId],
    );
    const otherToken = await login(app, `other-admin-${otherId}@example.com`, "password-12x");
    const crossTenant = await app.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json",
        "X-Organisation-Id": otherOrg.rows[0]!.id,
      },
    });
    expect(crossTenant.status).toBe(403);

    const listAsSchool = await app.request("/api/v1/platform/organisations", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listAsSchool.status).toBe(403);
  });
});
