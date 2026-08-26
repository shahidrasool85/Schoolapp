-- Structured medication and dietary requirements on the canonical pupil record.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, break-glass, or audit.
-- Treats migrations 0001–0035 as immutable.
-- Operational medical/dietary records are not safeguarding and are not SEND notes.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('students.medications.read_operational', 'Read operational medication fields for assigned pupils (not internal notes)'),
  ('students.dietary.read_operational', 'Read operational dietary fields for assigned pupils (not internal notes)'),
  ('students.medications.read_own_children', 'Read parent-visible medication records for authorised children'),
  ('students.dietary.read_own_children', 'Read parent-visible dietary records for authorised children')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.teacher', 'students.medications.read_operational'),
    ('school.teacher', 'students.dietary.read_operational'),
    ('school.parent', 'students.medications.read_own_children'),
    ('school.parent', 'students.dietary.read_own_children')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and rp.permission_key in (
    'students.medications.read_operational',
    'students.dietary.read_operational',
    'students.medications.read_own_children',
    'students.dietary.read_own_children'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Medication
-- ---------------------------------------------------------------------------

create table student_medications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  medication_name text not null check (char_length(trim(medication_name)) between 1 and 200),
  dosage text check (dosage is null or char_length(dosage) <= 200),
  route text not null default 'other' check (route in (
    'oral', 'inhaled', 'topical', 'injection', 'buccal', 'other'
  )),
  schedule_text text check (schedule_text is null or char_length(schedule_text) <= 500),
  is_prn boolean not null default false,
  started_on date,
  ended_on date,
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  administration_responsibility text not null default 'school_staff' check (administration_responsibility in (
    'school_staff', 'parent', 'pupil', 'shared', 'other'
  )),
  parent_consent_status text not null default 'pending' check (parent_consent_status in (
    'pending', 'granted', 'declined', 'not_required'
  )),
  parent_consent_on date,
  review_on date,
  status text not null default 'active' check (status in ('active', 'stopped')),
  stopped_reason text check (stopped_reason is null or char_length(stopped_reason) <= 500),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  parent_visible boolean not null default true,
  source_application_id uuid references admissions_applications (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users (id),
  updated_by uuid references users (id),
  check (ended_on is null or started_on is null or ended_on >= started_on),
  check (status <> 'stopped' or ended_on is not null)
);

create index student_medications_student_idx
  on student_medications (organisation_id, student_profile_id, status, started_on desc);

create trigger student_medications_updated_at
  before update on student_medications
  for each row execute function set_updated_at();

select install_tenant_isolation('student_medications');
grant select, insert, update on student_medications to schoolapp_app;

create table student_medication_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  medication_id uuid not null references student_medications (id),
  actor_user_id uuid references users (id),
  change_kind text not null check (change_kind in ('updated', 'stopped', 'reactivated')),
  changed_fields text[] not null default '{}',
  previous_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index student_medication_revisions_med_idx
  on student_medication_revisions (organisation_id, medication_id, created_at);

select install_tenant_isolation('student_medication_revisions');
grant select, insert on student_medication_revisions to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Dietary requirements
-- ---------------------------------------------------------------------------

create table student_dietary_requirements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  requirement_type text not null default 'other' check (requirement_type in (
    'allergy', 'intolerance', 'religious', 'cultural', 'medical', 'preference', 'texture', 'other'
  )),
  requirement text not null check (char_length(trim(requirement)) between 1 and 200),
  foods_to_avoid text check (foods_to_avoid is null or char_length(foods_to_avoid) <= 2000),
  safe_alternatives text check (safe_alternatives is null or char_length(safe_alternatives) <= 2000),
  is_religious_or_cultural boolean not null default false,
  related_allergy text check (related_allergy is null or char_length(related_allergy) <= 500),
  texture_feeding_notes text check (texture_feeding_notes is null or char_length(texture_feeding_notes) <= 2000),
  parent_confirmed_on date,
  review_on date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  ended_on date,
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 4000),
  parent_visible boolean not null default true,
  source_application_id uuid references admissions_applications (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users (id),
  updated_by uuid references users (id),
  check (ended_on is null or ended_on >= coalesce(parent_confirmed_on, ended_on)),
  check (status <> 'inactive' or ended_on is not null)
);

create index student_dietary_requirements_student_idx
  on student_dietary_requirements (organisation_id, student_profile_id, status, created_at desc);

create trigger student_dietary_requirements_updated_at
  before update on student_dietary_requirements
  for each row execute function set_updated_at();

select install_tenant_isolation('student_dietary_requirements');
grant select, insert, update on student_dietary_requirements to schoolapp_app;

create table student_dietary_requirement_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  dietary_requirement_id uuid not null references student_dietary_requirements (id),
  actor_user_id uuid references users (id),
  change_kind text not null check (change_kind in ('updated', 'stopped', 'reactivated')),
  changed_fields text[] not null default '{}',
  previous_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index student_dietary_requirement_revisions_idx
  on student_dietary_requirement_revisions (organisation_id, dietary_requirement_id, created_at);

select install_tenant_isolation('student_dietary_requirement_revisions');
grant select, insert on student_dietary_requirement_revisions to schoolapp_app;

-- ---------------------------------------------------------------------------
-- Same-org integrity + actor stamping + history
-- ---------------------------------------------------------------------------

create or replace function pupil_medical_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name in ('student_medications', 'student_dietary_requirements') then
    perform phase18_same_org_student(new.organisation_id, new.student_profile_id);
  elsif tg_table_name = 'student_medication_revisions' then
    if not exists (
      select 1 from student_medications m
      where m.id = new.medication_id and m.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'student_dietary_requirement_revisions' then
    if not exists (
      select 1 from student_dietary_requirements d
      where d.id = new.dietary_requirement_id and d.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger student_medications_org_tg
  before insert or update on student_medications
  for each row execute function pupil_medical_same_org_tg();

create trigger student_dietary_requirements_org_tg
  before insert or update on student_dietary_requirements
  for each row execute function pupil_medical_same_org_tg();

create trigger student_medication_revisions_org_tg
  before insert or update on student_medication_revisions
  for each row execute function pupil_medical_same_org_tg();

create trigger student_dietary_requirement_revisions_org_tg
  before insert or update on student_dietary_requirement_revisions
  for each row execute function pupil_medical_same_org_tg();

create or replace function pupil_medical_actor_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if app_current_user_id() is not null then
      new.created_by := app_current_user_id();
      new.updated_by := app_current_user_id();
    end if;
  elsif tg_op = 'UPDATE' then
    if app_current_user_id() is not null then
      new.updated_by := app_current_user_id();
    end if;
  end if;
  return new;
end;
$$;

create trigger student_medications_actor_tg
  before insert or update on student_medications
  for each row execute function pupil_medical_actor_tg();

create trigger student_dietary_requirements_actor_tg
  before insert or update on student_dietary_requirements
  for each row execute function pupil_medical_actor_tg();

create or replace function pupil_medical_revision_tg()
returns trigger
language plpgsql
as $$
declare
  v_fields text[] := '{}';
  v_kind text := 'updated';
  v_prev jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if tg_table_name = 'student_medications' then
    if old.medication_name is distinct from new.medication_name then v_fields := array_append(v_fields, 'medication_name'); end if;
    if old.dosage is distinct from new.dosage then v_fields := array_append(v_fields, 'dosage'); end if;
    if old.route is distinct from new.route then v_fields := array_append(v_fields, 'route'); end if;
    if old.schedule_text is distinct from new.schedule_text then v_fields := array_append(v_fields, 'schedule_text'); end if;
    if old.is_prn is distinct from new.is_prn then v_fields := array_append(v_fields, 'is_prn'); end if;
    if old.started_on is distinct from new.started_on then v_fields := array_append(v_fields, 'started_on'); end if;
    if old.ended_on is distinct from new.ended_on then v_fields := array_append(v_fields, 'ended_on'); end if;
    if old.instructions is distinct from new.instructions then v_fields := array_append(v_fields, 'instructions'); end if;
    if old.administration_responsibility is distinct from new.administration_responsibility then
      v_fields := array_append(v_fields, 'administration_responsibility');
    end if;
    if old.parent_consent_status is distinct from new.parent_consent_status then
      v_fields := array_append(v_fields, 'parent_consent_status');
    end if;
    if old.parent_consent_on is distinct from new.parent_consent_on then v_fields := array_append(v_fields, 'parent_consent_on'); end if;
    if old.review_on is distinct from new.review_on then v_fields := array_append(v_fields, 'review_on'); end if;
    if old.status is distinct from new.status then v_fields := array_append(v_fields, 'status'); end if;
    if old.stopped_reason is distinct from new.stopped_reason then v_fields := array_append(v_fields, 'stopped_reason'); end if;
    if old.internal_notes is distinct from new.internal_notes then v_fields := array_append(v_fields, 'internal_notes'); end if;
    if old.parent_visible is distinct from new.parent_visible then v_fields := array_append(v_fields, 'parent_visible'); end if;
    if old.status = 'active' and new.status = 'stopped' then
      v_kind := 'stopped';
    elsif old.status = 'stopped' and new.status = 'active' then
      v_kind := 'reactivated';
    end if;
    if array_length(v_fields, 1) is null then
      return new;
    end if;
    v_prev := jsonb_build_object(
      'medicationName', old.medication_name,
      'dosage', old.dosage,
      'route', old.route,
      'scheduleText', old.schedule_text,
      'isPrn', old.is_prn,
      'startedOn', old.started_on,
      'endedOn', old.ended_on,
      'instructions', old.instructions,
      'administrationResponsibility', old.administration_responsibility,
      'parentConsentStatus', old.parent_consent_status,
      'parentConsentOn', old.parent_consent_on,
      'reviewOn', old.review_on,
      'status', old.status,
      'stoppedReason', old.stopped_reason,
      'internalNotes', old.internal_notes,
      'parentVisible', old.parent_visible
    );
    insert into student_medication_revisions (
      organisation_id, medication_id, actor_user_id, change_kind, changed_fields, previous_data
    ) values (
      new.organisation_id, new.id, app_current_user_id(), v_kind, v_fields, v_prev
    );
  elsif tg_table_name = 'student_dietary_requirements' then
    if old.requirement_type is distinct from new.requirement_type then v_fields := array_append(v_fields, 'requirement_type'); end if;
    if old.requirement is distinct from new.requirement then v_fields := array_append(v_fields, 'requirement'); end if;
    if old.foods_to_avoid is distinct from new.foods_to_avoid then v_fields := array_append(v_fields, 'foods_to_avoid'); end if;
    if old.safe_alternatives is distinct from new.safe_alternatives then v_fields := array_append(v_fields, 'safe_alternatives'); end if;
    if old.is_religious_or_cultural is distinct from new.is_religious_or_cultural then
      v_fields := array_append(v_fields, 'is_religious_or_cultural');
    end if;
    if old.related_allergy is distinct from new.related_allergy then v_fields := array_append(v_fields, 'related_allergy'); end if;
    if old.texture_feeding_notes is distinct from new.texture_feeding_notes then
      v_fields := array_append(v_fields, 'texture_feeding_notes');
    end if;
    if old.parent_confirmed_on is distinct from new.parent_confirmed_on then
      v_fields := array_append(v_fields, 'parent_confirmed_on');
    end if;
    if old.review_on is distinct from new.review_on then v_fields := array_append(v_fields, 'review_on'); end if;
    if old.status is distinct from new.status then v_fields := array_append(v_fields, 'status'); end if;
    if old.ended_on is distinct from new.ended_on then v_fields := array_append(v_fields, 'ended_on'); end if;
    if old.internal_notes is distinct from new.internal_notes then v_fields := array_append(v_fields, 'internal_notes'); end if;
    if old.parent_visible is distinct from new.parent_visible then v_fields := array_append(v_fields, 'parent_visible'); end if;
    if old.status = 'active' and new.status = 'inactive' then
      v_kind := 'stopped';
    elsif old.status = 'inactive' and new.status = 'active' then
      v_kind := 'reactivated';
    end if;
    if array_length(v_fields, 1) is null then
      return new;
    end if;
    v_prev := jsonb_build_object(
      'requirementType', old.requirement_type,
      'requirement', old.requirement,
      'foodsToAvoid', old.foods_to_avoid,
      'safeAlternatives', old.safe_alternatives,
      'isReligiousOrCultural', old.is_religious_or_cultural,
      'relatedAllergy', old.related_allergy,
      'textureFeedingNotes', old.texture_feeding_notes,
      'parentConfirmedOn', old.parent_confirmed_on,
      'reviewOn', old.review_on,
      'status', old.status,
      'endedOn', old.ended_on,
      'internalNotes', old.internal_notes,
      'parentVisible', old.parent_visible
    );
    insert into student_dietary_requirement_revisions (
      organisation_id, dietary_requirement_id, actor_user_id, change_kind, changed_fields, previous_data
    ) values (
      new.organisation_id, new.id, app_current_user_id(), v_kind, v_fields, v_prev
    );
  end if;
  return new;
end;
$$;

create trigger student_medications_revision_tg
  after update on student_medications
  for each row execute function pupil_medical_revision_tg();

create trigger student_dietary_requirements_revision_tg
  after update on student_dietary_requirements
  for each row execute function pupil_medical_revision_tg();

-- ---------------------------------------------------------------------------
-- Admissions conversion: seed structured rows from canonical free-text once
-- ---------------------------------------------------------------------------

create or replace function apply_admissions_structured_medical(
  p_organisation_id uuid,
  p_application_id uuid,
  p_student_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sub record;
  v_canonical jsonb;
  v_medical jsonb;
  v_medication text;
  v_dietary text;
begin
  select id, canonical_snapshot
    into v_sub
  from admissions_form_submissions
  where organisation_id = p_organisation_id
    and application_id = p_application_id
  order by submitted_at desc nulls last, created_at desc
  limit 1;

  v_canonical := coalesce(v_sub.canonical_snapshot, '{}'::jsonb);
  v_medical := coalesce(v_canonical->'medical', '{}'::jsonb);
  v_medication := nullif(v_medical->>'medication', '');
  v_dietary := nullif(v_medical->>'dietary', '');

  if v_medication is not null
     and not exists (
       select 1 from student_medications m
       where m.student_profile_id = p_student_profile_id
         and m.organisation_id = p_organisation_id
         and m.source_application_id = p_application_id
     ) then
    insert into student_medications (
      organisation_id, student_profile_id, medication_name, dosage, route, schedule_text,
      is_prn, instructions, administration_responsibility, parent_consent_status, status,
      parent_visible, source_application_id
    ) values (
      p_organisation_id,
      p_student_profile_id,
      left(v_medication, 200),
      null,
      'other',
      null,
      false,
      v_medication,
      'school_staff',
      'pending',
      'active',
      true,
      p_application_id
    );
  end if;

  if v_dietary is not null
     and not exists (
       select 1 from student_dietary_requirements d
       where d.student_profile_id = p_student_profile_id
         and d.organisation_id = p_organisation_id
         and d.source_application_id = p_application_id
     ) then
    insert into student_dietary_requirements (
      organisation_id, student_profile_id, requirement_type, requirement, foods_to_avoid,
      is_religious_or_cultural, status, parent_visible, source_application_id
    ) values (
      p_organisation_id,
      p_student_profile_id,
      'other',
      left(v_dietary, 200),
      v_dietary,
      false,
      'active',
      true,
      p_application_id
    );
  end if;
end;
$$;

revoke all on function apply_admissions_structured_medical(uuid, uuid, uuid) from public;
grant execute on function apply_admissions_structured_medical(uuid, uuid, uuid) to schoolapp_app;

create or replace function admissions_application_converted_map_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.converted_student_profile_id is not null
     and old.converted_student_profile_id is null then
    perform apply_admissions_canonical_conversion(
      new.organisation_id,
      new.id,
      new.converted_student_profile_id
    );
    perform apply_admissions_structured_medical(
      new.organisation_id,
      new.id,
      new.converted_student_profile_id
    );
  end if;
  return new;
end;
$$;
