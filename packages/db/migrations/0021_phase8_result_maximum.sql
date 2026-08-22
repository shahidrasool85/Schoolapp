-- Phase 8 follow-up: formal result maximum_score is the assessment maximum.
-- Clients cannot persist a lower denominator to inflate generated percentage.

create or replace function academic_results_same_org_tg()
returns trigger
language plpgsql
as $$
declare
  v_max numeric(8, 2);
  v_scheme uuid;
begin
  if not exists (
    select 1 from academic_assessments a
    where a.id = new.assessment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = new.student_profile_id and s.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from academic_assessment_inclusions i
    where i.assessment_id = new.assessment_id
      and i.student_profile_id = new.student_profile_id
      and i.organisation_id = new.organisation_id
  ) then
    raise exception 'assessment_pupil_not_included' using errcode = '23514';
  end if;
  select a.maximum_marks, a.grade_scheme_id into v_max, v_scheme
  from academic_assessments a
  where a.id = new.assessment_id;
  if v_max is not null then
    new.maximum_score := v_max;
  end if;
  if new.raw_score is not null and new.maximum_score is not null and new.raw_score > new.maximum_score then
    raise exception 'academic_score_out_of_range' using errcode = '23514';
  end if;
  if new.grade_scheme_level_id is not null then
    if v_scheme is null or not exists (
      select 1 from academic_grade_scheme_levels l
      where l.id = new.grade_scheme_level_id
        and l.scheme_id = v_scheme
        and l.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
