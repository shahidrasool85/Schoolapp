# ADR 0032 — Canonical user profiles and profile photos

**Status:** Accepted  
**Date:** 2026-09-02

## Context

LuvLearn people already exist as global `users` plus organisation-scoped memberships, `staff_profiles`, `student_profiles`, and `guardianships`. Staff detail screens mainly showed name, email, job title, employee number, status, and roles. Profile photos did not exist. Product needs one canonical person record per human, optional photos that render consistently, and a clear split between self-editable contact fields and school-controlled employment/relationship fields.

Existing object storage (`stored_objects` + `@schoolapp/storage`) already stores private files and serves them through authorised proxy downloads. Production may still use the filesystem adapter on Plesk.

## Decision

1. **No new person table.** Canonical identity remains `users`. Staff employment fields stay on `staff_profiles`. Student-specific fields stay on `student_profiles`. Parent links stay on `guardianships`.
2. **Contact fields on `users`.** Nullable `title`, `phone`, and address lines are shared across roles so a Teacher/Headteacher/School Admin person is still one profile.
3. **One current photo per person-in-school.** `organisation_memberships.profile_photo_stored_object_id` points at `stored_objects`. Domain is `profile_photo`. `owner_record_id` is the user id. Object key: `org/{orgId}/profiles/photos/{userId}/{objectId}`.
4. **Reuse the existing storage port.** Bytes are never stored in PostgreSQL. No second storage mechanism. Downloads remain `GET /api/v1/files/:id` after live permission checks. Public branding and admissions endpoints cannot serve user photos.
5. **Self-edit vs school-controlled.** Staff and parents may update title, preferred name, phone, address, and their own photo. School Admin (via existing permissions) controls legal name, email, employee number, job title, roles, membership/account status, assignments, and guardian relationship/portal fields. Students cannot self-edit official fields or the official pupil photo.
6. **Name model stays as-is.** Reuse `users.full_name` and `users.preferred_name`. UI may show a friendly display name (`title` + preferred/legal). Student legal names remain on `student_profiles.legal_name`.
7. **Filesystem remains valid.** This phase does not require AWS/S3. Production (`NODE_ENV=production`) that uses the filesystem driver **must** set `OBJECT_STORAGE_FS_ROOT` to an absolute persistent path outside the deploy tree. Missing, relative, temp, or in-checkout roots fail closed at startup.

## Consequences

- Migration `0051_user_profiles.sql` is additive and nullable. Existing users, invitations, and role assignments are not rewritten.
- School-managed contact updates use SECURITY DEFINER `update_org_user_contact` so `users_update_self` is not widened.
- Photo pointer updates use SECURITY DEFINER `set_membership_profile_photo`. Replacing a photo retires the previous stored object.
- Audit events record field categories (`profile.contact.updated`, `profile.photo.replaced` / `removed`), not full address dumps.
- Official student photos are School Admin-controlled (`students.profiles.manage`). Parent-submitted photo approval is deferred.
- Production filesystem storage fails closed unless `OBJECT_STORAGE_FS_ROOT` is an explicit persistent absolute path. Development/test may still default to a local temp or `.data` directory.

## Rejected alternatives

- A new `people` / `person_profiles` table beside `users`.
- Storing image blobs in PostgreSQL.
- Public or predictable unauthenticated photo URLs.
- Letting staff edit their own roles, employee number, or job title.
- Letting parents overwrite the official pupil photo.
- Requiring S3 for this phase.
