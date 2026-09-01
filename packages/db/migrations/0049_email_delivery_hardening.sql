-- Harden transactional email delivery for databases that already applied the
-- original 0048. Idempotent: CREATE OR REPLACE plus additive constraints.
-- Greenfield installs already have this logic from the revised 0048.

alter table mail_outbox
  drop constraint if exists mail_outbox_status_check;
alter table mail_outbox
  add constraint mail_outbox_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled'));

-- Phase 20 rows were inspectable local records, never SMTP-delivered.
-- Do not treat them as live queued work after 0048.
update public.mail_outbox
set
  status = 'sent',
  sent_at = coalesce(sent_at, created_at),
  provider_key = coalesce(nullif(provider_key, ''), 'legacy-phase20'),
  template_key = coalesce(template_key, 'legacy.outbox_record'),
  body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi'),
  action_url = null,
  updated_at = now()
where template_key is null
  and action_url is null
  and status = 'queued';

alter table mail_outbox
  drop constraint if exists mail_outbox_attempts_check;
alter table mail_outbox
  add constraint mail_outbox_attempts_check
  check (attempt_count >= 0 and max_attempts >= 1 and attempt_count <= 50);

create unique index if not exists mail_outbox_idempotency_idx
  on mail_outbox (coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'), idempotency_key)
  where idempotency_key is not null;

create index if not exists mail_outbox_delivery_idx
  on mail_outbox (status, next_retry_at, created_at)
  where status in ('queued', 'sending');

drop trigger if exists mail_outbox_updated_at on mail_outbox;
create trigger mail_outbox_updated_at before update on mail_outbox
  for each row execute function set_updated_at();

-- App role must not read one-time action URLs. Column grants hide action_url;
-- SECURITY DEFINER delivery functions can still read it until send completes.
revoke select on mail_outbox from schoolapp_app;
grant select (
  id, organisation_id, purpose, template_key, to_email, to_name, subject,
  body_text, metadata, created_at, updated_at, status, provider_key,
  provider_message_id, attempt_count, max_attempts, next_retry_at, sent_at,
  last_error_code, last_error_redacted, idempotency_key, from_address,
  from_name, reply_to
) on mail_outbox to schoolapp_app;

create or replace function enqueue_transactional_email(
  p_organisation_id uuid,
  p_purpose text,
  p_template_key text,
  p_to_email citext,
  p_to_name text,
  p_subject text,
  p_body_text text,
  p_metadata jsonb,
  p_idempotency_key text,
  p_action_url text,
  p_reply_to text,
  p_from_address text,
  p_from_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_existing uuid;
  v_text text;
begin
  if p_body_text ~* 'password\s*[:=]' or p_subject ~* 'password\s*[:=]' then
    raise exception 'mail_password_forbidden' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select id into v_existing
    from mail_outbox
    where coalesce(organisation_id, '00000000-0000-0000-0000-000000000000')
          = coalesce(p_organisation_id, '00000000-0000-0000-0000-000000000000')
      and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_text := coalesce(p_body_text, '');
  -- Never persist raw query tokens in the inspectable body. The live URL lives
  -- in action_url until send completes, then is wiped.
  v_text := regexp_replace(v_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi');

  begin
    insert into mail_outbox (
      organisation_id, purpose, template_key, to_email, to_name, subject, body_text,
      metadata, idempotency_key, action_url, reply_to, from_address, from_name, status
    ) values (
      p_organisation_id,
      p_purpose,
      p_template_key,
      p_to_email,
      p_to_name,
      p_subject,
      v_text,
      coalesce(p_metadata, '{}'::jsonb),
      p_idempotency_key,
      nullif(p_action_url, ''),
      nullif(p_reply_to, ''),
      nullif(p_from_address, ''),
      nullif(p_from_name, ''),
      'queued'
    )
    returning id into v_id;
  exception
    when unique_violation then
      select id into v_id
      from mail_outbox
      where coalesce(organisation_id, '00000000-0000-0000-0000-000000000000')
            = coalesce(p_organisation_id, '00000000-0000-0000-0000-000000000000')
        and idempotency_key = p_idempotency_key;
  end;

  -- Reissue / a newer reset must not leave a previous live action URL queued.
  if p_purpose in (
    'staff_invite',
    'parent_invite',
    'password_reset',
    'account_activation',
    'student_activation'
  ) then
    update mail_outbox
    set status = 'cancelled',
        action_url = null,
        last_error_code = 'superseded',
        last_error_redacted = 'Superseded by a newer invitation or reset email',
        next_retry_at = null,
        body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi')
    where coalesce(organisation_id, '00000000-0000-0000-0000-000000000000')
          = coalesce(p_organisation_id, '00000000-0000-0000-0000-000000000000')
      and purpose = p_purpose
      and to_email = p_to_email
      and status in ('queued', 'sending')
      and id <> v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function enqueue_transactional_email(
  uuid, text, text, citext, text, text, text, jsonb, text, text, text, text, text
) from public;
grant execute on function enqueue_transactional_email(
  uuid, text, text, citext, text, text, text, jsonb, text, text, text, text, text
) to schoolapp_app;

create or replace function enqueue_mail_message(
  p_organisation_id uuid,
  p_purpose text,
  p_to_email citext,
  p_to_name text,
  p_subject text,
  p_body_text text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return enqueue_transactional_email(
    p_organisation_id,
    p_purpose,
    null,
    p_to_email,
    p_to_name,
    p_subject,
    p_body_text,
    p_metadata,
    null,
    null,
    null,
    null,
    null
  );
end;
$$;

revoke all on function enqueue_mail_message(uuid, text, citext, text, text, text, jsonb) from public;
grant execute on function enqueue_mail_message(uuid, text, citext, text, text, text, jsonb) to schoolapp_app;

create or replace function expire_stale_mail_outbox()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update mail_outbox
  set status = 'cancelled',
      action_url = null,
      last_error_code = 'expired',
      last_error_redacted = 'Queued message expired before delivery',
      next_retry_at = null,
      body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi')
  where status in ('queued', 'sending')
    and (
      (purpose = 'password_reset' and created_at < now() - interval '2 days')
      or (
        purpose in ('staff_invite', 'parent_invite', 'account_activation', 'student_activation')
        and created_at < now() - interval '14 days'
      )
    );
end;
$$;

revoke all on function expire_stale_mail_outbox() from public;

create or replace function claim_mail_outbox_messages(p_limit integer default 10)
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
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    p_limit := 10;
  end if;

  perform expire_stale_mail_outbox();

  update mail_outbox
  set status = 'queued',
      last_error_code = coalesce(last_error_code, 'stale_sending'),
      last_error_redacted = 'Recovered a stale sending lock'
  where status = 'sending'
    and updated_at < now() - interval '5 minutes';

  return query
  with picked as (
    select mo.id
    from mail_outbox mo
    where mo.status = 'queued'
      and (mo.next_retry_at is null or mo.next_retry_at <= now())
    order by mo.created_at
    limit p_limit
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

revoke all on function claim_mail_outbox_messages(integer) from public;
grant execute on function claim_mail_outbox_messages(integer) to schoolapp_app;

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

create or replace function complete_mail_outbox_send(
  p_id uuid,
  p_provider_key text,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update mail_outbox
  set status = 'sent',
      sent_at = now(),
      provider_key = nullif(p_provider_key, ''),
      provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 200), ''),
      action_url = null,
      body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi'),
      last_error_code = null,
      last_error_redacted = null,
      next_retry_at = null
  where id = p_id
    and status = 'sending';
end;
$$;

revoke all on function complete_mail_outbox_send(uuid, text, text) from public;
grant execute on function complete_mail_outbox_send(uuid, text, text) to schoolapp_app;

create or replace function fail_mail_outbox_send(
  p_id uuid,
  p_retryable boolean,
  p_error_code text,
  p_redacted_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
  v_max integer;
  v_retry boolean;
  v_delay interval;
begin
  select attempt_count, max_attempts into v_attempts, v_max
  from mail_outbox
  where id = p_id
    and status = 'sending';
  if not found then
    return;
  end if;

  v_retry := coalesce(p_retryable, false) and v_attempts < v_max;
  v_delay := case v_attempts
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '25 minutes'
    when 4 then interval '2 hours'
    else interval '8 hours'
  end;

  update mail_outbox
  set status = case when v_retry then 'queued' else 'failed' end,
      next_retry_at = case when v_retry then now() + v_delay else null end,
      last_error_code = left(coalesce(nullif(p_error_code, ''), 'provider_error'), 80),
      last_error_redacted = left(coalesce(p_redacted_error, 'Delivery failed'), 300),
      action_url = case when v_retry then action_url else null end,
      body_text = case
        when v_retry then body_text
        else regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi')
      end
  where id = p_id
    and status = 'sending';
end;
$$;

revoke all on function fail_mail_outbox_send(uuid, boolean, text, text) from public;
grant execute on function fail_mail_outbox_send(uuid, boolean, text, text) to schoolapp_app;

