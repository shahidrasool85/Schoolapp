import {
  EmailAttachmentError,
  EmailDeliveryError,
  assertTransactionalEmailAttachmentSet,
  attachmentKindLabel,
  defaultTransactionalEmailAttachmentLimits,
  describeAttachmentSetLimitStatus,
  formatAttachmentByteSize,
  presentEmailAttachmentMeta,
  sanitizeEmailAttachmentFilename,
  transactionalEmailAttachmentKind,
  type EmailAttachment,
  type EmailAttachmentMeta,
  type TransactionalEmailAttachmentLimits,
} from "@schoolapp/core";
import { isCustomizableEmailTemplateKey, type CustomizableEmailTemplateKey } from "@schoolapp/domain";
import type { ObjectStoragePort } from "@schoolapp/storage";
import { loadPlatformEmailAttachmentLimits } from "./platform-email-attachment-limits";

type Queryable = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export type AutomaticEmailAttachmentView = EmailAttachmentMeta & {
  id: string;
  storedObjectId: string;
  kindLabel: string;
  sizeLabel: string;
  overLimitReason: string | null;
};

type AttachmentRow = {
  id: string;
  stored_object_id: string;
  display_filename: string;
  sort_order: number;
  storage_key: string;
  content_type: string;
  byte_size: string | number;
  object_status: string;
  object_domain: string;
  deleted_at: Date | string | null;
};

export function emailAttachmentErrorToDeliveryError(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  if (error instanceof EmailAttachmentError) {
    return new EmailDeliveryError("retryable", error.code, error.message);
  }
  return new EmailDeliveryError("retryable", "provider_error", String(error));
}

export async function loadShowSchoolLogo(
  pool: Queryable,
  organisationId: string | null | undefined,
  templateKey: string,
): Promise<boolean> {
  if (!organisationId || !isCustomizableEmailTemplateKey(templateKey)) return true;
  try {
    const result = await pool.query<{ show_school_logo: boolean }>(
      "select * from get_organisation_transactional_email_settings($1, $2)",
      [organisationId, templateKey],
    );
    return result.rows[0]?.show_school_logo !== false;
  } catch {
    return true;
  }
}

export async function loadAutomaticEmailAttachmentViews(
  pool: Queryable,
  organisationId: string,
  templateKey: CustomizableEmailTemplateKey,
  limits?: TransactionalEmailAttachmentLimits,
): Promise<AutomaticEmailAttachmentView[]> {
  const effective = limits ?? (await loadPlatformEmailAttachmentLimits(pool));
  const rows = await pool.query<{
    id: string;
    stored_object_id: string;
    display_filename: string;
    content_type: string;
    byte_size: string | number;
  }>(
    `select a.id, a.stored_object_id, a.display_filename, so.content_type, so.byte_size
       from organisation_transactional_email_template_attachments a
       join stored_objects so
         on so.id = a.stored_object_id
        and so.organisation_id = a.organisation_id
      where a.organisation_id = $1
        and a.template_key = $2
        and so.domain = 'transactional_email'
        and so.status = 'active'
        and so.deleted_at is null
      order by a.sort_order, a.created_at, a.id`,
    [organisationId, templateKey],
  );
  return presentAutomaticEmailAttachmentList(rows.rows, effective);
}

export function presentAutomaticEmailAttachment(
  row: {
    id: string;
    stored_object_id: string;
    display_filename: string;
    content_type: string;
    byte_size: string | number;
  },
  limits: TransactionalEmailAttachmentLimits = defaultTransactionalEmailAttachmentLimits(),
  extras: { countOverLimit?: boolean; totalOverLimit?: boolean } = {},
): AutomaticEmailAttachmentView {
  const meta = presentEmailAttachmentMeta(
    {
      filename: row.display_filename,
      contentType: row.content_type,
      byteSize: Number(row.byte_size),
    },
    limits,
    { enforceSize: false },
  );
  const overLimit = meta.overLimit || Boolean(extras.countOverLimit) || Boolean(extras.totalOverLimit);
  let overLimitReason: string | null = null;
  if (meta.overLimit) {
    overLimitReason = `This file is over the current maximum of ${formatAttachmentByteSize(limits.maxBytesPerFile)}. This email will not send until the file is removed.`;
  } else if (extras.countOverLimit) {
    overLimitReason = `This automatic email has more than ${limits.maxCount} attachments. This email will not send until extra files are removed.`;
  } else if (extras.totalOverLimit) {
    overLimitReason = `These attachments are over the current total maximum of ${formatAttachmentByteSize(limits.maxTotalBytes)}. This email will not send until files are removed.`;
  }
  return {
    id: row.id,
    storedObjectId: row.stored_object_id,
    ...meta,
    overLimit,
    kindLabel: attachmentKindLabel(meta.kind),
    sizeLabel: formatAttachmentByteSize(meta.byteSize),
    overLimitReason,
  };
}

export function presentAutomaticEmailAttachmentList(
  rows: Array<{
    id: string;
    stored_object_id: string;
    display_filename: string;
    content_type: string;
    byte_size: string | number;
  }>,
  limits: TransactionalEmailAttachmentLimits,
): AutomaticEmailAttachmentView[] {
  const status = describeAttachmentSetLimitStatus(
    rows.map((row) => ({ byteSize: Number(row.byte_size) })),
    limits,
  );
  return rows.map((row, index) =>
    presentAutomaticEmailAttachment(row, limits, {
      countOverLimit: index >= limits.maxCount,
      totalOverLimit: status.totalOverLimit || status.encodedOverLimit,
    }),
  );
}

export async function loadSendAttachments(input: {
  pool: Queryable;
  storage: ObjectStoragePort | undefined;
  organisationId: string | null | undefined;
  templateKey: string;
}): Promise<EmailAttachment[] | undefined> {
  if (!input.organisationId || !isCustomizableEmailTemplateKey(input.templateKey)) {
    return undefined;
  }
  let rows: AttachmentRow[];
  try {
    const result = await input.pool.query<AttachmentRow>(
      "select * from get_organisation_transactional_email_attachments($1, $2)",
      [input.organisationId, input.templateKey],
    );
    rows = result.rows;
  } catch {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_unavailable",
      "Automatic email attachments could not be loaded",
    );
  }
  if (!rows.length) return undefined;
  if (!input.storage?.isConfigured()) {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_unavailable",
      "Automatic email attachments could not be loaded",
    );
  }
  const limits = await loadPlatformEmailAttachmentLimits(input.pool);
  const metas = assertTransactionalEmailAttachmentSet(
    rows.map((row) => {
      assertSendAttachmentRow(row, input.organisationId!);
      return {
        filename: row.display_filename,
        contentType: row.content_type,
        byteSize: Number(row.byte_size),
      };
    }),
    limits,
  );
  const attachments: EmailAttachment[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const meta = metas[i]!;
    let object;
    try {
      object = await input.storage.getObject(row.storage_key);
    } catch {
      throw new EmailDeliveryError(
        "retryable",
        "attachment_unavailable",
        "A configured email attachment could not be loaded",
      );
    }
    if (!object || object.body.byteLength <= 0) {
      throw new EmailDeliveryError(
        "retryable",
        "attachment_unavailable",
        "A configured email attachment could not be loaded",
      );
    }
    if (object.body.byteLength !== meta.byteSize) {
      throw new EmailDeliveryError(
        "retryable",
        "attachment_invalid",
        "A configured email attachment could not be validated",
      );
    }
    attachments.push({
      filename: sanitizeEmailAttachmentFilename(meta.filename, meta.contentType),
      contentType: meta.contentType,
      content: object.body,
    });
  }
  return attachments;
}

function assertSendAttachmentRow(row: AttachmentRow, organisationId: string): void {
  if (row.object_domain !== "transactional_email") {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_invalid",
      "A configured email attachment is not an allowed file type",
    );
  }
  if (row.object_status !== "active" || row.deleted_at) {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_unavailable",
      "A configured email attachment could not be loaded",
    );
  }
  if (!row.storage_key || !row.storage_key.startsWith(`org/${organisationId}/`)) {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_unavailable",
      "A configured email attachment could not be loaded",
    );
  }
  if (!transactionalEmailAttachmentKind(row.content_type)) {
    throw new EmailDeliveryError(
      "retryable",
      "attachment_invalid",
      "A configured email attachment is not an allowed file type",
    );
  }
}
