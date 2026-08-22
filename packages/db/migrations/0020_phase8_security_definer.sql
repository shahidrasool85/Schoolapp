-- Phase 8 follow-up: SECURITY DEFINER snapshot re-checks actor, tenant, and
-- permission. Drop the unused report-section write function replaced in 0019.

create or replace function snapshot_academic_assessment_inclusions(p_assessment_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_year uuid;
  v_group uuid;
  v_created_by uuid;
  v_actor uuid;
  v_count integer := 0;
begin
  select organisation_id, academic_year_id, year_group_id, created_by
    into v_org, v_year, v_group, v_created_by
  from academic_assessments
  where id = p_assessment_id;

  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from v_org
     and not app_is_platform_admin() then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  v_actor := app_current_user_id();
  if v_actor is not null and not app_is_platform_admin() then
    if not exists (
      select 1 from organisation_memberships m
      where m.organisation_id = v_org
        and m.user_id = v_actor
        and m.status = 'active'
        and m.ended_at is null
    ) then
      raise exception 'tenant_context_membership_required' using errcode = '42501';
    end if;
    if not (
      actor_has_permission(v_actor, v_org, 'assessments.manage')
      or actor_has_permission(v_actor, v_org, 'academic.oversight')
      or (
        actor_has_permission(v_actor, v_org, 'assessments.manage_assigned')
        and (
          v_created_by = v_actor
          or exists (
            select 1
            from academic_assessment_classes ac
            join class_staff_assignments csa
              on csa.class_id = ac.class_id
             and csa.organisation_id = v_org
             and csa.ended_on is null
            join staff_profiles sp
              on sp.id = csa.staff_profile_id
             and sp.organisation_id = v_org
             and sp.user_id = v_actor
            where ac.assessment_id = p_assessment_id
              and ac.organisation_id = v_org
          )
        )
      )
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  insert into academic_assessment_inclusions (
    organisation_id, assessment_id, student_profile_id, class_id
  )
  select distinct
    v_org,
    p_assessment_id,
    cm.student_profile_id,
    cm.class_id
  from academic_assessment_classes ac
  join class_memberships cm
    on cm.class_id = ac.class_id
   and cm.organisation_id = v_org
   and cm.academic_year_id = v_year
   and (cm.ended_on is null or cm.ended_on >= current_date)
  where ac.assessment_id = p_assessment_id
    and ac.organisation_id = v_org
  on conflict (assessment_id, student_profile_id) do nothing;

  get diagnostics v_count = row_count;

  if not exists (
    select 1 from academic_assessment_classes
    where assessment_id = p_assessment_id
  ) then
    insert into academic_assessment_inclusions (
      organisation_id, assessment_id, student_profile_id, class_id
    )
    select distinct
      v_org,
      p_assessment_id,
      se.student_profile_id,
      form.class_id
    from student_enrolments se
    left join lateral (
      select cm.class_id
      from class_memberships cm
      join classes c on c.id = cm.class_id
      where cm.student_profile_id = se.student_profile_id
        and cm.organisation_id = v_org
        and cm.academic_year_id = v_year
        and (cm.ended_on is null or cm.ended_on >= current_date)
        and c.class_type = 'form'
      limit 1
    ) form on true
    where se.organisation_id = v_org
      and se.academic_year_id = v_year
      and se.year_group_id = v_group
      and se.is_primary
      and se.ended_on is null
      and se.status = 'enrolled'
    on conflict (assessment_id, student_profile_id) do nothing;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke all on function snapshot_academic_assessment_inclusions(uuid) from public;
grant execute on function snapshot_academic_assessment_inclusions(uuid) to schoolapp_app;

-- Staff sessions still cannot mutate published/archived working-copy sections.
-- Owner/demo wipe has no session actor and must be able to delete the rows.
create or replace function academic_report_sections_lock_tg()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_report uuid;
begin
  v_report := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into v_status from academic_reports where id = v_report;
  if v_status in ('published', 'archived') then
    if tg_op = 'DELETE' and app_current_user_id() is null then
      return old;
    end if;
    raise exception 'academic_report_locked' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.organisation_id := old.organisation_id;
    new.report_id := old.report_id;
  end if;
  return new;
end;
$$;

drop trigger if exists academic_report_sections_write_tg on academic_report_sections;
drop function if exists academic_report_sections_write_tg();
