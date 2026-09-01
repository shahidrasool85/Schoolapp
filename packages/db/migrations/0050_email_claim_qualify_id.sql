-- Qualify mail_outbox.id in claim_mail_outbox_message.
-- RETURNS TABLE (id ...) made unqualified `id` ambiguous with the table column.

create or replace function claim_mail_outbox_message(p_id uuid)
returns table (
  id uuid,
  organisation_id uuid,
  purpose text,
  template_key text,
  to_email citext,
  to_name text,
  subject text,
  body_text text,
  metadata jsonb,
  action_url text,
  reply_to text,
  from_address text,
  from_name text,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform expire_stale_mail_outbox();

  -- Recover only stale sending locks. A live sending row is owned by another
  -- worker and must not be claimed again (that would double-send).
  update mail_outbox
  set status = 'queued',
      last_error_code = coalesce(last_error_code, 'stale_sending'),
      last_error_redacted = 'Recovered a stale sending lock'
  where mail_outbox.id = p_id
    and status = 'sending'
    and updated_at < now() - interval '5 minutes';

  return query
  with picked as (
    select mo.id
    from mail_outbox mo
    where mo.id = p_id
      and mo.status = 'queued'
    for update skip locked
  )
  update mail_outbox mo
  set status = 'sending',
      attempt_count = mo.attempt_count + 1
  from picked
  where mo.id = picked.id
  returning
    mo.id,
    mo.organisation_id,
    mo.purpose,
    mo.template_key,
    mo.to_email,
    mo.to_name,
    mo.subject,
    mo.body_text,
    mo.metadata,
    mo.action_url,
    mo.reply_to,
    mo.from_address,
    mo.from_name,
    mo.attempt_count,
    mo.max_attempts;
end;
$$;

revoke all on function claim_mail_outbox_message(uuid) from public;
grant execute on function claim_mail_outbox_message(uuid) to schoolapp_app;

