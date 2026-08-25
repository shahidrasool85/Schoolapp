-- Phase 19 follow-up: compensating XP reversals stay append-only.
-- The application role cannot UPDATE/DELETE pupil_xp_events, so a revoked
-- reward that granted XP must insert a negative reversal row keyed to the
-- same source_id with source_type = 'reversal'.

alter table pupil_xp_events drop constraint if exists pupil_xp_events_amount_check;
alter table pupil_xp_events drop constraint if exists pupil_xp_events_source_type_check;
alter table pupil_xp_events drop constraint if exists pupil_xp_events_amount_source_chk;

alter table pupil_xp_events
  add constraint pupil_xp_events_source_type_check
  check (source_type in ('learning_attempt', 'reward', 'achievement', 'manual', 'reversal'));

alter table pupil_xp_events
  add constraint pupil_xp_events_amount_source_chk
  check (
    (source_type = 'reversal' and amount < 0)
    or (source_type <> 'reversal' and amount > 0)
  );
