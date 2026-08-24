import type pg from "pg";
import type { ObjectStoragePort } from "@schoolapp/storage";

const REFERENCE_SQL = `
  select
    (select count(*) from student_documents where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from admissions_form_documents where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from admissions_documents where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from learning_resources where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from learning_submission_attachments where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from pastoral_record_attachments where stored_object_id = $1 and deleted_at is null) +
    (select count(*) from safeguarding_attachments where stored_object_id = $1 and deleted_at is null)
    as n
`;

export type CleanupStoredObjectsResult = {
  examined: number;
  purged: number;
  skipped: number;
};

export async function cleanupStoredObjects(input: {
  owner: pg.Pool;
  storage: ObjectStoragePort;
  pendingMaxAgeHours?: number;
  rejectedRetentionDays?: number;
  deletedRetentionDays?: number;
  dryRun?: boolean;
}): Promise<CleanupStoredObjectsResult> {
  const pendingHours = input.pendingMaxAgeHours ?? 24;
  const rejectedDays = input.rejectedRetentionDays ?? 7;
  const deletedDays = input.deletedRetentionDays ?? 30;
  const rows = await input.owner.query<{
    id: string;
    storage_key: string;
    status: string;
    domain: string;
  }>(
    `select id, storage_key, status, domain
     from stored_objects
     where domain <> 'safeguarding'
       and (
         (status = 'pending' and coalesce(expires_at, created_at + make_interval(hours => $1)) < now())
         or (status = 'rejected' and coalesce(deleted_at, created_at) < now() - make_interval(days => $2))
         or (status = 'deleted' and deleted_at is not null and deleted_at < now() - make_interval(days => $3))
       )`,
    [pendingHours, rejectedDays, deletedDays],
  );

  let purged = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    if (row.domain === "safeguarding" || row.status === "active") {
      skipped += 1;
      continue;
    }
    if (row.status !== "pending") {
      const refs = await input.owner.query<{ n: string }>(REFERENCE_SQL, [row.id]);
      if (Number(refs.rows[0]?.n ?? 0) > 0) {
        skipped += 1;
        continue;
      }
    }
    if (input.dryRun) {
      purged += 1;
      continue;
    }
    await input.storage.deleteObject(row.storage_key).catch(() => undefined);
    await input.owner.query(
      `update stored_objects
          set status = 'deleted', deleted_at = coalesce(deleted_at, now())
        where id = $1 and domain <> 'safeguarding' and status <> 'active'`,
      [row.id],
    );
    await input.owner.query(
      `update admissions_form_documents set deleted_at = coalesce(deleted_at, now())
       where stored_object_id = $1 and deleted_at is null`,
      [row.id],
    );
    purged += 1;
  }
  return { examined: rows.rows.length, purged, skipped };
}
