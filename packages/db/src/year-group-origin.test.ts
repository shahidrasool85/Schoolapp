import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, createPools } from "./client.js";
import { migrate } from "./migrate.js";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgres://schoolapp_owner:schoolapp_owner@127.0.0.1:5432/schoolapp_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://schoolapp_app:schoolapp_app@127.0.0.1:5432/schoolapp_test";

async function applyLegacyOriginBackfill(owner: ReturnType<typeof createPools>["owner"], orgId: string) {
  await owner.query(
    `update year_groups
     set origin = case
       when is_standard_seeded_year_group(code, name, key_stage, sort_order) then 'system'
       else 'custom'
     end
     where organisation_id = $1`,
    [orgId],
  );
}

describe("year group origin backfill", () => {
  const pools = createPools({ appUrl, ownerUrl });

  beforeAll(async () => {
    await migrate(ownerUrl);
  }, 60_000);

  afterAll(async () => {
    await closePools(pools);
  });

  it("classifies historical seeded Year 3 as system and custom names as custom", async () => {
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`yg-origin-${randomUUID().slice(0, 8)}`, "Origin School"],
    );
    const orgId = org.rows[0]!.id;
    await pools.owner.query("insert into organisation_settings (organisation_id) values ($1)", [orgId]);

    const year3 = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '3', 'Year 3', 2, 3)
       returning id`,
      [orgId],
    );
    const lowerPrep = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '7', 'Lower Prep', 3, 7)
       returning id`,
      [orgId],
    );
    const lookalike = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '8', 'Year 3', 3, 8)
       returning id`,
      [orgId],
    );
    const formX = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order)
       values ($1, '6', 'Form X', 2, 6)
       returning id`,
      [orgId],
    );

    expect(
      (
        await pools.owner.query<{ ok: boolean }>(
          "select is_standard_seeded_year_group('3', 'Year 3', 2::smallint, 3) as ok",
        )
      ).rows[0]?.ok,
    ).toBe(true);
    expect(
      (
        await pools.owner.query<{ ok: boolean }>(
          "select is_standard_seeded_year_group('7', 'Lower Prep', 3::smallint, 7) as ok",
        )
      ).rows[0]?.ok,
    ).toBe(false);
    expect(
      (
        await pools.owner.query<{ ok: boolean }>(
          "select is_standard_seeded_year_group('8', 'Year 3', 3::smallint, 8) as ok",
        )
      ).rows[0]?.ok,
    ).toBe(false);

    await applyLegacyOriginBackfill(pools.owner, orgId);

    const classified = await pools.owner.query<{ id: string; origin: string }>(
      "select id, origin from year_groups where organisation_id = $1",
      [orgId],
    );
    const byId = new Map(classified.rows.map((row) => [row.id, row.origin]));
    expect(byId.get(year3.rows[0]!.id)).toBe("system");
    expect(byId.get(lowerPrep.rows[0]!.id)).toBe("custom");
    expect(byId.get(lookalike.rows[0]!.id)).toBe("custom");
    expect(byId.get(formX.rows[0]!.id)).toBe("custom");
  });

  it("does not leave a previous over-broad system backfill in place", async () => {
    const org = await pools.owner.query<{ id: string }>(
      "insert into organisations (slug, name, status) values ($1, $2, 'active') returning id",
      [`yg-repair-${randomUUID().slice(0, 8)}`, "Repair School"],
    );
    const orgId = org.rows[0]!.id;
    await pools.owner.query("insert into organisation_settings (organisation_id) values ($1)", [orgId]);
    const custom = await pools.owner.query<{ id: string }>(
      `insert into year_groups (organisation_id, code, name, key_stage, sort_order, origin)
       values ($1, '5', 'Lower Prep', 2, 5, 'system')
       returning id`,
      [orgId],
    );
    await pools.owner.query(
      `update year_groups
       set origin = 'custom'
       where organisation_id = $1
         and origin = 'system'
         and not is_standard_seeded_year_group(code, name, key_stage, sort_order)`,
      [orgId],
    );
    const row = await pools.owner.query<{ origin: string }>(
      "select origin from year_groups where id = $1",
      [custom.rows[0]!.id],
    );
    expect(row.rows[0]?.origin).toBe("custom");
  });
});
