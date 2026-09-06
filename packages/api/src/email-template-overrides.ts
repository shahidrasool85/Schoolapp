import {
  isCustomizableEmailTemplateKey,
  type CustomizableEmailTemplateKey,
} from "@schoolapp/domain";
import type { OrganisationEmailTemplateOverride } from "@schoolapp/core";

type Queryable = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

type OverrideRow = {
  template_key: string;
  enabled: boolean;
  subject: string;
  heading: string;
  greeting: string;
  body_text: string;
  signoff: string;
};

export async function loadOrganisationEmailTemplateOverride(
  pool: Queryable,
  organisationId: string | null | undefined,
  templateKey: string,
): Promise<OrganisationEmailTemplateOverride | null> {
  if (!organisationId || !isCustomizableEmailTemplateKey(templateKey)) return null;
  try {
    const result = await pool.query<OverrideRow>(
      "select * from get_organisation_transactional_email_template($1, $2)",
      [organisationId, templateKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return mapOverrideRow(row);
  } catch {
    return null;
  }
}

export function mapOverrideRow(row: OverrideRow): OrganisationEmailTemplateOverride | null {
  if (!isCustomizableEmailTemplateKey(row.template_key)) return null;
  return {
    templateKey: row.template_key as CustomizableEmailTemplateKey,
    enabled: row.enabled !== false,
    subject: String(row.subject ?? ""),
    heading: String(row.heading ?? ""),
    greeting: String(row.greeting ?? ""),
    body: String(row.body_text ?? ""),
    signoff: String(row.signoff ?? ""),
  };
}
