-- Phase 4 follow-up: enrol_admitted_applicant reports whether conversion was new
-- so concurrent enrol requests notify contacts only once.
-- 0013 is already applied on main; return-type changes require DROP + recreate.

drop function if exists enrol_admitted_applicant(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb
);

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
returns table (
  student_profile_id uuid,
  newly_converted boolean
)
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
  v_newly boolean;
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
    return query select v_app.converted_student_profile_id, false;
    return;
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
    v_newly := found;
    return query select v_profile_id, v_newly;
    return;
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
    return query select v_profile_id, false;
    return;
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
      elsif v_portal then
        update guardianships g
        set portal_access = true
        where g.student_profile_id = v_profile_id
          and g.organisation_id = p_organisation_id
          and g.ended_on is null
          and g.guardian_user_id = (
            select u.id from users u where u.email = v_contact.email
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

  return query select v_profile_id, true;
end;
$$;

revoke all on function enrol_admitted_applicant(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb
) from public;
grant execute on function enrol_admitted_applicant(
  uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb
) to schoolapp_app;
