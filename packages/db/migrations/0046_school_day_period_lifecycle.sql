-- Additive school-day period lifecycle. Unused periods may be deleted.
-- Periods referenced by timetable history cannot be cascade-deleted; they may
-- be deactivated. Does not rewrite 0001–0045.

alter table school_day_periods
  add column if not exists is_active boolean not null default true;

create index if not exists school_day_periods_org_active_idx
  on school_day_periods (organisation_id, is_active, sort_order, starts_at);

-- Include non-sensitive class/teacher/room labels in conflict payloads so the
-- API can name the clash after the inserting transaction is aborted.
create or replace function timetable_collect_entry_conflicts(p_entry timetable_entries)
returns jsonb
language plpgsql
stable
as $$
declare
  conflicts jsonb := '[]'::jsonb;
  rec record;
begin
  if not p_entry.is_active then
    return conflicts;
  end if;

  for rec in
    select
      other.id,
      other.class_id,
      c.name as class_name,
      other.room_id,
      other.starts_at,
      other.ends_at,
      'class'::text as kind
    from timetable_entries other
    join classes c on c.id = other.class_id
    left join terms ot on ot.id = other.term_id
    left join terms st on st.id = p_entry.term_id
    where other.organisation_id = p_entry.organisation_id
      and other.id is distinct from p_entry.id
      and other.is_active
      and other.weekday = p_entry.weekday
      and other.class_id = p_entry.class_id
      and other.academic_year_id = p_entry.academic_year_id
      and other.starts_at < p_entry.ends_at
      and other.ends_at > p_entry.starts_at
      and timetable_window_overlap(
        p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
        other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
      )
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'message', 'This class is already scheduled at the same time',
      'entryId', rec.id,
      'classId', rec.class_id,
      'className', rec.class_name
    ));
  end loop;

  if p_entry.room_id is not null then
    for rec in
      select
        other.id,
        other.room_id,
        r.name as room_name,
        'room'::text as kind
      from timetable_entries other
      join rooms r on r.id = other.room_id
      left join terms ot on ot.id = other.term_id
      left join terms st on st.id = p_entry.term_id
      where other.organisation_id = p_entry.organisation_id
        and other.id is distinct from p_entry.id
        and other.is_active
        and other.weekday = p_entry.weekday
        and other.room_id = p_entry.room_id
        and other.academic_year_id = p_entry.academic_year_id
        and other.starts_at < p_entry.ends_at
        and other.ends_at > p_entry.starts_at
        and timetable_window_overlap(
          p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
          other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
        )
    loop
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'message', 'This room is already booked at the same time',
        'entryId', rec.id,
        'roomId', rec.room_id,
        'roomName', rec.room_name
      ));
    end loop;
  end if;

  for rec in
    select
      other.id,
      tet.staff_profile_id,
      u.full_name as teacher_name,
      'teacher'::text as kind
    from timetable_entry_teachers mine
    join timetable_entry_teachers tet
      on tet.staff_profile_id = mine.staff_profile_id
     and tet.organisation_id = mine.organisation_id
    join timetable_entries other on other.id = tet.timetable_entry_id
    join staff_profiles sp on sp.id = tet.staff_profile_id
    join users u on u.id = sp.user_id
    left join terms ot on ot.id = other.term_id
    left join terms st on st.id = p_entry.term_id
    where mine.timetable_entry_id = p_entry.id
      and other.id is distinct from p_entry.id
      and other.is_active
      and other.weekday = p_entry.weekday
      and other.academic_year_id = p_entry.academic_year_id
      and other.starts_at < p_entry.ends_at
      and other.ends_at > p_entry.starts_at
      and timetable_window_overlap(
        p_entry.effective_from, p_entry.effective_until, st.starts_on, st.ends_on,
        other.effective_from, other.effective_until, ot.starts_on, ot.ends_on
      )
  loop
    conflicts := conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'teacher',
      'message', 'This teacher is already scheduled at the same time',
      'entryId', rec.id,
      'staffProfileId', rec.staff_profile_id,
      'teacherName', rec.teacher_name
    ));
  end loop;

  return conflicts;
end;
$$;
