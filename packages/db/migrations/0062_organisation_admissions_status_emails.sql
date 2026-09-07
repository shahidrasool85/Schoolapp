-- B4: configurable admissions APPLICATION status emails.
-- Additive. Extends the existing transactional template/settings/attachment model.
-- Does not rewrite mail_outbox, enquiry/application acknowledgements, or admissions
-- status history. Existing schools must not start sending status emails until a
-- School Admin enables each template.

-- ---------------------------------------------------------------------------
-- Allow status-email template keys on wording, presentation, and attachments.
-- ---------------------------------------------------------------------------

alter table organisation_transactional_email_templates
  drop constraint if exists organisation_transactional_email_templates_key_check;
alter table organisation_transactional_email_templates
  add constraint organisation_transactional_email_templates_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received',
      'admissions_status_assessment_pending',
      'admissions_status_waiting_list',
      'admissions_status_offer_made',
      'admissions_status_accepted',
      'admissions_status_enrolled',
      'admissions_status_rejected',
      'admissions_status_withdrawn'
    ));

alter table organisation_transactional_email_settings
  drop constraint if exists organisation_transactional_email_settings_key_check;
alter table organisation_transactional_email_settings
  add constraint organisation_transactional_email_settings_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received',
      'admissions_status_assessment_pending',
      'admissions_status_waiting_list',
      'admissions_status_offer_made',
      'admissions_status_accepted',
      'admissions_status_enrolled',
      'admissions_status_rejected',
      'admissions_status_withdrawn'
    ));

alter table organisation_transactional_email_template_attachments
  drop constraint if exists organisation_transactional_email_template_attachments_key_check;
alter table organisation_transactional_email_template_attachments
  add constraint organisation_transactional_email_template_attachments_key_check
    check (template_key in (
      'admissions_enquiry_received',
      'admissions_application_received',
      'admissions_status_assessment_pending',
      'admissions_status_waiting_list',
      'admissions_status_offer_made',
      'admissions_status_accepted',
      'admissions_status_enrolled',
      'admissions_status_rejected',
      'admissions_status_withdrawn'
    ));

-- Send on/off lives on the B3 settings row so "Use system default" (DELETE of the
-- wording row) cannot reset it. Default false: existing logo/attachment rows and
-- new status templates stay silent until School Admin enables sending.
-- Enquiry/application acknowledgements ignore this column and keep sending.
alter table organisation_transactional_email_settings
  add column if not exists send_enabled boolean not null default false;

drop function if exists get_organisation_transactional_email_settings(uuid, text);

create or replace function get_organisation_transactional_email_settings(
  p_organisation_id uuid,
  p_template_key text
)
returns table (
  show_school_logo boolean,
  send_enabled boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(s.show_school_logo, true) as show_school_logo,
    coalesce(s.send_enabled, false) as send_enabled
  from (select p_organisation_id as organisation_id, p_template_key as template_key) p
  left join organisation_transactional_email_settings s
    on s.organisation_id = p.organisation_id
   and s.template_key = p.template_key
   and (
     public.app_current_organisation_id() is null
     or s.organisation_id is not distinct from public.app_current_organisation_id()
   );
$$;

revoke all on function get_organisation_transactional_email_settings(uuid, text) from public;
grant execute on function get_organisation_transactional_email_settings(uuid, text) to schoolapp_app;
