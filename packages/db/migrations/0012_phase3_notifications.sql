-- Phase 3: tenant-safe in-app notification inbox.
-- No email, SMS, or push delivery. Does not weaken FORCE RLS, tenant context,
-- restricted_contact isolation, or existing parent/teacher access rules.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  recipient_user_id uuid not null references users (id),
  type text not null
    check (type in (
      'homework_assigned',
      'homework_due',
      'result_published',
      'teacher_feedback',
      'school_announcement',
      'attendance_concern',
      'competition_challenge',
      'report_available',
      'general'
    )),
  category text not null
    check (category in (
      'homework',
      'results',
      'feedback',
      'announcement',
      'attendance',
      'competition',
      'reports',
      'general'
    )),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  body text not null
    check (char_length(trim(body)) between 1 and 500),
  action_target jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references users (id)
);

create index notifications_inbox_idx
  on notifications (organisation_id, recipient_user_id, created_at desc);

create index notifications_unread_idx
  on notifications (organisation_id, recipient_user_id)
  where read_at is null;

alter table notifications enable row level security;
alter table notifications force row level security;

-- Combined tenant + recipient policies. Do not also call install_tenant_isolation
-- here: multiple PERMISSIVE policies OR together and would leak same-school inboxes.

create policy notifications_select_own
  on notifications
  for select
  using (
    app_tenant_matches(organisation_id)
    and recipient_user_id = app_current_user_id()
  );

create policy notifications_update_own_read_state
  on notifications
  for update
  using (
    app_tenant_matches(organisation_id)
    and recipient_user_id = app_current_user_id()
  )
  with check (
    app_tenant_matches(organisation_id)
    and recipient_user_id = app_current_user_id()
  );

-- Recipients may read their inbox and mark items read. They cannot insert,
-- delete, or change title/body/recipient. Future producers (LMS, announcements)
-- will insert as owner or via a SECURITY DEFINER function.

grant select on notifications to schoolapp_app;
grant update (read_at) on notifications to schoolapp_app;

insert into permissions (key, description) values
  ('notifications.inbox.read', 'Read own in-app notification inbox')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, 'notifications.inbox.read'
from roles r
where r.organisation_id is null
  and r.key in (
    'school.admin',
    'school.headteacher',
    'school.teacher',
    'school.admissions',
    'school.staff',
    'school.parent',
    'school.student'
  )
on conflict do nothing;
