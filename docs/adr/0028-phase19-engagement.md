# ADR 0028 — Phase 19 engagement: rewards, XP, leaderboard privacy, practice, and scoring

**Status:** Accepted  
**Date:** 2026-08-25

## Context

Schoolapp needed positive recognition, house/class competitions, age-appropriate practice (especially Reception–KS1), and parent visibility without becoming a social network. Phase 11 already records behaviour positives. Phase 6 already has Student Portal policy (school → year group → class → pupil). Phase 7 LMS already owns homework. Phase 8 owns formal assessment. Houses already exist as academic entities.

Children’s Code and UK school practice require: no public ranking by default, no named individual leaderboards for younger pupils, no student-to-student chat, no client-trusted scores, and no parent impersonation of a student account.

## Decision

1. **Rewards are not behaviour sanctions.** `pupil_rewards` / `reward_categories` are a separate positive-recognition model. Phase 11 `positive_behaviour_records` remain pastoral/behaviour history. Engagement may sit alongside them; it does not reuse sanction rows or negative points.
2. **XP is not reward points.** Reward points are school recognition. XP is learning-engagement progression (`pupil_xp_events`). They are never the same ledger. Completing practice may grant XP; it grants reward points only when school policy `grantRewardPointsOnLearning` is on. No shop, currency, or loot. The XP ledger is append-only: revoking a reward that granted XP inserts a compensating `source_type = 'reversal'` row so derived totals exclude it without deleting history. Frozen competition snapshots are unchanged.
3. **Leaderboard privacy is school policy, not a client query.** Defaults: leaderboards off; individual named ranking off; anonymise on; display `first_name_initial`. Allowed scopes are house, class team, anonymised individual, or named individual when enabled. APIs ignore client attempts to request unrestricted names. Entries never include DOB, admission number, email, SEN, medical, or safeguarding data.
4. **Early-learning practice is not formal assessment.** Scores stay on `learning_activity_attempts`. They are not written to Phase 8 results. LMS assignments remain the homework lifecycle; practice may optionally link `assignment_link_id` later without duplicating that lifecycle.
5. **Parent-assisted learning is not impersonation.** A parent with live guardianship + `portal_access` may launch designated activities when year-group `parentAssistedMode` is on. The attempt is stored against the pupil with `channel = parent_assisted`. Parents never receive a student JWT. In-progress attempts resume only on the same channel; start/submit from the other channel cannot hijack the attempt. Parent play APIs (list, load items, start, submit) require `parentAssistedMode`. Year-group policy also filters activity types: early-learning types vs `challenge`.
6. **Future AI is draft → review → publish only.** Content uses a validated item schema (`single_choice`, `multiple_choice`, `ordering`, `matching`, `numeric`, `short_exact_text`, `picture_choice`). Generated content must start as `draft`. Phase 19 does not call LLM APIs and does not auto-grade essays.
7. **Scoring is server-authoritative.** Clients submit answers only. The server decides correctness, score, completion, XP, achievements, and leaderboard contribution. Idempotent XP/achievement keys prevent double award on retry. Students cannot award themselves rewards.

Student Portal enablement stays on the existing Phase 6 policy. Engagement adds organisation settings plus year-group overlays (early learning, parent-assisted, child-friendly UI, competitions, leaderboards). Age bands are not hard-coded globally.

Houses are reused (`houses.short_code`, `colour`, `active`). House points are derived from authorised reward records, not an untraceable counter. Completing a competition freezes `competition_results` so later rewards cannot rewrite history.

## Consequences

- Teachers award only assigned pupils; school-wide manage is a distinct capability.
- Parent/student payloads omit internal notes and revoke reasons. Year-group `rewardsEnabled` / `achievementsEnabled` gate new grants and parent/student visibility; staff can still oversee assigned records.
- Platform Admin has no school engagement browse.
- Greenwood demo: house leaderboards on, individual ranking off; Reception–Y2 parent-assisted; Amelia (Y3) uses student practice.
- Streaks and aggressive loss messaging are out of this phase.

## Rejected alternatives

- Reusing behaviour incident rows as rewards — mixes sanctions with praise and parent visibility.
- A second Student Portal on/off flag — would diverge from Phase 6 precedence.
- Client-computed XP/score — trivial spoofing.
- Named whole-school pupil ranking by default — Children’s Code risk.
- Parent login-as-child — breaks audit, safeguarding, and session boundaries.
- Writing practice scores into formal results — pollutes statutory/academic reporting.
- Executable criteria expressions or plugin activity types — unsafe and unreviewable.
- Student-to-student messaging or public profiles — social network, out of product scope.
