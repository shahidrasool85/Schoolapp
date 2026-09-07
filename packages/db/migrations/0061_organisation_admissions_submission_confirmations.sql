-- Per-organisation wording for public admissions submission confirmation pages.
-- Additive. Existing schools keep the built-in confirmation until they save an override.
-- These are website presentation settings, not outgoing emails. Do not mix into mail_outbox.

create table organisation_admissions_submission_confirmations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  template_key text not null,
  heading text not null,
  message_text text not null,
  additional_message text,
  button_label text,
  button_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users (id) on delete set null,
  constraint organisation_admissions_submission_confirmations_org_key
    unique (organisation_id, template_key),
  constraint organisation_admissions_submission_confirmations_key_check
    check (template_key in (
      'admissions_enquiry_submission_confirmation',
      'admissions_application_submission_confirmation'
    )),
  constraint organisation_admissions_submission_confirmations_heading_len
    check (char_length(heading) between 1 and 120),
  constraint organisation_admissions_submission_confirmations_message_len
    check (char_length(message_text) between 1 and 4000),
  constraint organisation_admissions_submission_confirmations_additional_len
    check (additional_message is null or char_length(additional_message) between 1 and 2000),
  constraint organisation_admissions_submission_confirmations_button_label_len
    check (button_label is null or char_length(button_label) between 1 and 80),
  constraint organisation_admissions_submission_confirmations_button_url_len
    check (button_url is null or char_length(button_url) between 8 and 2000),
  constraint organisation_admissions_submission_confirmations_button_pair
    check ((button_label is null) = (button_url is null)),
  constraint organisation_admissions_submission_confirmations_button_url_http
    check (button_url is null or button_url ~* '^https?://')
);

create trigger organisation_admissions_submission_confirmations_updated_at
  before update on organisation_admissions_submission_confirmations
  for each row execute function set_updated_at();

select install_tenant_isolation('organisation_admissions_submission_confirmations');

grant select, insert, update, delete on organisation_admissions_submission_confirmations to schoolapp_app;

-- Public form submit runs without tenant GUC. Same pattern as
-- get_organisation_transactional_email_template: allow when GUC is null or matches.
create or replace function get_organisation_admissions_submission_confirmation(
  p_organisation_id uuid,
  p_template_key text
)
returns table (
  id uuid,
  organisation_id uuid,
  template_key text,
  heading text,
  message_text text,
  additional_message text,
  button_label text,
  button_url text,
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
    t.heading,
    t.message_text,
    t.additional_message,
    t.button_label,
    t.button_url,
    t.updated_at,
    t.updated_by_user_id
  from organisation_admissions_submission_confirmations t
  where t.organisation_id = p_organisation_id
    and t.template_key = p_template_key
    and (
      public.app_current_organisation_id() is null
      or t.organisation_id is not distinct from public.app_current_organisation_id()
    );
$$;

revoke all on function get_organisation_admissions_submission_confirmation(uuid, text) from public;
grant execute on function get_organisation_admissions_submission_confirmation(uuid, text) to schoolapp_app;
