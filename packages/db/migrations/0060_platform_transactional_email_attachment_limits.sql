-- B3.1: platform-wide automatic-email attachment limits.
-- Additive. Production is through 0059. Existing attachment rows are not rewritten.
--
-- Limits are provider-aware in the application:
--   effective = min(configured platform value, active provider capability, application cap)
-- Current production is Postmark SMTP (10 MB encoded message => 7 MB raw attachments).
-- The database stores configured platform values and only enforces an application-wide
-- safety ceiling (25 MB). It must not hard-code Postmark's 7 MB as an irreversible
-- maximum; future SES SMTP/v2 (40 MB encoded) can raise the effective cap in app code.
--
-- Defaults remain Postmark-safe: 7 MB per file, 7 MB total, 5 attachments.

-- ---------------------------------------------------------------------------
-- Singleton platform settings (not tenant-scoped)
-- ---------------------------------------------------------------------------

create table platform_settings (
  id smallint primary key default 1 check (id = 1),
  transactional_email_attachment_max_bytes bigint not null
    default (7 * 1024 * 1024)
    check (
      transactional_email_attachment_max_bytes > 0
      and transactional_email_attachment_max_bytes <= 25 * 1024 * 1024
    ),
  transactional_email_attachments_max_total_bytes bigint not null
    default (7 * 1024 * 1024)
    check (
      transactional_email_attachments_max_total_bytes > 0
      and transactional_email_attachments_max_total_bytes <= 25 * 1024 * 1024
    ),
  transactional_email_attachments_max_count integer not null
    default 5
    check (
      transactional_email_attachments_max_count >= 1
      and transactional_email_attachments_max_count <= 10
    ),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users (id) on delete set null,
  constraint platform_settings_attachment_total_gte_per_file
    check (
      transactional_email_attachments_max_total_bytes
        >= transactional_email_attachment_max_bytes
    )
);

create trigger platform_settings_updated_at
  before update on platform_settings
  for each row execute function set_updated_at();

insert into platform_settings (id) values (1);

alter table platform_settings enable row level security;
alter table platform_settings force row level security;

-- Limits are not secret: School Admin UI and the delivery worker need to read them.
create policy platform_settings_select on platform_settings
  for select
  using (true);

grant select on platform_settings to schoolapp_app;

-- Writes go through the security-definer updater (platform admin only).
-- Application-cap checks live here. Active provider capability is enforced in the API.

create or replace function get_platform_transactional_email_attachment_limits()
returns table (
  max_bytes_per_file bigint,
  max_total_bytes bigint,
  max_count integer
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(
      (select s.transactional_email_attachment_max_bytes from platform_settings s where s.id = 1),
      7 * 1024 * 1024
    ),
    coalesce(
      (select s.transactional_email_attachments_max_total_bytes from platform_settings s where s.id = 1),
      7 * 1024 * 1024
    ),
    coalesce(
      (select s.transactional_email_attachments_max_count from platform_settings s where s.id = 1),
      5
    );
$$;

revoke all on function get_platform_transactional_email_attachment_limits() from public;
grant execute on function get_platform_transactional_email_attachment_limits() to schoolapp_app;

create or replace function update_platform_transactional_email_attachment_limits(
  p_actor_user_id uuid,
  p_max_bytes_per_file bigint,
  p_max_total_bytes bigint,
  p_max_count integer
)
returns table (
  max_bytes_per_file bigint,
  max_total_bytes bigint,
  max_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor_user_id) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if p_max_bytes_per_file is null or p_max_bytes_per_file <= 0 then
    raise exception 'attachment_limit_invalid' using errcode = '23514';
  end if;
  if p_max_total_bytes is null or p_max_total_bytes <= 0 then
    raise exception 'attachment_limit_invalid' using errcode = '23514';
  end if;
  if p_max_count is null or p_max_count <= 0 then
    raise exception 'attachment_limit_invalid' using errcode = '23514';
  end if;
  if p_max_bytes_per_file > 25 * 1024 * 1024
     or p_max_total_bytes > 25 * 1024 * 1024
     or p_max_count > 10 then
    raise exception 'attachment_limit_cap_exceeded' using errcode = '23514';
  end if;
  if p_max_total_bytes < p_max_bytes_per_file then
    raise exception 'attachment_limit_total_below_per_file' using errcode = '23514';
  end if;

  update platform_settings
     set transactional_email_attachment_max_bytes = p_max_bytes_per_file,
         transactional_email_attachments_max_total_bytes = p_max_total_bytes,
         transactional_email_attachments_max_count = p_max_count,
         updated_by_user_id = p_actor_user_id
   where id = 1;

  return query select * from get_platform_transactional_email_attachment_limits();
end;
$$;

revoke all on function update_platform_transactional_email_attachment_limits(uuid, bigint, bigint, integer) from public;
grant execute on function update_platform_transactional_email_attachment_limits(uuid, bigint, bigint, integer) to schoolapp_app;

-- Count trigger reads the live platform setting (capped at the application count cap).
-- Existing extra rows are not deleted when the configured count is lowered.
create or replace function enforce_transactional_email_attachment_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_max integer;
begin
  select coalesce(
    (select s.transactional_email_attachments_max_count from platform_settings s where s.id = 1),
    5
  ) into v_max;
  if v_max > 10 then
    v_max := 10;
  end if;
  if v_max < 1 then
    v_max := 5;
  end if;
  select count(*) into v_count
  from organisation_transactional_email_template_attachments
  where organisation_id = new.organisation_id
    and template_key = new.template_key
    and id is distinct from new.id;
  if v_count >= v_max then
    raise exception 'attachment_limit_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;
