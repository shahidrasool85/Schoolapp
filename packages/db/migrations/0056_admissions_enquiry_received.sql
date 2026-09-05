-- Add admissions enquiry acknowledgement to the existing mail_outbox.
-- Additive check-constraint value only. Does not rewrite queued/sent rows,
-- invite/reset/finance purposes, or application acknowledgements already stored.
-- No new table. App role still cannot INSERT into mail_outbox.

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
    'admissions_enquiry_received',
    'admissions_application_received',
    'admissions_status_update',
    'finance_invoice_issued',
    'finance_payment_received',
    'finance_payment_reminder',
    'finance_refund_issued'
  ));

-- School Admin retry on the existing Email delivery page (same as application acks).
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
      or purpose in (
        'admissions_enquiry_received',
        'admissions_application_received',
        'admissions_status_update'
      )
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function requeue_mail_outbox_message(uuid, uuid) from public;
grant execute on function requeue_mail_outbox_message(uuid, uuid) to schoolapp_app;
