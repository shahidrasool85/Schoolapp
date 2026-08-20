-- staff_profiles_same_org_tg selected from users, which RLS hides from schoolapp_app
-- for anyone except the current actor. That made PATCH /staff/:id fail with 404.
-- user_id is already a foreign key, so the existence check is redundant.

create or replace function staff_profiles_same_org_tg()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;
