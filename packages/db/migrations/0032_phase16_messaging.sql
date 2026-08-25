-- Phase 16: secure school messaging (parent–teacher and school conversations).
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, break-glass, audit, object-storage controls,
-- announcements, or Phase 15 payments.
-- Treats migrations 0001–0031 as immutable.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('messaging.read', 'Read school messaging conversations organisation-wide'),
  ('messaging.read_assigned', 'Read messaging conversations the staff member participates in'),
  ('messaging.create', 'Create school-wide parent and office conversations'),
  ('messaging.create_assigned', 'Create parent conversations for currently assigned pupils'),
  ('messaging.manage', 'Close, reopen, archive, and oversee school conversations'),
  ('messaging.moderate', 'Redact messages with audit (does not silently delete)'),
  ('messaging.read_own_children', 'Parent: read conversations for authorised children'),
  ('messaging.reply_own', 'Parent: reply to conversations they participate in'),
  ('messaging.staff_internal', 'Create and participate in staff-internal conversations'),
  ('messaging.admissions', 'Read and create admissions-related conversations')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'messaging.read'),
    ('school.admin', 'messaging.create'),
    ('school.admin', 'messaging.manage'),
    ('school.admin', 'messaging.moderate'),
    ('school.admin', 'messaging.staff_internal'),
    ('school.admin', 'messaging.admissions'),
    ('school.headteacher', 'messaging.read'),
    ('school.headteacher', 'messaging.create'),
    ('school.headteacher', 'messaging.manage'),
    ('school.headteacher', 'messaging.moderate'),
    ('school.headteacher', 'messaging.staff_internal'),
    ('school.headteacher', 'messaging.admissions'),
    ('school.teacher', 'messaging.read_assigned'),
    ('school.teacher', 'messaging.create_assigned'),
    ('school.teacher', 'messaging.staff_internal'),
    ('school.admissions', 'messaging.admissions'),
    ('school.parent', 'messaging.read_own_children'),
    ('school.parent', 'messaging.reply_own')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key like 'messaging.%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Notification types / categories
-- ---------------------------------------------------------------------------

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'homework_assigned',
    'homework_due',
    'result_published',
    'teacher_feedback',
    'school_announcement',
    'attendance_concern',
    'competition_challenge',
    'report_available',
    'admissions_update',
    'learning_assigned',
    'learning_due',
    'learning_feedback',
    'learning_resubmission',
    'announcement_published',
    'announcement_important',
    'announcement_acknowledgement',
    'calendar_upcoming',
    'pastoral_assigned',
    'safeguarding_assigned',
    'pastoral_follow_up',
    'behaviour_follow_up',
    'activity_published',
    'activity_updated',
    'activity_cancelled',
    'activity_consent_required',
    'activity_deadline',
    'activity_place_confirmed',
    'activity_waitlisted',
    'activity_promoted',
    'activity_assignment',
    'payment_request',
    'payment_due_soon',
    'payment_received',
    'payment_refunded',
    'payment_activity_required',
    'payment_refund_failed',
    'message_received',
    'general'
  ));

alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in (
    'homework',
    'results',
    'feedback',
    'announcement',
    'attendance',
    'competition',
    'reports',
    'admissions',
    'calendar',
    'behaviour',
    'pastoral',
    'safeguarding',
    'activities',
    'finance',
    'messaging',
    'general'
  ));

-- ---------------------------------------------------------------------------
-- Stored-object domain
-- ---------------------------------------------------------------------------

alter table stored_objects drop constraint if exists stored_objects_domain_check;
alter table stored_objects add constraint stored_objects_domain_check
  check (domain in (
    'admissions_form',
    'admissions_application',
    'student_document',
    'learning_resource',
    'learning_submission',
    'pastoral',
    'safeguarding',
    'activity',
    'message'
  ));

-- ---------------------------------------------------------------------------
-- Counters / references
-- ---------------------------------------------------------------------------

create table message_counters (
  organisation_id uuid primary key references organisations (id),
  last_value integer not null default 0
);

select install_tenant_isolation('message_counters');
grant select, insert, update on message_counters to schoolapp_app;

create or replace function next_message_reference(p_organisation_id uuid)
returns text
language plpgsql
as $$
declare
  v_next integer;
begin
  insert into message_counters (organisation_id, last_value)
  values (p_organisation_id, 1)
  on conflict (organisation_id)
  do update set last_value = message_counters.last_value + 1
  returning last_value into v_next;
  return 'MSG-' || lpad(v_next::text, 6, '0');
end;
$$;

revoke all on function next_message_reference(uuid) from public;
grant execute on function next_message_reference(uuid) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table message_conversations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null check (char_length(reference) between 3 and 32),
  conversation_type text not null
    check (conversation_type in ('parent_teacher', 'parent_school', 'admissions', 'staff_internal')),
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  related_pupil_id uuid references student_profiles (id),
  related_domain text not null default 'none'
    check (related_domain in (
      'none',
      'admissions_application',
      'school_charge',
      'school_activity',
      'learning_assignment',
      'attendance'
    )),
  related_record_id uuid,
  status text not null default 'open'
    check (status in ('open', 'closed', 'archived')),
  replies_restricted boolean not null default false,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_id uuid,
  last_message_preview text not null default '' check (char_length(last_message_preview) <= 140),
  closed_at timestamptz,
  closed_by uuid references users (id),
  unique (organisation_id, reference),
  check (
    conversation_type <> 'parent_teacher' or related_pupil_id is not null
  ),
  check (
    (related_domain = 'none' and related_record_id is null)
    or (related_domain <> 'none' and related_record_id is not null)
  )
);

create index message_conversations_org_activity_idx
  on message_conversations (organisation_id, last_message_at desc, id desc);
create index message_conversations_org_pupil_idx
  on message_conversations (organisation_id, related_pupil_id)
  where related_pupil_id is not null;
create index message_conversations_org_type_idx
  on message_conversations (organisation_id, conversation_type, status);

create trigger message_conversations_updated_at before update on message_conversations
  for each row execute function set_updated_at();

select install_tenant_isolation('message_conversations');
grant select, insert, update on message_conversations to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Participants (explicit history; current access is evaluated in application code)
-- ---------------------------------------------------------------------------

create table message_participants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  conversation_id uuid not null references message_conversations (id),
  user_id uuid not null references users (id),
  participant_kind text not null check (participant_kind in ('staff', 'parent')),
  added_by uuid not null references users (id),
  added_at timestamptz not null default now(),
  left_at timestamptz,
  archived_at timestamptz,
  last_read_at timestamptz,
  last_read_message_id uuid,
  unique (conversation_id, user_id)
);

create index message_participants_user_idx
  on message_participants (organisation_id, user_id, conversation_id);

select install_tenant_isolation('message_participants');
grant select, insert, update on message_participants to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Messages (immutable after send except controlled redaction flags)
-- ---------------------------------------------------------------------------

create table messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  conversation_id uuid not null references message_conversations (id),
  sender_user_id uuid not null references users (id),
  body text not null check (char_length(body) between 1 and 8000),
  message_type text not null default 'user'
    check (message_type in ('user', 'system')),
  sent_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by uuid references users (id)
);

create index messages_conversation_sent_idx
  on messages (conversation_id, sent_at, id);
create index messages_org_idx
  on messages (organisation_id, sent_at desc);

select install_tenant_isolation('messages');
grant select, insert, update on messages to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Attachments (metadata only; bytes live in stored_objects)
-- ---------------------------------------------------------------------------

create table message_attachments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  conversation_id uuid not null references message_conversations (id),
  message_id uuid not null references messages (id),
  stored_object_id uuid not null references stored_objects (id),
  original_filename text not null check (char_length(trim(original_filename)) between 1 and 255),
  created_at timestamptz not null default now(),
  unique (stored_object_id)
);

create index message_attachments_message_idx
  on message_attachments (message_id);
create index message_attachments_object_idx
  on message_attachments (stored_object_id);

select install_tenant_isolation('message_attachments');
grant select, insert on message_attachments to schoolapp_app;

alter table message_conversations
  add constraint message_conversations_last_message_fk
  foreign key (last_message_id) references messages (id)
  deferrable initially deferred;

alter table message_participants
  add constraint message_participants_last_read_message_fk
  foreign key (last_read_message_id) references messages (id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function school_messaging_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'message_conversations' and new.related_pupil_id is not null then
    select organisation_id into v_org from student_profiles where id = new.related_pupil_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'message_participants' then
    select organisation_id into v_org from message_conversations where id = new.conversation_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'messages' then
    select organisation_id into v_org from message_conversations where id = new.conversation_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'message_attachments' then
    select organisation_id into v_org from messages where id = new.message_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    select organisation_id into v_org from message_conversations where id = new.conversation_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    select organisation_id into v_org from stored_objects where id = new.stored_object_id;
    if v_org is null or v_org is distinct from new.organisation_id then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists message_conversations_org_tg on message_conversations;
create trigger message_conversations_org_tg
  before insert or update on message_conversations
  for each row execute function school_messaging_same_org_tg();

drop trigger if exists message_participants_org_tg on message_participants;
create trigger message_participants_org_tg
  before insert or update on message_participants
  for each row execute function school_messaging_same_org_tg();

drop trigger if exists messages_org_tg on messages;
create trigger messages_org_tg
  before insert or update on messages
  for each row execute function school_messaging_same_org_tg();

drop trigger if exists message_attachments_org_tg on message_attachments;
create trigger message_attachments_org_tg
  before insert or update on message_attachments
  for each row execute function school_messaging_same_org_tg();

-- Server-stamp actors. Clients cannot spoof created_by / sender / added_by.
create or replace function school_messaging_actor_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'message_conversations' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
    elsif new.created_by is null then
      raise exception 'messaging_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'message_participants' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.added_by := app_current_user_id();
    elsif new.added_by is null then
      raise exception 'messaging_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'messages' and tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.sender_user_id := app_current_user_id();
    elsif new.sender_user_id is null then
      raise exception 'messaging_actor_required' using errcode = '23514';
    end if;
  elsif tg_table_name = 'messages' and tg_op = 'UPDATE' then
    if new.redacted_at is not null and old.redacted_at is null and app_current_user_id() is not null then
      new.redacted_by := app_current_user_id();
    end if;
  elsif tg_table_name = 'message_conversations' and tg_op = 'UPDATE' then
    if new.status = 'closed' and old.status is distinct from 'closed' and app_current_user_id() is not null then
      new.closed_by := app_current_user_id();
      if new.closed_at is null then
        new.closed_at := now();
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists message_conversations_actor_tg on message_conversations;
create trigger message_conversations_actor_tg
  before insert or update on message_conversations
  for each row execute function school_messaging_actor_tg();

drop trigger if exists message_participants_actor_tg on message_participants;
create trigger message_participants_actor_tg
  before insert on message_participants
  for each row execute function school_messaging_actor_tg();

drop trigger if exists messages_actor_tg on messages;
create trigger messages_actor_tg
  before insert or update on messages
  for each row execute function school_messaging_actor_tg();

-- Messages are immutable after send. Redaction sets flags only; body is preserved server-side.
create or replace function school_messaging_immutable_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'message_immutable' using errcode = '23514';
  end if;
  if new.conversation_id is distinct from old.conversation_id
     or new.sender_user_id is distinct from old.sender_user_id
     or new.body is distinct from old.body
     or new.message_type is distinct from old.message_type
     or new.sent_at is distinct from old.sent_at
     or new.organisation_id is distinct from old.organisation_id then
    raise exception 'message_immutable' using errcode = '23514';
  end if;
  if old.redacted_at is not null and new.redacted_at is distinct from old.redacted_at then
    raise exception 'message_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_immutable_tg on messages;
create trigger messages_immutable_tg
  before update or delete on messages
  for each row execute function school_messaging_immutable_tg();

-- Staff-internal threads cannot include parent participants.
create or replace function school_messaging_participant_kind_tg()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select conversation_type into v_type
  from message_conversations
  where id = new.conversation_id;
  if v_type = 'staff_internal' and new.participant_kind = 'parent' then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists message_participants_kind_tg on message_participants;
create trigger message_participants_kind_tg
  before insert or update on message_participants
  for each row execute function school_messaging_participant_kind_tg();
