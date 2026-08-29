-- School Admin first-login onboarding presentation preference.
-- Additive. Does not rewrite 0001–0043, does not mark existing organisations
-- completed, and does not reset organisation_setup_progress.
-- Existing schools/users with no preference row remain eligible for the
-- welcome experience until that School Admin dismisses it.

-- Per-membership automatic onboarding preference. Admin A dismissing does not
-- hide onboarding for Admin B.

create table organisation_onboarding_preferences (
  organisation_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  automatic_onboarding_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create trigger organisation_onboarding_preferences_updated_at
  before update on organisation_onboarding_preferences
  for each row execute function set_updated_at();

-- Combined tenant + self policies. Do not also call install_tenant_isolation:
-- multiple PERMISSIVE policies OR together and would let one admin read
-- another admin's dismissal preference.

alter table organisation_onboarding_preferences enable row level security;
alter table organisation_onboarding_preferences force row level security;

create policy organisation_onboarding_preferences_own
  on organisation_onboarding_preferences
  for all
  using (
    app_tenant_matches(organisation_id)
    and user_id = app_current_user_id()
  )
  with check (
    app_tenant_matches(organisation_id)
    and user_id = app_current_user_id()
  );

grant select, insert, update on organisation_onboarding_preferences to schoolapp_app;
revoke delete on organisation_onboarding_preferences from schoolapp_app;
