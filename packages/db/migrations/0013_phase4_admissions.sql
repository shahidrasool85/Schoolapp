-- Phase 4: admissions workflow (enquiry → application → offer → enrolment).
-- Does not weaken FORCE RLS, tenant context, identity, guardianship, or portal-access rules.
-- Applicants are not enrolled students until enrol_admitted_applicant runs.

-- ---------------------------------------------------------------------------
-- Notification types for admissions events (in-app only; no email/SMS/push)
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
    'general'
  ));

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('admissions.read', 'Read admissions dashboard, enquiries, applications, assessments, waiting list and offers'),
  ('admissions.decide', 'Make admissions decisions (waitlist, offer, accept, reject, defer)'),
  ('admissions.convert', 'Convert an accepted applicant into an enrolled student')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'admissions.read'),
    ('school.admin', 'admissions.decide'),
    ('school.admin', 'admissions.convert'),
    ('school.headteacher', 'admissions.read'),
    ('school.headteacher', 'admissions.decide'),
    ('school.admissions', 'admissions.read'),
    ('school.admissions', 'admissions.decide'),
    ('school.admissions', 'admissions.convert')
) as x(role_key, perm) on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Reference counters
-- ---------------------------------------------------------------------------

create table admissions_counters (
  organisation_id uuid not null references organisations (id),
  kind text not null check (kind in ('enquiry', 'application')),
  year integer not null,
  last_value integer not null default 0,
  primary key (organisation_id, kind, year)
);

select install_tenant_isolation('admissions_counters');
grant select, insert, update on admissions_counters to schoolapp_app;

create or replace function next_admissions_reference(
  p_organisation_id uuid,
  p_kind text
)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_n int;
  v_prefix text;
begin
  if p_kind not in ('enquiry', 'application') then
    raise exception 'invalid_admissions_kind' using errcode = '22023';
  end if;
  if p_organisation_id is distinct from app_current_organisation_id() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  v_prefix := case p_kind when 'enquiry' then 'ENQ' else 'APP' end;
  insert into admissions_counters (organisation_id, kind, year, last_value)
  values (p_organisation_id, p_kind, v_year, 1)
  on conflict (organisation_id, kind, year)
  do update set last_value = admissions_counters.last_value + 1
  returning last_value into v_n;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 4, '0');
end;
$$;

revoke all on function next_admissions_reference(uuid, text) from public;
grant execute on function next_admissions_reference(uuid, text) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------

create table admissions_enquiries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null,
  status text not null default 'open'
    check (status in ('open', 'contacted', 'converted', 'closed', 'withdrawn')),
  pupil_legal_name text not null,
  pupil_preferred_name text,
  date_of_birth date,
  intended_academic_year_id uuid references academic_years (id),
  intended_year_group_id uuid references year_groups (id),
  guardian_full_name text not null,
  guardian_email citext,
  guardian_telephone text,
  enquiry_date date not null default current_date,
  source text,
  notes text,
  assigned_staff_profile_id uuid references staff_profiles (id),
  converted_application_id uuid,
  extra_fields jsonb not null default '{}'::jsonb,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference)
);

create index admissions_enquiries_org_status_idx
  on admissions_enquiries (organisation_id, status, enquiry_date desc);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table admissions_applications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  reference text not null,
  enquiry_id uuid references admissions_enquiries (id),
  status text not null default 'draft'
    check (status in (
      'enquiry',
      'draft',
      'submitted',
      'under_review',
      'information_required',
      'assessment_pending',
      'assessment_completed',
      'waiting_list',
      'offer_pending',
      'offer_made',
      'accepted',
      'deferred',
      'rejected',
      'withdrawn',
      'enrolled'
    )),
  pupil_legal_name text not null,
  pupil_preferred_name text,
  date_of_birth date,
  intended_academic_year_id uuid references academic_years (id),
  intended_year_group_id uuid references year_groups (id),
  intended_entry_date date,
  previous_school text,
  current_school text,
  application_date date,
  submitted_at timestamptz,
  source text,
  internal_notes text,
  assigned_staff_profile_id uuid references staff_profiles (id),
  converted_student_profile_id uuid references student_profiles (id),
  converted_at timestamptz,
  converted_by uuid references users (id),
  extra_fields jsonb not null default '{}'::jsonb,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference)
);

create unique index admissions_applications_converted_student_idx
  on admissions_applications (converted_student_profile_id)
  where converted_student_profile_id is not null;

create unique index admissions_applications_enquiry_idx
  on admissions_applications (enquiry_id)
  where enquiry_id is not null;

create index admissions_applications_org_status_idx
  on admissions_applications (organisation_id, status, created_at desc);

alter table admissions_enquiries
  add constraint admissions_enquiries_converted_application_fk
  foreign key (converted_application_id) references admissions_applications (id);

alter table student_profiles
  add column if not exists admitted_from_application_id uuid;

alter table student_profiles
  add constraint student_profiles_admitted_from_application_fk
  foreign key (admitted_from_application_id) references admissions_applications (id);

create unique index student_profiles_admitted_from_application_idx
  on student_profiles (admitted_from_application_id)
  where admitted_from_application_id is not null;

-- ---------------------------------------------------------------------------
-- Contacts (not guardianships; conversion links them deliberately)
-- ---------------------------------------------------------------------------

create table admissions_application_contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  full_name text not null,
  email citext,
  telephone text,
  relationship text not null default 'other',
  is_primary boolean not null default false,
  has_parental_responsibility boolean not null default false,
  user_id uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index admissions_application_contacts_app_idx
  on admissions_application_contacts (application_id);

create unique index admissions_application_contacts_one_primary
  on admissions_application_contacts (application_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- Status history (append-only for the app role)
-- ---------------------------------------------------------------------------

create table admissions_application_status_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  actor_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create index admissions_application_status_history_app_idx
  on admissions_application_status_history (application_id, created_at);

-- ---------------------------------------------------------------------------
-- Assessments / interviews (lightweight; not an exam engine)
-- ---------------------------------------------------------------------------

create table admissions_assessments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  assessment_type text not null
    check (assessment_type in (
      'admissions_interview',
      'academic_assessment',
      'school_visit',
      'eleven_plus',
      'other'
    )),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  assigned_staff_profile_id uuid references staff_profiles (id),
  notes text,
  outcome text,
  recommendation text
    check (recommendation is null or recommendation in (
      'offer',
      'waitlist',
      'reject',
      'further_assessment',
      'defer',
      'undecided'
    )),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index admissions_assessments_app_idx
  on admissions_assessments (organisation_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Waiting list (no automatic ranking / FCFS)
-- ---------------------------------------------------------------------------

create table admissions_waiting_list_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  intended_academic_year_id uuid references academic_years (id),
  intended_year_group_id uuid references year_groups (id),
  status text not null default 'active'
    check (status in ('active', 'offered', 'removed', 'enrolled')),
  priority integer,
  notes text,
  added_at timestamptz not null default now(),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index admissions_waiting_list_one_active
  on admissions_waiting_list_entries (application_id)
  where status = 'active';

create index admissions_waiting_list_org_idx
  on admissions_waiting_list_entries (organisation_id, intended_academic_year_id, intended_year_group_id);

-- ---------------------------------------------------------------------------
-- Offers (no payments / deposits)
-- ---------------------------------------------------------------------------

create table admissions_offers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  status text not null default 'made'
    check (status in ('made', 'accepted', 'declined', 'expired', 'withdrawn')),
  offered_academic_year_id uuid references academic_years (id),
  offered_year_group_id uuid references year_groups (id),
  intended_start_date date,
  offer_made_on date not null default current_date,
  response_deadline date,
  accepted_at timestamptz,
  declined_at timestamptz,
  notes text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index admissions_offers_one_open
  on admissions_offers (application_id)
  where status = 'made';

create index admissions_offers_org_idx
  on admissions_offers (organisation_id, status, offer_made_on desc);

-- ---------------------------------------------------------------------------
-- Document metadata only (object-storage key; no blobs in Postgres)
-- ---------------------------------------------------------------------------

create table admissions_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  application_id uuid not null references admissions_applications (id) on delete cascade,
  storage_key text not null,
  original_filename text,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  purpose text not null default 'supporting'
    check (purpose in ('supporting', 'assessment', 'offer', 'other')),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (organisation_id, storage_key)
);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger admissions_enquiries_updated_at before update on admissions_enquiries
  for each row execute function set_updated_at();
create trigger admissions_applications_updated_at before update on admissions_applications
  for each row execute function set_updated_at();
create trigger admissions_application_contacts_updated_at before update on admissions_application_contacts
  for each row execute function set_updated_at();
create trigger admissions_assessments_updated_at before update on admissions_assessments
  for each row execute function set_updated_at();
create trigger admissions_waiting_list_entries_updated_at before update on admissions_waiting_list_entries
  for each row execute function set_updated_at();
create trigger admissions_offers_updated_at before update on admissions_offers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-organisation integrity
-- ---------------------------------------------------------------------------

create or replace function admissions_same_org_year_group(
  p_organisation_id uuid,
  p_academic_year_id uuid,
  p_year_group_id uuid,
  p_staff_profile_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_academic_year_id is not null and not exists (
    select 1 from academic_years y
    where y.id = p_academic_year_id and y.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = p_year_group_id and g.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_staff_profile_id is not null and not exists (
    select 1 from staff_profiles s
    where s.id = p_staff_profile_id and s.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function admissions_enquiries_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform admissions_same_org_year_group(
    new.organisation_id,
    new.intended_academic_year_id,
    new.intended_year_group_id,
    new.assigned_staff_profile_id
  );
  if new.converted_application_id is not null and not exists (
    select 1 from admissions_applications a
    where a.id = new.converted_application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if char_length(trim(new.pupil_legal_name)) < 1 or char_length(trim(new.guardian_full_name)) < 1 then
    raise exception 'admissions_name_required' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger admissions_enquiries_integrity_tg
  before insert or update on admissions_enquiries
  for each row execute function admissions_enquiries_integrity_tg();

create or replace function admissions_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case
    when p_from is not distinct from p_to then true
    when p_to = 'enrolled' then p_from = 'accepted'
    when p_from = 'enquiry' then p_to in ('draft', 'submitted', 'withdrawn')
    when p_from = 'draft' then p_to in ('submitted', 'withdrawn')
    when p_from = 'submitted' then p_to in ('under_review', 'information_required', 'withdrawn')
    when p_from = 'under_review' then p_to in (
      'information_required', 'assessment_pending', 'offer_pending', 'offer_made', 'waiting_list',
      'rejected', 'withdrawn', 'deferred'
    )
    when p_from = 'information_required' then p_to in ('submitted', 'under_review', 'withdrawn')
    when p_from = 'assessment_pending' then p_to in (
      'assessment_completed', 'under_review', 'withdrawn', 'rejected'
    )
    when p_from = 'assessment_completed' then p_to in (
      'under_review', 'offer_pending', 'offer_made', 'waiting_list', 'rejected', 'withdrawn'
    )
    when p_from = 'waiting_list' then p_to in (
      'offer_pending', 'offer_made', 'under_review', 'rejected', 'withdrawn', 'deferred'
    )
    when p_from = 'offer_pending' then p_to in ('offer_made', 'waiting_list', 'withdrawn', 'rejected')
    when p_from = 'offer_made' then p_to in ('accepted', 'rejected', 'withdrawn', 'waiting_list')
    when p_from = 'accepted' then p_to in ('withdrawn', 'enrolled')
    when p_from = 'deferred' then p_to in (
      'under_review', 'waiting_list', 'withdrawn', 'rejected', 'offer_pending'
    )
    when p_from = 'rejected' then p_to in ('under_review')
    when p_from = 'withdrawn' then p_to in ('draft', 'under_review')
    else false
  end;
$$;

create or replace function admissions_applications_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform admissions_same_org_year_group(
    new.organisation_id,
    new.intended_academic_year_id,
    new.intended_year_group_id,
    new.assigned_staff_profile_id
  );
  if new.enquiry_id is not null and not exists (
    select 1 from admissions_enquiries e
    where e.id = new.enquiry_id and e.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.converted_student_profile_id is not null and not exists (
    select 1 from student_profiles s
    where s.id = new.converted_student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not admissions_status_transition_allowed(old.status, new.status) then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if new.status = 'enrolled'
       and coalesce(nullif(current_setting('app.admissions_enrol', true), ''), 'false') <> 'true' then
      raise exception 'admissions_enrolment_required' using errcode = '22023';
    end if;
  end if;
  if char_length(trim(new.pupil_legal_name)) < 1 then
    raise exception 'admissions_name_required' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger admissions_applications_integrity_tg
  before insert or update on admissions_applications
  for each row execute function admissions_applications_integrity_tg();

create or replace function admissions_applications_history_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into admissions_application_status_history (
      organisation_id, application_id, previous_status, new_status, reason, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      null,
      new.status,
      nullif(current_setting('app.admissions_transition_reason', true), ''),
      app_current_user_id()
    );
  elsif new.status is distinct from old.status then
    insert into admissions_application_status_history (
      organisation_id, application_id, previous_status, new_status, reason, actor_user_id
    ) values (
      new.organisation_id,
      new.id,
      old.status,
      new.status,
      nullif(current_setting('app.admissions_transition_reason', true), ''),
      coalesce(new.converted_by, app_current_user_id())
    );
  end if;
  return new;
end;
$$;

create trigger admissions_applications_history_tg
  after insert or update of status on admissions_applications
  for each row execute function admissions_applications_history_tg();

create or replace function admissions_waiting_list_sync_tg()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'waiting_list' then
    insert into admissions_waiting_list_entries (
      organisation_id, application_id, intended_academic_year_id, intended_year_group_id,
      status, created_by
    )
    select new.organisation_id, new.id, new.intended_academic_year_id, new.intended_year_group_id,
           'active', app_current_user_id()
    where not exists (
      select 1 from admissions_waiting_list_entries w
      where w.application_id = new.id and w.status = 'active'
    );
  elsif old.status = 'waiting_list' and new.status is distinct from 'waiting_list' then
    update admissions_waiting_list_entries
    set status = case new.status
      when 'offer_made' then 'offered'
      when 'offer_pending' then 'offered'
      when 'enrolled' then 'enrolled'
      else 'removed'
    end
    where application_id = new.id
      and organisation_id = new.organisation_id
      and status = 'active';
  end if;
  return new;
end;
$$;

create trigger admissions_waiting_list_sync_tg
  after update of status on admissions_applications
  for each row execute function admissions_waiting_list_sync_tg();

create or replace function admissions_child_application_org_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_applications a
    where a.id = new.application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger admissions_application_contacts_org_tg
  before insert or update on admissions_application_contacts
  for each row execute function admissions_child_application_org_tg();

create trigger admissions_application_status_history_org_tg
  before insert or update on admissions_application_status_history
  for each row execute function admissions_child_application_org_tg();

create trigger admissions_documents_org_tg
  before insert or update on admissions_documents
  for each row execute function admissions_child_application_org_tg();

create or replace function admissions_assessments_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_applications a
    where a.id = new.application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.assigned_staff_profile_id is not null and not exists (
    select 1 from staff_profiles s
    where s.id = new.assigned_staff_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger admissions_assessments_integrity_tg
  before insert or update on admissions_assessments
  for each row execute function admissions_assessments_integrity_tg();

create or replace function admissions_waiting_list_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_applications a
    where a.id = new.application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform admissions_same_org_year_group(
    new.organisation_id,
    new.intended_academic_year_id,
    new.intended_year_group_id,
    null
  );
  return new;
end;
$$;

create trigger admissions_waiting_list_integrity_tg
  before insert or update on admissions_waiting_list_entries
  for each row execute function admissions_waiting_list_integrity_tg();

create or replace function admissions_offers_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from admissions_applications a
    where a.id = new.application_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform admissions_same_org_year_group(
    new.organisation_id,
    new.offered_academic_year_id,
    new.offered_year_group_id,
    null
  );
  return new;
end;
$$;

create trigger admissions_offers_integrity_tg
  before insert or update on admissions_offers
  for each row execute function admissions_offers_integrity_tg();

create or replace function student_profiles_admitted_from_org_tg()
returns trigger
language plpgsql
as $$
begin
  if new.admitted_from_application_id is not null and not exists (
    select 1 from admissions_applications a
    where a.id = new.admitted_from_application_id
      and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists student_profiles_admitted_from_org_tg on student_profiles;
create trigger student_profiles_admitted_from_org_tg
  before insert or update of admitted_from_application_id on student_profiles
  for each row execute function student_profiles_admitted_from_org_tg();

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

select install_tenant_isolation('admissions_enquiries');
select install_tenant_isolation('admissions_applications');
select install_tenant_isolation('admissions_application_contacts');
select install_tenant_isolation('admissions_application_status_history');
select install_tenant_isolation('admissions_assessments');
select install_tenant_isolation('admissions_waiting_list_entries');
select install_tenant_isolation('admissions_offers');
select install_tenant_isolation('admissions_documents');

grant select, insert, update on
  admissions_enquiries,
  admissions_applications,
  admissions_application_contacts,
  admissions_assessments,
  admissions_waiting_list_entries,
  admissions_offers,
  admissions_documents
to schoolapp_app;

grant select, insert on admissions_application_status_history to schoolapp_app;
revoke update, delete on admissions_application_status_history from schoolapp_app;

-- ---------------------------------------------------------------------------
-- Inbox producer (app role cannot INSERT notifications directly)
-- ---------------------------------------------------------------------------

create or replace function create_inbox_notification(
  p_organisation_id uuid,
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_type text,
  p_category text,
  p_title text,
  p_body text,
  p_action_target jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_organisation_id is distinct from app_current_organisation_id()
     and not (
       app_is_platform_admin()
       and app_current_organisation_id() is null
     ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_recipient_user_id is null or char_length(trim(p_title)) < 1 or char_length(trim(p_body)) < 1 then
    return null;
  end if;
  if not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_recipient_user_id
      and m.status in ('active', 'invited')
      and m.ended_at is null
  ) then
    return null;
  end if;

  insert into notifications (
    organisation_id, recipient_user_id, type, category, title, body, action_target, created_by
  ) values (
    p_organisation_id,
    p_recipient_user_id,
    coalesce(p_type, 'admissions_update'),
    coalesce(p_category, 'admissions'),
    left(trim(p_title), 200),
    left(trim(p_body), 500),
    p_action_target,
    p_actor_user_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function create_inbox_notification(
  uuid, uuid, uuid, text, text, text, text, jsonb
) from public;
grant execute on function create_inbox_notification(
  uuid, uuid, uuid, text, text, text, text, jsonb
) to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Conversion: accepted applicant → canonical student (idempotent)
-- ---------------------------------------------------------------------------

create or replace function enrol_admitted_applicant(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_application_id uuid,
  p_academic_year_id uuid,
  p_year_group_id uuid,
  p_class_id uuid,
  p_admission_number text,
  p_existing_student_profile_id uuid,
  p_guardian_links jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app admissions_applications%rowtype;
  v_profile_id uuid;
  v_link jsonb;
  v_contact admissions_application_contacts%rowtype;
  v_portal boolean;
begin
  if not actor_has_permission(p_actor_user_id, p_organisation_id, 'admissions.convert') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_app
  from admissions_applications
  where id = p_application_id and organisation_id = p_organisation_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_app.converted_student_profile_id is not null then
    return v_app.converted_student_profile_id;
  end if;
  select id into v_profile_id
  from student_profiles
  where admitted_from_application_id = p_application_id
    and organisation_id = p_organisation_id;
  if v_profile_id is not null then
    perform set_config('app.admissions_enrol', 'true', true);
    update admissions_applications
    set converted_student_profile_id = v_profile_id,
        converted_at = coalesce(converted_at, now()),
        converted_by = coalesce(converted_by, p_actor_user_id),
        status = 'enrolled'
    where id = p_application_id and converted_student_profile_id is null;
    return v_profile_id;
  end if;
  if v_app.status is distinct from 'accepted' then
    raise exception 'application_not_accepted' using errcode = '22023';
  end if;

  if p_academic_year_id is not null and not exists (
    select 1 from academic_years y
    where y.id = p_academic_year_id and y.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_year_group_id is not null and not exists (
    select 1 from year_groups g
    where g.id = p_year_group_id and g.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if p_class_id is not null then
    if p_academic_year_id is null then
      raise exception 'year_group_required' using errcode = '22023';
    end if;
    if not exists (
      select 1 from classes c
      where c.id = p_class_id
        and c.organisation_id = p_organisation_id
        and c.academic_year_id = p_academic_year_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;

  if p_existing_student_profile_id is not null then
    select id into v_profile_id
    from student_profiles
    where id = p_existing_student_profile_id
      and organisation_id = p_organisation_id;
    if not found then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if exists (
      select 1 from admissions_applications a
      where a.converted_student_profile_id = v_profile_id
        and a.id is distinct from p_application_id
    ) then
      raise exception 'application_already_converted' using errcode = '23505';
    end if;
    if p_academic_year_id is not null and p_year_group_id is not null
       and not exists (
         select 1 from student_enrolments se
         where se.student_profile_id = v_profile_id
           and se.academic_year_id = p_academic_year_id
           and se.is_primary
           and se.ended_on is null
       ) then
      insert into student_enrolments (
        organisation_id, student_profile_id, academic_year_id, year_group_id,
        status, is_primary, placement_kind, started_on
      )
      select p_organisation_id, v_profile_id, p_academic_year_id, p_year_group_id,
             'enrolled', true, 'primary', y.starts_on
      from academic_years y
      where y.id = p_academic_year_id;
    end if;
    if p_class_id is not null and not exists (
      select 1 from class_memberships cm
      where cm.student_profile_id = v_profile_id
        and cm.class_id = p_class_id
        and cm.ended_on is null
    ) then
      insert into class_memberships (
        organisation_id, class_id, student_profile_id, academic_year_id, started_on
      )
      select p_organisation_id, p_class_id, v_profile_id, p_academic_year_id, y.starts_on
      from academic_years y
      where y.id = p_academic_year_id;
    end if;
    update student_profiles
    set enrolment_status = 'enrolled',
        admitted_from_application_id = coalesce(admitted_from_application_id, p_application_id),
        legal_name = coalesce(nullif(legal_name, ''), v_app.pupil_legal_name),
        admission_number = coalesce(admission_number, nullif(trim(p_admission_number), '')),
        updated_at = now()
    where id = v_profile_id;
  else
    v_profile_id := provision_student(
      p_actor_user_id,
      p_organisation_id,
      v_app.pupil_legal_name,
      v_app.pupil_preferred_name,
      p_admission_number,
      v_app.date_of_birth,
      p_academic_year_id,
      p_year_group_id,
      p_class_id,
      null,
      null,
      null
    );
    update student_profiles
    set admitted_from_application_id = p_application_id,
        enrolment_status = case when p_academic_year_id is null then 'admitted' else 'enrolled' end
    where id = v_profile_id;
  end if;

  perform set_config('app.admissions_enrol', 'true', true);
  perform set_config('app.admissions_transition_reason', 'Converted to enrolled student', true);

  update admissions_applications
  set converted_student_profile_id = v_profile_id,
      converted_at = now(),
      converted_by = p_actor_user_id,
      status = 'enrolled',
      intended_academic_year_id = coalesce(p_academic_year_id, intended_academic_year_id),
      intended_year_group_id = coalesce(p_year_group_id, intended_year_group_id)
  where id = p_application_id
    and organisation_id = p_organisation_id
    and converted_student_profile_id is null;

  if not found then
    select converted_student_profile_id into v_profile_id
    from admissions_applications
    where id = p_application_id;
    return v_profile_id;
  end if;

  update admissions_waiting_list_entries
  set status = 'enrolled'
  where application_id = p_application_id
    and organisation_id = p_organisation_id
    and status in ('active', 'offered');

  if p_guardian_links is not null then
    for v_link in select value from jsonb_array_elements(coalesce(p_guardian_links, '[]'::jsonb))
    loop
      select * into v_contact
      from admissions_application_contacts c
      where c.id = (v_link->>'contactId')::uuid
        and c.application_id = p_application_id
        and c.organisation_id = p_organisation_id;
      if not found then
        raise exception 'organisation_mismatch' using errcode = '23514';
      end if;
      if v_contact.email is null then
        continue;
      end if;
      v_portal := coalesce((v_link->>'portalAccess')::boolean, false);
      if not exists (
        select 1 from guardianships g
        where g.student_profile_id = v_profile_id
          and g.guardian_user_id = (
            select u.id from users u where u.email = v_contact.email
          )
          and g.ended_on is null
      ) then
        perform link_guardian(
          p_actor_user_id,
          p_organisation_id,
          v_profile_id,
          v_contact.email,
          v_contact.full_name,
          v_contact.relationship,
          v_contact.has_parental_responsibility,
          false,
          false,
          v_portal,
          case when v_contact.is_primary then 1 else 2 end::smallint
        );
      end if;
      update admissions_application_contacts c
      set user_id = u.id
      from users u
      where c.id = v_contact.id and u.email = v_contact.email;
    end loop;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    p_actor_user_id,
    'admissions.application.converted',
    'admissions_application',
    p_application_id,
    jsonb_build_object(
      'studentProfileId', v_profile_id,
      'applicationId', p_application_id,
      'reference', v_app.reference
    )
  );

  return v_profile_id;
end;
$$;

revoke all on function enrol_admitted_applicant(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb
) from public;
grant execute on function enrol_admitted_applicant(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb
) to schoolapp_app;
