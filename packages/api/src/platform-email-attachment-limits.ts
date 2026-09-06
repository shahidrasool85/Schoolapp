import {
  clampTransactionalEmailAttachmentLimits,
  defaultTransactionalEmailAttachmentLimits,
  presentPlatformEmailAttachmentLimits,
  type TransactionalEmailAttachmentLimits,
} from "@schoolapp/core";

type Queryable = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

type LimitRow = {
  max_bytes_per_file: string | number;
  max_total_bytes: string | number;
  max_count: string | number;
};

export async function loadPlatformEmailAttachmentLimits(
  pool: Queryable,
): Promise<TransactionalEmailAttachmentLimits> {
  try {
    const result = await pool.query<LimitRow>(
      "select * from get_platform_transactional_email_attachment_limits()",
    );
    const row = result.rows[0];
    if (!row) return defaultTransactionalEmailAttachmentLimits();
    return clampTransactionalEmailAttachmentLimits({
      maxBytesPerFile: Number(row.max_bytes_per_file),
      maxTotalBytes: Number(row.max_total_bytes),
      maxCount: Number(row.max_count),
    });
  } catch {
    return defaultTransactionalEmailAttachmentLimits();
  }
}

export function jsonPlatformEmailAttachmentLimits(limits: TransactionalEmailAttachmentLimits) {
  return presentPlatformEmailAttachmentLimits(limits);
}
