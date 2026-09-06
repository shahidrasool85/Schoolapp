-- Per-organisation wording overrides for automatic transactional emails.
-- Additive. Existing schools keep the built-in templates until they save an override.
-- Delivery still uses mail_outbox / the existing worker / branded HTML+text shell.
-- Attachments are intentionally omitted (later B3 child table can FK this row).

create table organisation_transactional_email_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_key text not null,
  enabled boolean not null default true,
  subject text not null,
  heading text not null,
  greeting text not null,
  body_text text not null,
  signoff text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users (id) on delete set null,
  constraint organisation_transactional_email_templates_org_key unique (organisation_id, template_key),
  constraint organisation_transactional_email_templates_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received'
    )),
  constraint organisation_transactional_email_templates_subject_len
    check (char_length(subject) between 1 and 200),
  constraint organisation_transactional_email_templates_heading_len
    check (char_length(heading) between 1 and 120),
  constraint organisation_transactional_email_templates_greeting_len
    check (char_length(greeting) between 1 and 200),
  constraint organisation_transactional_email_templates_body_len
    check (char_length(body_text) between 1 and 4000),
  constraint organisation_transactional_email_templates_signoff_len
    check (char_length(signoff) between 1 and 400)
);

create trigger organisation_transactional_email_templates_updated_at
  before update on organisation_transactional_email_templates
  for each row execute function set_updated_at();

select install_tenant_isolation('organisation_transactional_email_templates');

grant select, insert, update, delete on organisation_transactional_email_templates to schoolapp_app;

-- Worker and public-form enqueue run without tenant GUC. Same pattern as
-- get_transactional_mail_context: allow when GUC is null or matches.
create or replace function get_organisation_transactional_email_template(
  p_organisation_id uuid,
  p_template_key text
)
returns table (
  id uuid,
  organisation_id uuid,
  template_key text,
  enabled boolean,
  subject text,
  heading text,
  greeting text,
  body_text text,
  signoff text,
  updated_at timestamptz,
  updated_by_user_id uuid
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    t.id,
    t.organisation_id,
    t.template_key,
    t.enabled,
    t.subject,
    t.heading,
    t.greeting,
    t.body_text,
    t.signoff,
    t.updated_at,
    t.updated_by_user_id
  from organisation_transactional_email_templates t
  where t.organisation_id = p_organisation_id
    and t.template_key = p_template_key
    and (
      public.app_current_organisation_id() is null
      or t.organisation_id is not distinct from public.app_current_organisation_id()
    );
$$;

revoke all on function get_organisation_transactional_email_template(uuid, text) from public;
grant execute on function get_organisation_transactional_email_template(uuid, text) to schoolapp_app;
