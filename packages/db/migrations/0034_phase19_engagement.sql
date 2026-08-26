-- Phase 19: student engagement — rewards, achievements, competitions,
-- leaderboard privacy, XP, and early-learning practice.
-- Additive. Does not weaken FORCE RLS, tenant context, hostname tenancy,
-- membership revalidation, teacher assigned-only access, guardianship /
-- portal_access, student self-only access, student portal policy,
-- safeguarding capabilities, or Phase 17 UI contracts.
-- Treats migrations 0001–0033 as immutable.
-- Does not implement AI generation, student-to-student messaging,
-- currency/shop mechanics, or formal assessment writes.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into permissions (key, description) values
  ('engagement.settings.read', 'Read school engagement and leaderboard settings'),
  ('engagement.settings.manage', 'Manage school engagement, year-group policy, and leaderboard settings'),
  ('rewards.read', 'School-wide reward read'),
  ('rewards.read_assigned', 'Read rewards for assigned pupils'),
  ('rewards.award', 'Award rewards school-wide'),
  ('rewards.award_assigned', 'Award rewards to assigned pupils'),
  ('rewards.manage', 'Manage reward categories and revoke rewards'),
  ('rewards.read_self', 'Student: read own student-visible rewards'),
  ('rewards.read_own_children', 'Parent: read parent-visible rewards for authorised children'),
  ('achievements.read', 'School-wide achievement definition and award read'),
  ('achievements.read_assigned', 'Read achievements for assigned pupils'),
  ('achievements.manage', 'Manage achievement definitions and school-wide awards'),
  ('achievements.award_assigned', 'Manually award achievements to assigned pupils'),
  ('achievements.read_self', 'Student: read own student-visible achievements'),
  ('achievements.read_own_children', 'Parent: read parent-visible achievements for authorised children'),
  ('competitions.read', 'School-wide competition read'),
  ('competitions.read_assigned', 'Read competitions that include assigned pupils or classes'),
  ('competitions.manage', 'Create and manage competitions for assigned scope'),
  ('competitions.manage_school', 'Manage school-wide competitions and freeze results'),
  ('competitions.read_self', 'Student: read student-visible competitions'),
  ('competitions.read_own_children', 'Parent: read parent-visible competitions for authorised children'),
  ('learning.practice.read', 'School-wide early-learning / practice catalogue read'),
  ('learning.practice.read_assigned', 'Read practice activities and progress for assigned pupils'),
  ('learning.practice.manage', 'Manage school-wide practice activities and assignments'),
  ('learning.practice.manage_assigned', 'Create and assign practice activities to assigned pupils/classes'),
  ('learning.practice.submit_self', 'Student: attempt published practice activities'),
  ('learning.practice.read_self', 'Student: read own practice progress'),
  ('learning.practice.read_own_children', 'Parent: read authorised child practice progress'),
  ('learning.practice.submit_own_children', 'Parent: launch parent-assisted practice for authorised children')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, x.perm
from roles r
join (
  values
    ('school.admin', 'engagement.settings.read'),
    ('school.admin', 'engagement.settings.manage'),
    ('school.admin', 'rewards.read'),
    ('school.admin', 'rewards.award'),
    ('school.admin', 'rewards.manage'),
    ('school.admin', 'achievements.read'),
    ('school.admin', 'achievements.manage'),
    ('school.admin', 'competitions.read'),
    ('school.admin', 'competitions.manage'),
    ('school.admin', 'competitions.manage_school'),
    ('school.admin', 'learning.practice.read'),
    ('school.admin', 'learning.practice.manage'),
    ('school.headteacher', 'engagement.settings.read'),
    ('school.headteacher', 'rewards.read'),
    ('school.headteacher', 'rewards.award'),
    ('school.headteacher', 'rewards.manage'),
    ('school.headteacher', 'achievements.read'),
    ('school.headteacher', 'achievements.manage'),
    ('school.headteacher', 'competitions.read'),
    ('school.headteacher', 'competitions.manage'),
    ('school.headteacher', 'competitions.manage_school'),
    ('school.headteacher', 'learning.practice.read'),
    ('school.headteacher', 'learning.practice.manage'),
    ('school.teacher', 'rewards.read_assigned'),
    ('school.teacher', 'rewards.award_assigned'),
    ('school.teacher', 'achievements.read_assigned'),
    ('school.teacher', 'achievements.award_assigned'),
    ('school.teacher', 'competitions.read_assigned'),
    ('school.teacher', 'competitions.manage'),
    ('school.teacher', 'learning.practice.read_assigned'),
    ('school.teacher', 'learning.practice.manage_assigned'),
    ('school.parent', 'rewards.read_own_children'),
    ('school.parent', 'achievements.read_own_children'),
    ('school.parent', 'competitions.read_own_children'),
    ('school.parent', 'learning.practice.read_own_children'),
    ('school.parent', 'learning.practice.submit_own_children'),
    ('school.student', 'rewards.read_self'),
    ('school.student', 'achievements.read_self'),
    ('school.student', 'competitions.read_self'),
    ('school.student', 'learning.practice.read_self'),
    ('school.student', 'learning.practice.submit_self')
) as x(role_key, perm)
  on r.key = x.role_key and r.organisation_id is null
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select org_role.id, rp.permission_key
from roles sys
join role_permissions rp on rp.role_id = sys.id
join roles org_role on org_role.key = sys.key and org_role.organisation_id is not null
where sys.organisation_id is null
  and (
    rp.permission_key like 'engagement.%'
    or rp.permission_key like 'rewards.%'
    or rp.permission_key like 'achievements.%'
    or rp.permission_key like 'competitions.%'
    or rp.permission_key like 'learning.practice.%'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Houses: optional display metadata (canonical house entity already exists)
-- ---------------------------------------------------------------------------

alter table houses
  add column if not exists short_code text,
  add column if not exists colour text,
  add column if not exists active boolean not null default true;

alter table houses
  drop constraint if exists houses_colour_check;
alter table houses
  add constraint houses_colour_check
  check (colour is null or colour ~ '^#[0-9A-Fa-f]{6}$');

alter table houses
  drop constraint if exists houses_short_code_len;
alter table houses
  add constraint houses_short_code_len
  check (short_code is null or char_length(btrim(short_code)) between 1 and 12);

create unique index if not exists houses_org_short_code_uidx
  on houses (organisation_id, lower(short_code))
  where short_code is not null;

-- ---------------------------------------------------------------------------
-- Organisation engagement settings
-- ---------------------------------------------------------------------------

create table engagement_settings (
  organisation_id uuid primary key references organisations (id),
  rewards_enabled boolean not null default true,
  achievements_enabled boolean not null default true,
  competitions_enabled boolean not null default true,
  leaderboards_enabled boolean not null default false,
  early_learning_enabled boolean not null default true,
  xp_enabled boolean not null default true,
  student_visible_points boolean not null default true,
  parent_visible_points boolean not null default true,
  allow_individual_leaderboard boolean not null default false,
  allow_class_leaderboard boolean not null default true,
  allow_house_leaderboard boolean not null default true,
  anonymise_pupil_leaderboard boolean not null default true,
  leaderboard_display_name_policy text not null default 'first_name_initial'
    check (leaderboard_display_name_policy in (
      'first_name_initial',
      'first_name',
      'anonymous_alias',
      'rank_only'
    )),
  grant_reward_points_on_learning boolean not null default false,
  updated_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table engagement_year_group_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  year_group_id uuid not null references year_groups (id),
  rewards_enabled boolean,
  achievements_enabled boolean,
  competitions_enabled boolean,
  leaderboards_enabled boolean,
  early_learning_enabled boolean,
  learning_challenges_enabled boolean,
  parent_assisted_mode boolean,
  child_friendly_ui boolean,
  xp_enabled boolean,
  student_visible_points boolean,
  parent_visible_points boolean,
  updated_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year_group_id),
  unique (organisation_id, year_group_id)
);

-- ---------------------------------------------------------------------------
-- Rewards (separate from behaviour positives)
-- ---------------------------------------------------------------------------

create table reward_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null,
  name text not null,
  default_points int not null default 0 check (default_points >= 0),
  grants_xp boolean not null default false,
  default_xp int not null default 0 check (default_xp >= 0),
  student_visible boolean not null default true,
  parent_visible boolean not null default true,
  active boolean not null default true,
  is_system boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table pupil_rewards (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  category_id uuid not null references reward_categories (id),
  points int not null default 0 check (points >= 0),
  xp_awarded int not null default 0 check (xp_awarded >= 0),
  title text not null,
  pupil_message text,
  internal_note text,
  awarded_by uuid not null references users (id),
  awarded_at timestamptz not null default now(),
  subject_id uuid references subjects (id),
  class_id uuid references classes (id),
  house_id uuid references houses (id),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'bulk', 'learning_activity', 'competition', 'system')),
  source_id uuid,
  student_visible boolean not null default true,
  parent_visible boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'corrected')),
  revoked_by uuid references users (id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pupil_rewards_org_student_idx
  on pupil_rewards (organisation_id, student_profile_id, awarded_at desc);
create index pupil_rewards_org_house_idx
  on pupil_rewards (organisation_id, house_id, awarded_at desc)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- XP ledger (append-only; distinct from reward points)
-- ---------------------------------------------------------------------------

create table pupil_xp_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  amount int not null check (amount > 0),
  source_type text not null
    check (source_type in ('learning_attempt', 'reward', 'achievement', 'manual')),
  source_id uuid,
  awarded_by uuid references users (id),
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index pupil_xp_events_source_uidx
  on pupil_xp_events (organisation_id, student_profile_id, source_type, source_id)
  where source_id is not null;
create index pupil_xp_events_org_student_idx
  on pupil_xp_events (organisation_id, student_profile_id, awarded_at desc);

-- ---------------------------------------------------------------------------
-- Achievements
-- ---------------------------------------------------------------------------

create table achievement_definitions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  key text not null,
  title text not null,
  description text,
  icon_key text,
  criteria_type text not null
    check (criteria_type in (
      'manual',
      'assignment_count',
      'assignment_completed_count',
      'reward_points_total',
      'xp_total',
      'attendance_percentage',
      'attendance_streak',
      'learning_activity_count',
      'challenge_completed_count'
    )),
  threshold int check (threshold is null or threshold >= 0),
  allow_repeat boolean not null default false,
  active boolean not null default true,
  student_visible boolean not null default true,
  parent_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table pupil_achievements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  definition_id uuid not null references achievement_definitions (id),
  awarded_by uuid references users (id),
  awarded_at timestamptz not null default now(),
  source text not null default 'automatic'
    check (source in ('automatic', 'manual')),
  note text,
  created_at timestamptz not null default now()
);

create unique index pupil_achievements_unique_uidx
  on pupil_achievements (organisation_id, student_profile_id, definition_id);
create index pupil_achievements_org_student_idx
  on pupil_achievements (organisation_id, student_profile_id, awarded_at desc);

-- ---------------------------------------------------------------------------
-- Competitions
-- ---------------------------------------------------------------------------

create table competitions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  academic_year_id uuid references academic_years (id),
  title text not null,
  description text,
  competition_type text not null
    check (competition_type in ('individual', 'class', 'house', 'year_group', 'school')),
  scoring_model text not null
    check (scoring_model in (
      'reward_points',
      'xp',
      'completed_learning_activities',
      'teacher_score',
      'quiz_score',
      'attendance'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'active', 'completed', 'archived', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  student_visible boolean not null default true,
  parent_visible boolean not null default true,
  staff_only boolean not null default false,
  result_frozen boolean not null default false,
  created_by uuid references users (id),
  completed_by uuid references users (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table competition_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  competition_id uuid not null references competitions (id) on delete cascade,
  target_type text not null
    check (target_type in ('whole_school', 'year_group', 'class', 'student', 'house')),
  year_group_id uuid references year_groups (id),
  class_id uuid references classes (id),
  student_profile_id uuid references student_profiles (id),
  house_id uuid references houses (id),
  created_at timestamptz not null default now(),
  check (
    (target_type = 'whole_school' and year_group_id is null and class_id is null and student_profile_id is null and house_id is null)
    or (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null and house_id is null)
    or (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null and house_id is null)
    or (target_type = 'student' and student_profile_id is not null and year_group_id is null and class_id is null and house_id is null)
    or (target_type = 'house' and house_id is not null and year_group_id is null and class_id is null and student_profile_id is null)
  )
);

create index competition_targets_comp_idx
  on competition_targets (organisation_id, competition_id);

create table competition_manual_scores (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  competition_id uuid not null references competitions (id) on delete cascade,
  student_profile_id uuid references student_profiles (id),
  class_id uuid references classes (id),
  house_id uuid references houses (id),
  year_group_id uuid references year_groups (id),
  score int not null check (score >= 0),
  recorded_by uuid not null references users (id),
  recorded_at timestamptz not null default now(),
  source text not null default 'teacher'
    check (source in ('teacher', 'admin_correction')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (student_profile_id is not null)::int
    + (class_id is not null)::int
    + (house_id is not null)::int
    + (year_group_id is not null)::int
    = 1
  )
);

create unique index competition_manual_scores_student_uidx
  on competition_manual_scores (competition_id, student_profile_id)
  where student_profile_id is not null;
create unique index competition_manual_scores_class_uidx
  on competition_manual_scores (competition_id, class_id)
  where class_id is not null;
create unique index competition_manual_scores_house_uidx
  on competition_manual_scores (competition_id, house_id)
  where house_id is not null;
create unique index competition_manual_scores_year_uidx
  on competition_manual_scores (competition_id, year_group_id)
  where year_group_id is not null;

create table competition_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  competition_id uuid not null references competitions (id) on delete cascade,
  rank int not null check (rank >= 1),
  entry_type text not null
    check (entry_type in ('student', 'class', 'house', 'year_group', 'school')),
  student_profile_id uuid references student_profiles (id),
  class_id uuid references classes (id),
  house_id uuid references houses (id),
  year_group_id uuid references year_groups (id),
  display_name text not null,
  score numeric not null,
  frozen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index competition_results_comp_idx
  on competition_results (organisation_id, competition_id, rank);

-- ---------------------------------------------------------------------------
-- Early learning / practice (not formal assessment)
-- ---------------------------------------------------------------------------

create table learning_activity_definitions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  title text not null,
  activity_type text not null
    check (activity_type in (
      'counting',
      'number_recognition',
      'number_ordering',
      'simple_addition',
      'letter_recognition',
      'case_matching',
      'phonics_matching',
      'word_picture_matching',
      'spelling',
      'shape_recognition',
      'colour_matching',
      'sequencing',
      'memory_matching',
      'multiple_choice',
      'picture_choice',
      'challenge'
    )),
  instructions text,
  difficulty text not null default 'easy'
    check (difficulty in ('easy', 'medium', 'challenge')),
  recommended_year_group_id uuid references year_groups (id),
  subject_id uuid references subjects (id),
  content_payload jsonb not null default '{}'::jsonb,
  attempts_allowed int check (attempts_allowed is null or attempts_allowed >= 1),
  xp_reward int not null default 0 check (xp_reward >= 0),
  completion_threshold numeric not null default 1
    check (completion_threshold >= 0 and completion_threshold <= 1),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_by uuid references users (id),
  assignment_link_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table learning_activity_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references learning_activity_definitions (id) on delete cascade,
  sort_order int not null default 0,
  prompt_text text not null,
  prompt_emoji text,
  item_type text not null
    check (item_type in (
      'single_choice',
      'multiple_choice',
      'ordering',
      'matching',
      'numeric',
      'short_exact_text',
      'picture_choice'
    )),
  choices jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  hint text,
  explanation text,
  points int not null default 1 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learning_activity_items_activity_idx
  on learning_activity_items (organisation_id, activity_id, sort_order);

create table learning_activity_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  activity_id uuid not null references learning_activity_definitions (id),
  title text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed')),
  starts_at timestamptz,
  due_at timestamptz,
  created_by uuid references users (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table learning_activity_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_activity_assignments (id) on delete cascade,
  target_type text not null
    check (target_type in ('year_group', 'class', 'student')),
  year_group_id uuid references year_groups (id),
  class_id uuid references classes (id),
  student_profile_id uuid references student_profiles (id),
  created_at timestamptz not null default now(),
  check (
    (target_type = 'year_group' and year_group_id is not null and class_id is null and student_profile_id is null)
    or (target_type = 'class' and class_id is not null and year_group_id is null and student_profile_id is null)
    or (target_type = 'student' and student_profile_id is not null and year_group_id is null and class_id is null)
  )
);

create table learning_activity_recipients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  assignment_id uuid not null references learning_activity_assignments (id) on delete cascade,
  student_profile_id uuid not null references student_profiles (id),
  created_at timestamptz not null default now(),
  unique (assignment_id, student_profile_id)
);

create index learning_activity_recipients_student_idx
  on learning_activity_recipients (organisation_id, student_profile_id, assignment_id);

create table learning_activity_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  student_profile_id uuid not null references student_profiles (id),
  activity_id uuid not null references learning_activity_definitions (id),
  assignment_id uuid references learning_activity_assignments (id),
  attempt_number int not null default 1 check (attempt_number >= 1),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score int,
  max_score int,
  completion_state text not null default 'in_progress'
    check (completion_state in ('in_progress', 'completed', 'abandoned')),
  xp_awarded int not null default 0 check (xp_awarded >= 0),
  channel text not null default 'student'
    check (channel in ('student', 'parent_assisted', 'staff')),
  launched_by_user_id uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learning_activity_attempts_student_idx
  on learning_activity_attempts (organisation_id, student_profile_id, activity_id, attempt_number);

create table learning_activity_answers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id),
  attempt_id uuid not null references learning_activity_attempts (id) on delete cascade,
  item_id uuid not null references learning_activity_items (id),
  answer_payload jsonb not null,
  is_correct boolean not null,
  points_awarded int not null default 0 check (points_awarded >= 0),
  created_at timestamptz not null default now(),
  unique (attempt_id, item_id)
);

-- Optional LMS assignment link (metadata only; practice scores never write academic results)
alter table learning_activity_definitions
  add constraint learning_activity_definitions_assignment_link_fk
  foreign key (assignment_link_id) references learning_assignments (id);

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------

select install_tenant_isolation('engagement_settings');
select install_tenant_isolation('engagement_year_group_policies');
select install_tenant_isolation('reward_categories');
select install_tenant_isolation('pupil_rewards');
select install_tenant_isolation('pupil_xp_events');
select install_tenant_isolation('achievement_definitions');
select install_tenant_isolation('pupil_achievements');
select install_tenant_isolation('competitions');
select install_tenant_isolation('competition_targets');
select install_tenant_isolation('competition_manual_scores');
select install_tenant_isolation('competition_results');
select install_tenant_isolation('learning_activity_definitions');
select install_tenant_isolation('learning_activity_items');
select install_tenant_isolation('learning_activity_assignments');
select install_tenant_isolation('learning_activity_targets');
select install_tenant_isolation('learning_activity_recipients');
select install_tenant_isolation('learning_activity_attempts');
select install_tenant_isolation('learning_activity_answers');

grant select, insert, update, delete on engagement_settings to schoolapp_app;
grant select, insert, update, delete on engagement_year_group_policies to schoolapp_app;
grant select, insert, update, delete on reward_categories to schoolapp_app;
grant select, insert, update, delete on pupil_rewards to schoolapp_app;
grant select, insert, update, delete on pupil_xp_events to schoolapp_app;
grant select, insert, update, delete on achievement_definitions to schoolapp_app;
grant select, insert, update, delete on pupil_achievements to schoolapp_app;
grant select, insert, update, delete on competitions to schoolapp_app;
grant select, insert, update, delete on competition_targets to schoolapp_app;
grant select, insert, update, delete on competition_manual_scores to schoolapp_app;
grant select, insert, update, delete on competition_results to schoolapp_app;
grant select, insert, update, delete on learning_activity_definitions to schoolapp_app;
grant select, insert, update, delete on learning_activity_items to schoolapp_app;
grant select, insert, update, delete on learning_activity_assignments to schoolapp_app;
grant select, insert, update, delete on learning_activity_targets to schoolapp_app;
grant select, insert, update, delete on learning_activity_recipients to schoolapp_app;
grant select, insert, update, delete on learning_activity_attempts to schoolapp_app;
grant select, insert, update, delete on learning_activity_answers to schoolapp_app;

-- XP ledger is append-only for the app role (corrections use a compensating event, never UPDATE)
revoke update, delete on pupil_xp_events from schoolapp_app;
grant select, insert on pupil_xp_events to schoolapp_app;

-- Frozen competition results must not be rewritten by later scoring
revoke update, delete on competition_results from schoolapp_app;
grant select, insert on competition_results to schoolapp_app;

drop trigger if exists engagement_settings_updated_at on engagement_settings;
create trigger engagement_settings_updated_at before update on engagement_settings
  for each row execute function set_updated_at();
drop trigger if exists engagement_year_group_policies_updated_at on engagement_year_group_policies;
create trigger engagement_year_group_policies_updated_at before update on engagement_year_group_policies
  for each row execute function set_updated_at();
drop trigger if exists reward_categories_updated_at on reward_categories;
create trigger reward_categories_updated_at before update on reward_categories
  for each row execute function set_updated_at();
drop trigger if exists pupil_rewards_updated_at on pupil_rewards;
create trigger pupil_rewards_updated_at before update on pupil_rewards
  for each row execute function set_updated_at();
drop trigger if exists achievement_definitions_updated_at on achievement_definitions;
create trigger achievement_definitions_updated_at before update on achievement_definitions
  for each row execute function set_updated_at();
drop trigger if exists competitions_updated_at on competitions;
create trigger competitions_updated_at before update on competitions
  for each row execute function set_updated_at();
drop trigger if exists competition_manual_scores_updated_at on competition_manual_scores;
create trigger competition_manual_scores_updated_at before update on competition_manual_scores
  for each row execute function set_updated_at();
drop trigger if exists learning_activity_definitions_updated_at on learning_activity_definitions;
create trigger learning_activity_definitions_updated_at before update on learning_activity_definitions
  for each row execute function set_updated_at();
drop trigger if exists learning_activity_items_updated_at on learning_activity_items;
create trigger learning_activity_items_updated_at before update on learning_activity_items
  for each row execute function set_updated_at();
drop trigger if exists learning_activity_assignments_updated_at on learning_activity_assignments;
create trigger learning_activity_assignments_updated_at before update on learning_activity_assignments
  for each row execute function set_updated_at();
drop trigger if exists learning_activity_attempts_updated_at on learning_activity_attempts;
create trigger learning_activity_attempts_updated_at before update on learning_activity_attempts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Same-org integrity + actor stamping
-- ---------------------------------------------------------------------------

create or replace function phase19_same_org_student(p_org uuid, p_student uuid)
returns void
language plpgsql
as $$
begin
  if p_student is null then
    return;
  end if;
  if not exists (
    select 1 from student_profiles s
    where s.id = p_student and s.organisation_id = p_org
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase19_same_org_class(p_org uuid, p_class uuid)
returns void
language plpgsql
as $$
begin
  if p_class is null then
    return;
  end if;
  if not exists (
    select 1 from classes c
    where c.id = p_class and c.organisation_id = p_org
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase19_same_org_year_group(p_org uuid, p_year uuid)
returns void
language plpgsql
as $$
begin
  if p_year is null then
    return;
  end if;
  if not exists (
    select 1 from year_groups g
    where g.id = p_year and g.organisation_id = p_org
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase19_same_org_house(p_org uuid, p_house uuid)
returns void
language plpgsql
as $$
begin
  if p_house is null then
    return;
  end if;
  if not exists (
    select 1 from houses h
    where h.id = p_house and h.organisation_id = p_org
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase19_same_org_subject(p_org uuid, p_subject uuid)
returns void
language plpgsql
as $$
begin
  if p_subject is null then
    return;
  end if;
  if not exists (
    select 1 from subjects s
    where s.id = p_subject and s.organisation_id = p_org
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function phase19_lock_awarded_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.awarded_by := old.awarded_by;
    new.awarded_at := old.awarded_at;
    new.student_profile_id := old.student_profile_id;
    new.category_id := old.category_id;
    new.points := old.points;
    new.xp_awarded := old.xp_awarded;
    new.source_type := old.source_type;
    new.source_id := old.source_id;
  elsif app_current_user_id() is not null then
    new.awarded_by := app_current_user_id();
    new.awarded_at := coalesce(new.awarded_at, now());
  elsif new.awarded_by is null then
    raise exception 'engagement_actor_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function phase19_lock_created_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.created_by := old.created_by;
  elsif app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

create or replace function phase19_lock_recorded_by()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.recorded_by := old.recorded_by;
    new.recorded_at := old.recorded_at;
    new.source := old.source;
  elsif app_current_user_id() is not null then
    new.recorded_by := app_current_user_id();
    new.recorded_at := coalesce(new.recorded_at, now());
  elsif new.recorded_by is null then
    raise exception 'engagement_actor_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function engagement_year_group_policies_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase19_same_org_year_group(new.organisation_id, new.year_group_id);
  return new;
end;
$$;

drop trigger if exists engagement_year_group_policies_integrity_tg on engagement_year_group_policies;
create trigger engagement_year_group_policies_integrity_tg
  before insert or update on engagement_year_group_policies
  for each row execute function engagement_year_group_policies_integrity_tg();

create or replace function pupil_rewards_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase19_same_org_class(new.organisation_id, new.class_id);
  perform phase19_same_org_house(new.organisation_id, new.house_id);
  perform phase19_same_org_subject(new.organisation_id, new.subject_id);
  if not exists (
    select 1 from reward_categories c
    where c.id = new.category_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'invalid_status_transition' using errcode = '23514';
  end if;
  if new.status in ('revoked', 'corrected') and new.revoke_reason is null then
    raise exception 'engagement_revoke_reason_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists pupil_rewards_actor_tg on pupil_rewards;
create trigger pupil_rewards_actor_tg
  before insert or update on pupil_rewards
  for each row execute function phase19_lock_awarded_by();

drop trigger if exists pupil_rewards_integrity_tg on pupil_rewards;
create trigger pupil_rewards_integrity_tg
  before insert or update on pupil_rewards
  for each row execute function pupil_rewards_integrity_tg();

create or replace function pupil_xp_events_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'engagement_xp_immutable' using errcode = '23514';
  end if;
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  if app_current_user_id() is not null then
    new.awarded_by := coalesce(new.awarded_by, app_current_user_id());
  end if;
  return new;
end;
$$;

drop trigger if exists pupil_xp_events_integrity_tg on pupil_xp_events;
create trigger pupil_xp_events_integrity_tg
  before insert or update on pupil_xp_events
  for each row execute function pupil_xp_events_integrity_tg();

create or replace function pupil_achievements_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.student_profile_id := old.student_profile_id;
    new.definition_id := old.definition_id;
    new.awarded_by := old.awarded_by;
    new.awarded_at := old.awarded_at;
    new.source := old.source;
  end if;
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  if not exists (
    select 1 from achievement_definitions d
    where d.id = new.definition_id and d.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.source = 'manual' and app_current_user_id() is not null then
    new.awarded_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists pupil_achievements_integrity_tg on pupil_achievements;
create trigger pupil_achievements_integrity_tg
  before insert or update on pupil_achievements
  for each row execute function pupil_achievements_integrity_tg();

create or replace function competitions_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if new.academic_year_id is not null and not exists (
    select 1 from academic_years y
    where y.id = new.academic_year_id and y.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.created_by := old.created_by;
    if old.result_frozen and new.result_frozen is distinct from true then
      raise exception 'competition_results_frozen' using errcode = '23514';
    end if;
    if old.status = 'completed' and new.status not in ('completed', 'archived') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if old.status = 'cancelled' and new.status not in ('cancelled', 'archived') then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
    if old.status = 'archived' then
      raise exception 'invalid_status_transition' using errcode = '23514';
    end if;
  elsif app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists competitions_integrity_tg on competitions;
create trigger competitions_integrity_tg
  before insert or update on competitions
  for each row execute function competitions_integrity_tg();

create or replace function competition_targets_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from competitions c
    where c.id = new.competition_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase19_same_org_year_group(new.organisation_id, new.year_group_id);
  perform phase19_same_org_class(new.organisation_id, new.class_id);
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase19_same_org_house(new.organisation_id, new.house_id);
  return new;
end;
$$;

drop trigger if exists competition_targets_integrity_tg on competition_targets;
create trigger competition_targets_integrity_tg
  before insert or update on competition_targets
  for each row execute function competition_targets_integrity_tg();

create or replace function competition_manual_scores_integrity_tg()
returns trigger
language plpgsql
as $$
declare
  v_frozen boolean;
begin
  select result_frozen into v_frozen
  from competitions
  where id = new.competition_id and organisation_id = new.organisation_id;
  if not found then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if v_frozen then
    raise exception 'competition_results_frozen' using errcode = '23514';
  end if;
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase19_same_org_class(new.organisation_id, new.class_id);
  perform phase19_same_org_house(new.organisation_id, new.house_id);
  perform phase19_same_org_year_group(new.organisation_id, new.year_group_id);
  return new;
end;
$$;

drop trigger if exists competition_manual_scores_actor_tg on competition_manual_scores;
create trigger competition_manual_scores_actor_tg
  before insert or update on competition_manual_scores
  for each row execute function phase19_lock_recorded_by();

drop trigger if exists competition_manual_scores_integrity_tg on competition_manual_scores;
create trigger competition_manual_scores_integrity_tg
  before insert or update on competition_manual_scores
  for each row execute function competition_manual_scores_integrity_tg();

create or replace function competition_results_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'competition_results_frozen' using errcode = '23514';
  end if;
  if not exists (
    select 1 from competitions c
    where c.id = new.competition_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  perform phase19_same_org_class(new.organisation_id, new.class_id);
  perform phase19_same_org_house(new.organisation_id, new.house_id);
  perform phase19_same_org_year_group(new.organisation_id, new.year_group_id);
  return new;
end;
$$;

drop trigger if exists competition_results_integrity_tg on competition_results;
create trigger competition_results_integrity_tg
  before insert or update on competition_results
  for each row execute function competition_results_integrity_tg();

create or replace function learning_activity_definitions_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase19_same_org_year_group(new.organisation_id, new.recommended_year_group_id);
  perform phase19_same_org_subject(new.organisation_id, new.subject_id);
  if new.assignment_link_id is not null and not exists (
    select 1 from learning_assignments a
    where a.id = new.assignment_link_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.created_by := old.created_by;
  elsif app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists learning_activity_definitions_integrity_tg on learning_activity_definitions;
create trigger learning_activity_definitions_integrity_tg
  before insert or update on learning_activity_definitions
  for each row execute function learning_activity_definitions_integrity_tg();

create or replace function learning_activity_items_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_activity_definitions d
    where d.id = new.activity_id and d.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_activity_items_integrity_tg on learning_activity_items;
create trigger learning_activity_items_integrity_tg
  before insert or update on learning_activity_items
  for each row execute function learning_activity_items_integrity_tg();

create or replace function learning_activity_assignments_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_activity_definitions d
    where d.id = new.activity_id and d.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.created_by := old.created_by;
  elsif app_current_user_id() is not null then
    new.created_by := app_current_user_id();
  end if;
  return new;
end;
$$;

drop trigger if exists learning_activity_assignments_integrity_tg on learning_activity_assignments;
create trigger learning_activity_assignments_integrity_tg
  before insert or update on learning_activity_assignments
  for each row execute function learning_activity_assignments_integrity_tg();

create or replace function learning_activity_targets_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_activity_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase19_same_org_year_group(new.organisation_id, new.year_group_id);
  perform phase19_same_org_class(new.organisation_id, new.class_id);
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  return new;
end;
$$;

drop trigger if exists learning_activity_targets_integrity_tg on learning_activity_targets;
create trigger learning_activity_targets_integrity_tg
  before insert or update on learning_activity_targets
  for each row execute function learning_activity_targets_integrity_tg();

create or replace function learning_activity_recipients_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from learning_activity_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  return new;
end;
$$;

drop trigger if exists learning_activity_recipients_integrity_tg on learning_activity_recipients;
create trigger learning_activity_recipients_integrity_tg
  before insert or update on learning_activity_recipients
  for each row execute function learning_activity_recipients_integrity_tg();

create or replace function learning_activity_attempts_integrity_tg()
returns trigger
language plpgsql
as $$
begin
  perform phase19_same_org_student(new.organisation_id, new.student_profile_id);
  if not exists (
    select 1 from learning_activity_definitions d
    where d.id = new.activity_id and d.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.assignment_id is not null and not exists (
    select 1 from learning_activity_assignments a
    where a.id = new.assignment_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.organisation_id := old.organisation_id;
    new.student_profile_id := old.student_profile_id;
    new.activity_id := old.activity_id;
    new.channel := old.channel;
    new.launched_by_user_id := old.launched_by_user_id;
    if old.completion_state = 'completed' then
      new.score := old.score;
      new.max_score := old.max_score;
      new.xp_awarded := old.xp_awarded;
      new.completed_at := old.completed_at;
      new.completion_state := old.completion_state;
    end if;
  elsif app_current_user_id() is not null then
    new.launched_by_user_id := coalesce(new.launched_by_user_id, app_current_user_id());
  end if;
  return new;
end;
$$;

drop trigger if exists learning_activity_attempts_integrity_tg on learning_activity_attempts;
create trigger learning_activity_attempts_integrity_tg
  before insert or update on learning_activity_attempts
  for each row execute function learning_activity_attempts_integrity_tg();

create or replace function learning_activity_answers_integrity_tg()
returns trigger
language plpgsql
as $$
declare
  v_state text;
begin
  select completion_state into v_state
  from learning_activity_attempts
  where id = new.attempt_id and organisation_id = new.organisation_id;
  if not found then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if v_state = 'completed' then
    raise exception 'learning_attempt_completed' using errcode = '23514';
  end if;
  if not exists (
    select 1 from learning_activity_items i
    where i.id = new.item_id and i.organisation_id = new.organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_activity_answers_integrity_tg on learning_activity_answers;
create trigger learning_activity_answers_integrity_tg
  before insert or update on learning_activity_answers
  for each row execute function learning_activity_answers_integrity_tg();

-- ---------------------------------------------------------------------------
-- Org defaults
-- ---------------------------------------------------------------------------

alter table achievement_definitions
  add column if not exists sort_order int not null default 0;

create or replace function ensure_organisation_phase19_defaults(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_organisation_id is null then
    return;
  end if;
  if nullif(current_setting('app.organisation_id', true), '') is not null
     and app_current_organisation_id() is distinct from p_organisation_id
     and not app_is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if app_current_user_id() is not null and not app_is_platform_admin() and not exists (
    select 1 from organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.user_id = app_current_user_id()
      and m.status = 'active'
      and m.ended_at is null
  ) then
    raise exception 'tenant_context_membership_required' using errcode = '42501';
  end if;

  insert into engagement_settings (organisation_id)
  values (p_organisation_id)
  on conflict (organisation_id) do nothing;

  insert into reward_categories (
    organisation_id, key, name, default_points, grants_xp, default_xp, sort_order, is_system
  )
  values
    (p_organisation_id, 'excellent_work', 'Excellent Work', 5, false, 0, 1, true),
    (p_organisation_id, 'kindness', 'Kindness', 5, false, 0, 2, true),
    (p_organisation_id, 'great_effort', 'Great Effort', 5, false, 0, 3, true),
    (p_organisation_id, 'reading_star', 'Reading Star', 5, false, 0, 4, true),
    (p_organisation_id, 'teamwork', 'Teamwork', 5, false, 0, 5, true),
    (p_organisation_id, 'improvement', 'Improvement', 5, false, 0, 6, true),
    (p_organisation_id, 'helpfulness', 'Helpfulness', 5, false, 0, 7, true),
    (p_organisation_id, 'creativity', 'Creativity', 5, false, 0, 8, true),
    (p_organisation_id, 'resilience', 'Resilience', 5, false, 0, 9, true),
    (p_organisation_id, 'school_values', 'School values', 5, false, 0, 10, true),
    (p_organisation_id, 'attendance_achievement', 'Attendance achievement', 0, false, 0, 11, true),
    (p_organisation_id, 'star_of_the_week', 'Star of the Week', 0, false, 0, 12, true)
  on conflict (organisation_id, key) do nothing;

  insert into achievement_definitions (
    organisation_id, key, title, description, icon_key, criteria_type, threshold, sort_order
  )
  values
    (p_organisation_id, 'first_five_activities', 'First 5 Activities', 'Complete five learning activities.', 'star', 'learning_activity_count', 5, 1),
    (p_organisation_id, 'maths_explorer', 'Maths Explorer', 'Complete three practice activities.', 'chart', 'challenge_completed_count', 3, 2),
    (p_organisation_id, 'reading_star', 'Reading Star', 'Recognised for reading.', 'book', 'manual', null, 3),
    (p_organisation_id, 'xp_100', '100 XP', 'Reach 100 learning XP.', 'flag', 'xp_total', 100, 4),
    (p_organisation_id, 'xp_500', '500 XP', 'Reach 500 learning XP.', 'flag', 'xp_total', 500, 5)
  on conflict (organisation_id, key) do nothing;
end;
$$;

revoke all on function ensure_organisation_phase19_defaults(uuid) from public;
grant execute on function ensure_organisation_phase19_defaults(uuid) to schoolapp_app;
