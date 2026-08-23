-- Phase 11.5: enrolment provisions parent users with invited memberships
-- (no password yet). The users SELECT policy previously exposed only active
-- members, so JOIN users on guardianships hid newly converted parents from
-- School Admin pupil and parent screens.
--
-- Keep active-member visibility unchanged. Allow invited identities only when
-- the actor can manage guardianships or read school members. Parents and
-- teachers without those capabilities still cannot enumerate invited users.

drop policy if exists users_self_or_current_tenant on users;

create policy users_self_or_current_tenant on users
  for select
  using (
    id = app_current_user_id()
    or exists (
      select 1
      from organisation_memberships m
      where m.user_id = users.id
        and m.organisation_id = app_current_organisation_id()
        and m.status = 'active'
    )
    or (
      actor_has_permission(
        app_current_user_id(),
        app_current_organisation_id(),
        'guardianships.manage'
      )
      and exists (
        select 1
        from guardianships g
        where g.guardian_user_id = users.id
          and g.organisation_id = app_current_organisation_id()
          and g.ended_on is null
      )
    )
    or (
      actor_has_permission(
        app_current_user_id(),
        app_current_organisation_id(),
        'org.members.read'
      )
      and exists (
        select 1
        from organisation_memberships m
        where m.user_id = users.id
          and m.organisation_id = app_current_organisation_id()
          and m.status in ('active', 'invited')
          and m.ended_at is null
      )
    )
  );
