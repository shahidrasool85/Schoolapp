-- Transactional email delivery: extend the existing mail_outbox (Phase 20)
-- with queued/sent/failed/cancelled status, bounded retries, idempotency, and a
-- short-lived action URL that is wiped after send. Additive only.
-- Does not rewrite 0047 or earlier. Does not introduce a second mail table.
-- This is the complete unreleased email-delivery migration. There are no
-- follow-up 0049+ repair files; production at 0047 and a fresh database both
-- apply this file once.

alter table public.mail_outbox
  drop constraint if exists mail_outbox_purpose_check;

alter table public.mail_outbox
  add constraint mail_outbox_purpose_check
  check (purpose in (
    'staff_invite',
    'parent_invite',
    'password_reset',
    'account_activation',
    'student_activation',
    'admissions_application_received',
    'admissions_status_update'
  ));

alter table public.mail_outbox
  add column if not exists template_key text,
  add column if not exists status text not null default 'queued',
  add column if not exists provider_key text,
  add column if not exists provider_message_id text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_retry_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_redacted text,
  add column if not exists idempotency_key text,
  add column if not exists from_address text,
  add column if not exists from_name text,
  add column if not exists reply_to text,
  add column if not exists action_url text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.mail_outbox
  drop constraint if exists mail_outbox_status_check;
alter table public.mail_outbox
  add constraint mail_outbox_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled'));

-- Phase 20 rows were inspectable local records, never SMTP-delivered.
-- Do not treat them as live queued work after 0048. Invitation/reset tokens
-- live in invitations/account_tokens and are unchanged. Use cancelled rather
-- than sent so the row is not evidence that mail was actually delivered.
update public.mail_outbox
set
  status = 'cancelled',
  sent_at = null,
  provider_key = coalesce(nullif(provider_key, ''), 'legacy-phase20'),
  template_key = coalesce(template_key, 'legacy.outbox_record'),
  last_error_code = coalesce(last_error_code, 'legacy_unsent'),
  last_error_redacted = coalesce(
    last_error_redacted,
    'Local Phase 20 outbox record; email was not sent'
  ),
  body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi'),
  action_url = null,
  updated_at = now()
where template_key is null
  and action_url is null
  and status = 'queued';

alter table public.mail_outbox
  drop constraint if exists mail_outbox_attempts_check;
alter table public.mail_outbox
  add constraint mail_outbox_attempts_check
  check (attempt_count >= 0 and max_attempts >= 1 and attempt_count <= 50);

create unique index if not exists mail_outbox_idempotency_idx
  on public.mail_outbox (coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'), idempotency_key)
  where idempotency_key is not null;

create index if not exists mail_outbox_delivery_idx
  on public.mail_outbox (status, next_retry_at, created_at)
  where status in ('queued', 'sending');

drop trigger if exists mail_outbox_updated_at on public.mail_outbox;
create trigger mail_outbox_updated_at before update on public.mail_outbox
  for each row execute function public.set_updated_at();

-- App role must not read one-time action URLs. Column grants hide action_url;
-- SECURITY DEFINER delivery functions can still read it until send completes.
revoke select on public.mail_outbox from schoolapp_app;
grant select (
  id, organisation_id, purpose, template_key, to_email, to_name, subject,
  body_text, metadata, created_at, updated_at, status, provider_key,
  provider_message_id, attempt_count, max_attempts, next_retry_at, sent_at,
  last_error_code, last_error_redacted, idempotency_key, from_address,
  from_name, reply_to
) on public.mail_outbox to schoolapp_app;

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
  if public.app_current_organisation_id() is not null
     and p_organisation_id is distinct from public.app_current_organisation_id() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_body_text ~* 'password\s*[:=]' or p_subject ~* 'password\s*[:=]' then
    raise exception 'mail_password_forbidden' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select id into v_existing
    from public.mail_outbox
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
    insert into public.mail_outbox (
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
      from public.mail_outbox
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
    update public.mail_outbox
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
  update public.mail_outbox
  set status = 'cancelled',
      action_url = null,
      last_error_code = 'expired',
      last_error_redacted = 'Queued message expired before delivery',
      next_retry_at = null,
      body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi')
  where status in ('queued', 'sending')
    and (
      public.app_current_organisation_id() is null
      or organisation_id is not distinct from public.app_current_organisation_id()
    )
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
revoke all on function expire_stale_mail_outbox() from schoolapp_app;

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

  perform public.expire_stale_mail_outbox();

  -- Qualify every RETURNS TABLE name. Unqualified organisation_id/id here
  -- is ambiguous with the function's output columns.
  update public.mail_outbox as mo
  set status = 'queued',
      last_error_code = coalesce(mo.last_error_code, 'stale_sending'),
      last_error_redacted = 'Recovered a stale sending lock'
  where mo.status = 'sending'
    and mo.updated_at < now() - interval '5 minutes'
    and (
      public.app_current_organisation_id() is null
      or mo.organisation_id is not distinct from public.app_current_organisation_id()
    );

  return query
  with picked as (
    select mo.id
    from public.mail_outbox mo
    where mo.status = 'queued'
      and (mo.next_retry_at is null or mo.next_retry_at <= now())
      and (
        public.app_current_organisation_id() is null
        or mo.organisation_id is not distinct from public.app_current_organisation_id()
      )
    order by mo.created_at
    limit p_limit
    for update skip locked
  )
  update public.mail_outbox mo
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
  perform public.expire_stale_mail_outbox();

  -- Recover only stale sending locks. A live sending row is owned by another
  -- worker and must not be claimed again (that would double-send).
  -- Qualify RETURNS TABLE names (id, organisation_id) against the table.
  update public.mail_outbox as mo
  set status = 'queued',
      last_error_code = coalesce(mo.last_error_code, 'stale_sending'),
      last_error_redacted = 'Recovered a stale sending lock'
  where mo.id = p_id
    and mo.status = 'sending'
    and mo.updated_at < now() - interval '5 minutes'
    and (
      public.app_current_organisation_id() is null
      or mo.organisation_id is not distinct from public.app_current_organisation_id()
    );

  return query
  with picked as (
    select mo.id
    from public.mail_outbox mo
    where mo.id = p_id
      and mo.status = 'queued'
      and (
        public.app_current_organisation_id() is null
        or mo.organisation_id is not distinct from public.app_current_organisation_id()
      )
    for update skip locked
  )
  update public.mail_outbox mo
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
  update public.mail_outbox
  set status = 'sent',
      sent_at = now(),
      provider_key = nullif(p_provider_key, ''),
      provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 200), ''),
      action_url = null,
      body_text = regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi'),
      last_error_code = null,
      last_error_redacted = null,
      next_retry_at = null
  where public.mail_outbox.id = p_id
    and status = 'sending'
    and (
      public.app_current_organisation_id() is null
      or organisation_id is not distinct from public.app_current_organisation_id()
    );
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
  from public.mail_outbox
  where public.mail_outbox.id = p_id
    and status = 'sending'
    and (
      public.app_current_organisation_id() is null
      or organisation_id is not distinct from public.app_current_organisation_id()
    );
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

  update public.mail_outbox
  set status = case when v_retry then 'queued' else 'failed' end,
      next_retry_at = case when v_retry then now() + v_delay else null end,
      last_error_code = left(coalesce(nullif(p_error_code, ''), 'provider_error'), 80),
      last_error_redacted = left(coalesce(p_redacted_error, 'Delivery failed'), 300),
      action_url = case when v_retry then action_url else null end,
      body_text = case
        when v_retry then body_text
        else regexp_replace(body_text, '[?&]token=[^&\s#]+', '?token=redacted', 'gi')
      end
  where public.mail_outbox.id = p_id
    and status = 'sending'
    and (
      public.app_current_organisation_id() is null
      or organisation_id is not distinct from public.app_current_organisation_id()
    );
end;
$$;

revoke all on function fail_mail_outbox_send(uuid, boolean, text, text) from public;
grant execute on function fail_mail_outbox_send(uuid, boolean, text, text) to schoolapp_app;

create or replace function get_transactional_mail_context(p_organisation_id uuid)
returns table (
  organisation_name text,
  organisation_slug text,
  country_code char(2),
  contact_email text,
  primary_colour text,
  has_logo boolean,
  logo_version text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    o.name,
    o.slug,
    o.country_code,
    s.contact_email,
    s.primary_colour,
    exists (
      select 1 from stored_objects so
      where so.id = s.logo_object_id
        and so.organisation_id = o.id
        and so.domain = 'branding'
        and so.status = 'active'
        and so.deleted_at is null
    ),
    (
      select left(regexp_replace(coalesce(so.checksum_sha256, replace(so.id::text, '-', '')), '[^a-fA-F0-9]', '', 'g'), 16)
      from stored_objects so
      where so.id = s.logo_object_id
        and so.organisation_id = o.id
        and so.domain = 'branding'
        and so.status = 'active'
        and so.deleted_at is null
    )
  from organisations o
  join organisation_settings s on s.organisation_id = o.id
  where o.id = p_organisation_id
    and o.status = 'active'
    and (
      public.app_current_organisation_id() is null
      or o.id is not distinct from public.app_current_organisation_id()
    );
$$;

revoke all on function get_transactional_mail_context(uuid) from public;
grant execute on function get_transactional_mail_context(uuid) to schoolapp_app;

create or replace function requeue_mail_outbox_message(p_organisation_id uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if public.app_current_organisation_id() is not null
     and p_organisation_id is distinct from public.app_current_organisation_id() then
    return false;
  end if;
  update public.mail_outbox
  set status = 'queued',
      next_retry_at = now(),
      last_error_redacted = coalesce(last_error_redacted, 'Manually requeued')
  where public.mail_outbox.id = p_id
    and organisation_id = p_organisation_id
    and status in ('failed', 'queued')
    and (
      action_url is not null
      or purpose in ('admissions_application_received', 'admissions_status_update')
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function requeue_mail_outbox_message(uuid, uuid) from public;
grant execute on function requeue_mail_outbox_message(uuid, uuid) to schoolapp_app;

-- Public admissions form payload: safe branding from organisation_settings
-- (not extras JSON), school country for postcode UX, no organisation UUID.
create or replace function get_published_admissions_form(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_brand record;
begin
  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  select * into v_brand from get_public_school_branding(p_organisation_id);

  return jsonb_build_object(
    'form', jsonb_build_object(
      'publicId', v_form.public_id,
      'slug', v_form.slug,
      'formType', v_form.form_type,
      'name', v_form.name,
      'description', v_form.description,
      'opensAt', v_form.opens_at,
      'closesAt', v_form.closes_at,
      'successTitle', v_form.success_title,
      'successText', v_form.success_text,
      'privacyNoticeUrl', v_form.privacy_notice_url,
      'privacyNoticeText', v_form.privacy_notice_text,
      'allowedAcademicYearIds', to_jsonb(v_form.allowed_academic_year_ids),
      'allowedYearGroupIds', to_jsonb(v_form.allowed_year_group_ids)
    ),
    'organisation', jsonb_build_object(
      'slug', v_org.slug,
      'name', v_org.name,
      'countryCode', v_org.country_code
    ),
    'branding', jsonb_build_object(
      'primaryColor', v_brand.primary_colour,
      'tagline', v_brand.tagline,
      'hasLogo', coalesce(v_brand.has_logo, false),
      'logoUrl', case
        when coalesce(v_brand.has_logo, false)
          then '/api/v1/public/branding/logo' ||
            case
              when v_brand.logo_version is not null and v_brand.logo_version ~ '^[A-Za-z0-9]+$'
                then '?v=' || v_brand.logo_version
              else ''
            end
        else null
      end
    ),
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name) order by y.starts_on desc)
      from academic_years y
      where y.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) = 0
          or y.id = any (v_form.allowed_academic_year_ids)
        )
    ), '[]'::jsonb),
    'yearGroups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code) order by g.sort_order)
      from year_groups g
      where g.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_year_group_ids, 1), 0) = 0
          or g.id = any (v_form.allowed_year_group_ids)
        )
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sectionKey', s.section_key,
          'title', s.title,
          'helperText', s.helper_text,
          'sortOrder', s.sort_order,
          'fields', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'fieldKey', f.field_key,
                'fieldKind', f.field_kind,
                'canonicalKey', f.canonical_key,
                'questionType', f.question_type,
                'label', f.label,
                'helperText', f.helper_text,
                'required', f.required,
                'sortOrder', f.sort_order,
                'options', f.options,
                'documentPurpose', f.document_purpose
              )
              order by f.sort_order, f.label
            )
            from admissions_form_fields f
            where f.section_id = s.id and f.enabled
          ), '[]'::jsonb)
        )
        order by s.sort_order, s.title
      )
      from admissions_form_sections s
      where s.form_id = v_form.id
        and s.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function get_published_admissions_form(uuid, text, text) from public;
grant execute on function get_published_admissions_form(uuid, text, text) to schoolapp_app;
