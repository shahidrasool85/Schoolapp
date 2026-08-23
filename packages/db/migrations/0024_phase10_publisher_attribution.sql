-- Phase 10 follow-up: do not stamp the first reader as publisher when a
-- scheduled announcement or event activates. Prefer the staff member who
-- scheduled it, then the creator.

create or replace function announcements_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.created_by is null then
      raise exception 'communication_actor_required' using errcode = '22023';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not announcement_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'scheduled' then
      new.published_by := coalesce(old.published_by, v_actor, new.published_by);
    elsif new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      if old.status = 'scheduled' then
        new.published_by := coalesce(old.published_by, new.published_by, old.created_by);
      else
        new.published_by := coalesce(v_actor, old.published_by, new.published_by, old.created_by);
      end if;
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    end if;
  else
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function school_events_write_tg()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid;
begin
  v_actor := app_current_user_id();
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.created_by is null then
      raise exception 'communication_actor_required' using errcode = '22023';
    end if;
    if new.ends_at < new.starts_at then
      raise exception 'event_dates_invalid' using errcode = '23514';
    end if;
    if not exists (
      select 1 from school_event_types t
      where t.id = new.event_type_id and t.organisation_id = new.organisation_id
    ) then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    new.published_at := null;
    new.published_by := null;
    new.archived_at := null;
    new.archived_by := null;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.organisation_id := old.organisation_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not school_event_status_allowed(old.status, new.status) then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;
  if new.ends_at < new.starts_at then
    raise exception 'event_dates_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from school_event_types t
    where t.id = new.event_type_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;

  if old.status is distinct from new.status then
    if new.status = 'scheduled' then
      new.published_by := coalesce(old.published_by, v_actor, new.published_by);
    elsif new.status = 'published' then
      new.published_at := coalesce(old.published_at, now());
      if old.status = 'scheduled' then
        new.published_by := coalesce(old.published_by, new.published_by, old.created_by);
      else
        new.published_by := coalesce(v_actor, old.published_by, new.published_by, old.created_by);
      end if;
    elsif new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.archived_by);
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(v_actor, new.cancelled_by);
    end if;
  else
    new.published_at := old.published_at;
    new.published_by := old.published_by;
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
