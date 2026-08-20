-- RLS, FORCE, grants for schoolapp_app.

create or replace function install_tenant_isolation(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := p_table::text;
  v_policy text := replace(v_name, '.', '_') || '_tenant_isolation';
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('drop policy if exists %I on %s', v_policy, p_table);
  execute format(
    $sql$
      create policy %I on %s
      for all
      using (app_tenant_matches(organisation_id))
      with check (app_tenant_matches(organisation_id))
    $sql$,
    v_policy,
    p_table
  );
end;
$$;

select install_tenant_isolation('organisation_identifiers');
select install_tenant_isolation('organisation_settings');
select install_tenant_isolation('organisation_feature_flags');
select install_tenant_isolation('organisation_memberships');
select install_tenant_isolation('invitations');
select install_tenant_isolation('support_access_grants');
select install_tenant_isolation('external_identifiers');
select install_tenant_isolation('organisation_subscriptions');
select install_tenant_isolation('academic_years');
select install_tenant_isolation('terms');
select install_tenant_isolation('half_terms');
select install_tenant_isolation('year_groups');
select install_tenant_isolation('houses');
select install_tenant_isolation('subjects');
select install_tenant_isolation('classes');
select install_tenant_isolation('staff_profiles');
select install_tenant_isolation('student_profiles');
select install_tenant_isolation('student_enrolments');
select install_tenant_isolation('class_memberships');
select install_tenant_isolation('class_staff_assignments');
select install_tenant_isolation('class_subjects');
select install_tenant_isolation('guardianships');
select install_tenant_isolation('notification_preferences');
select install_tenant_isolation('inter_school_competition_network_members');

alter table audit_events enable row level security;
alter table audit_events force row level security;

create policy audit_events_tenant_or_platform on audit_events
  for insert
  with check (
    app_tenant_matches(organisation_id)
    or (
      organisation_id is null
      and app_is_platform_admin()
      and app_current_organisation_id() is null
    )
  );

create policy audit_events_select on audit_events
  for select
  using (
    app_tenant_matches(organisation_id)
    or (
      organisation_id is null
      and app_is_platform_admin()
      and app_current_organisation_id() is null
    )
  );

alter table roles enable row level security;
alter table roles force row level security;

create policy roles_tenant_isolation on roles
  for all
  using (
    organisation_id is null
    or app_tenant_matches(organisation_id)
  )
  with check (
    organisation_id is null
    or app_tenant_matches(organisation_id)
  );

alter table organisations enable row level security;
alter table organisations force row level security;

-- Platform admins may list organisations only with NO tenant context.
-- Break-glass (tenant context set) sees only that organisation.
create policy organisations_visibility on organisations
  for select
  using (
    id = app_current_organisation_id()
    or (
      app_is_platform_admin()
      and app_current_organisation_id() is null
    )
  );

create policy organisations_update_current on organisations
  for update
  using (id = app_current_organisation_id())
  with check (id = app_current_organisation_id());

alter table users enable row level security;
alter table users force row level security;

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
  );

create policy users_update_self on users
  for update
  using (id = app_current_user_id())
  with check (id = app_current_user_id());

alter table platform_admins enable row level security;
alter table platform_admins force row level security;

create policy platform_admins_self on platform_admins
  for select
  using (
    user_id = app_current_user_id()
    or (
      app_is_platform_admin()
      and app_current_organisation_id() is null
    )
  );

alter table user_credentials enable row level security;
alter table user_credentials force row level security;

-- No direct SELECT of password hashes for the app role.
create policy user_credentials_no_direct_select on user_credentials
  for select
  using (false);

alter table auth_sessions enable row level security;
alter table auth_sessions force row level security;

create policy auth_sessions_self on auth_sessions
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

alter table permissions enable row level security;
alter table permissions force row level security;

create policy permissions_read on permissions
  for select
  using (true);

alter table role_permissions enable row level security;
alter table role_permissions force row level security;

create policy role_permissions_read on role_permissions
  for select
  using (true);

alter table membership_roles enable row level security;
alter table membership_roles force row level security;

create policy membership_roles_via_membership on membership_roles
  for select
  using (
    exists (
      select 1 from organisation_memberships m
      where m.id = membership_roles.membership_id
        and app_tenant_matches(m.organisation_id)
    )
  );

alter table plans enable row level security;
alter table plans force row level security;

create policy plans_read on plans
  for select
  using (true);

alter table billing_accounts enable row level security;
alter table billing_accounts force row level security;

create policy billing_accounts_platform_only on billing_accounts
  for all
  using (
    app_is_platform_admin()
    and app_current_organisation_id() is null
  )
  with check (
    app_is_platform_admin()
    and app_current_organisation_id() is null
  );

alter table inter_school_competition_networks enable row level security;
alter table inter_school_competition_networks force row level security;

create policy inter_school_networks_platform_only on inter_school_competition_networks
  for all
  using (
    app_is_platform_admin()
    and app_current_organisation_id() is null
  )
  with check (
    app_is_platform_admin()
    and app_current_organisation_id() is null
  );

-- Runtime grants
grant usage on schema public to schoolapp_app;

grant select, insert, update on
  organisations,
  organisation_identifiers,
  organisation_settings,
  organisation_feature_flags,
  users,
  organisation_memberships,
  permissions,
  roles,
  role_permissions,
  membership_roles,
  invitations,
  support_access_grants,
  external_identifiers,
  organisation_subscriptions,
  plans,
  academic_years,
  terms,
  half_terms,
  year_groups,
  houses,
  subjects,
  classes,
  staff_profiles,
  student_profiles,
  student_enrolments,
  class_memberships,
  class_staff_assignments,
  class_subjects,
  notification_preferences
to schoolapp_app;

grant select (
  id, organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, created_at, updated_at
) on guardianships to schoolapp_app;
grant insert (
  id, organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, created_at, updated_at
) on guardianships to schoolapp_app;
grant update (
  organisation_id, student_profile_id, guardian_user_id, relationship,
  has_parental_responsibility, is_emergency_contact, lives_with_student,
  portal_access, priority, started_on, ended_on, updated_at
) on guardianships to schoolapp_app;

grant select on platform_admins, billing_accounts, inter_school_competition_networks,
  inter_school_competition_network_members to schoolapp_app;

grant insert, select on audit_events to schoolapp_app;
revoke update, delete on audit_events from schoolapp_app;
revoke delete on audit_events from schoolapp_owner;

-- Owner may still need DELETE for migrations; application role must not.
-- schoolapp_owner has BYPASSRLS; we still revoke DELETE on audit from app.

grant select, insert, update, delete on auth_sessions to schoolapp_app;

grant execute on function set_tenant_context(uuid, uuid) to schoolapp_app;
grant execute on function list_memberships_for_user(uuid) to schoolapp_app;
grant execute on function local_auth_lookup(citext) to schoolapp_app;
grant execute on function hash_invite_token(text) to schoolapp_app;
grant execute on function provision_organisation(uuid, text, citext, citext, text) to schoolapp_app;
grant execute on function accept_invitation(text, text, text) to schoolapp_app;
grant execute on function create_school_invitation(uuid, uuid, citext, text[]) to schoolapp_app;
grant execute on function open_support_access(uuid, uuid, text, text, interval) to schoolapp_app;
grant execute on function revoke_support_access(uuid, uuid) to schoolapp_app;
grant execute on function list_platform_organisations(uuid) to schoolapp_app;
grant execute on function list_permissions_for_membership(uuid, uuid) to schoolapp_app;

revoke execute on function install_tenant_isolation(regclass) from public;
revoke execute on function install_tenant_isolation(regclass) from schoolapp_app;
