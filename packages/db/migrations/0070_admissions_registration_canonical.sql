-- Registration/application canonical identity and contact fields.
-- Additive only. Existing admissions forms, submissions, and enrolment keep working.
-- Faith/religion stays an application-only custom question (not ethnicity, not a pupil column).
-- "How did you hear about us?" stays a configurable form choice. Campaign tracking is unchanged.
-- No admissions fee, acceptance contract, or payment behaviour is introduced here.
-- The 0038 conversion trigger is left in place: it still calls this function and structured medical mapping.

alter table admissions_applications
  add column if not exists pupil_legal_forename text,
  add column if not exists pupil_legal_surname text,
  add column if not exists nationality text,
  add column if not exists intended_term_id uuid references terms (id) on delete restrict;

alter table admissions_applications drop constraint if exists admissions_applications_forename_length;
alter table admissions_applications add constraint admissions_applications_forename_length
  check (pupil_legal_forename is null or char_length(trim(pupil_legal_forename)) between 1 and 80);

alter table admissions_applications drop constraint if exists admissions_applications_surname_length;
alter table admissions_applications add constraint admissions_applications_surname_length
  check (pupil_legal_surname is null or char_length(trim(pupil_legal_surname)) between 1 and 80);

alter table admissions_applications drop constraint if exists admissions_applications_nationality_length;
alter table admissions_applications add constraint admissions_applications_nationality_length
  check (nationality is null or char_length(trim(nationality)) between 1 and 80);

create index if not exists admissions_applications_intended_term_idx
  on admissions_applications (intended_term_id)
  where intended_term_id is not null;

alter table student_profiles
  add column if not exists nationality text;

alter table student_profiles drop constraint if exists student_profiles_nationality_length;
alter table student_profiles add constraint student_profiles_nationality_length
  check (nationality is null or char_length(trim(nationality)) between 1 and 80);

alter table admissions_application_contacts
  add column if not exists title text,
  add column if not exists alternative_telephone text,
  add column if not exists occupation text;

alter table admissions_application_contacts drop constraint if exists admissions_application_contacts_title_length;
alter table admissions_application_contacts add constraint admissions_application_contacts_title_length
  check (title is null or char_length(trim(title)) between 1 and 20);

alter table admissions_application_contacts drop constraint if exists admissions_application_contacts_alt_phone_length;
alter table admissions_application_contacts add constraint admissions_application_contacts_alt_phone_length
  check (alternative_telephone is null or char_length(trim(alternative_telephone)) between 1 and 40);

alter table admissions_application_contacts drop constraint if exists admissions_application_contacts_occupation_length;
alter table admissions_application_contacts add constraint admissions_application_contacts_occupation_length
  check (occupation is null or char_length(trim(occupation)) between 1 and 120);

-- A term belongs to one organisation and one academic year. Do not accept a cross-school
-- or cross-year term on an application.
create or replace function admissions_applications_entry_term_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_year uuid;
begin
  if new.intended_term_id is null then
    return new;
  end if;
  select t.academic_year_id into v_year
  from terms t
  where t.id = new.intended_term_id
    and t.organisation_id = new.organisation_id;
  if not found then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if new.intended_academic_year_id is not null and v_year is distinct from new.intended_academic_year_id then
    raise exception 'validation_failed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists admissions_applications_entry_term_tg on admissions_applications;
create trigger admissions_applications_entry_term_tg
  before insert or update of intended_term_id, intended_academic_year_id on admissions_applications
  for each row execute function admissions_applications_entry_term_tg();

-- Fill only blank global profile fields from an application contact.
-- Never overwrites a value a person already has (they may belong to another school).
-- Does not change full_name. Occupation stays on the application contact.
create or replace function fill_empty_user_profile_from_admissions_contact(
  p_user_id uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contact admissions_application_contacts%rowtype;
begin
  select * into v_contact
  from admissions_application_contacts
  where id = p_contact_id;
  if not found then
    return;
  end if;

  update users u
  set title = case
        when nullif(trim(u.title), '') is null then left(nullif(trim(v_contact.title), ''), 20)
        else u.title
      end,
      phone = case
        when nullif(trim(u.phone), '') is null then left(nullif(trim(v_contact.telephone), ''), 40)
        else u.phone
      end,
      alternative_phone = case
        when nullif(trim(u.alternative_phone), '') is null then left(nullif(trim(v_contact.alternative_telephone), ''), 40)
        else u.alternative_phone
      end,
      address_line1 = case
        when nullif(trim(u.address_line1), '') is null then left(nullif(trim(v_contact.address_line1), ''), 120)
        else u.address_line1
      end,
      address_line2 = case
        when nullif(trim(u.address_line2), '') is null then left(nullif(trim(v_contact.address_line2), ''), 120)
        else u.address_line2
      end,
      address_town = case
        when nullif(trim(u.address_town), '') is null then left(nullif(trim(v_contact.address_town), ''), 80)
        else u.address_town
      end,
      address_postcode = case
        when nullif(trim(u.address_postcode), '') is null then left(nullif(trim(v_contact.address_postcode), ''), 16)
        else u.address_postcode
      end,
      updated_at = now()
  where u.id = p_user_id
    and u.email = v_contact.email
    and (
      (nullif(trim(u.title), '') is null and nullif(trim(v_contact.title), '') is not null)
      or (nullif(trim(u.phone), '') is null and nullif(trim(v_contact.telephone), '') is not null)
      or (nullif(trim(u.alternative_phone), '') is null and nullif(trim(v_contact.alternative_telephone), '') is not null)
      or (nullif(trim(u.address_line1), '') is null and nullif(trim(v_contact.address_line1), '') is not null)
      or (nullif(trim(u.address_line2), '') is null and nullif(trim(v_contact.address_line2), '') is not null)
      or (nullif(trim(u.address_town), '') is null and nullif(trim(v_contact.address_town), '') is not null)
      or (nullif(trim(u.address_postcode), '') is null and nullif(trim(v_contact.address_postcode), '') is not null)
    );
end;
$$;

revoke all on function fill_empty_user_profile_from_admissions_contact(uuid, uuid) from public;
grant execute on function fill_empty_user_profile_from_admissions_contact(uuid, uuid) to schoolapp_app;

create or replace function apply_admissions_canonical_conversion(
  p_organisation_id uuid,
  p_application_id uuid,
  p_student_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app admissions_applications%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_canonical jsonb;
  v_medical jsonb;
  v_contact admissions_application_contacts%rowtype;
  v_failed integer := 0;
  v_user_id uuid;
  v_mapped jsonb;
  v_forename text;
  v_surname text;
begin
  select * into v_app
  from admissions_applications
  where id = p_application_id and organisation_id = p_organisation_id;
  if not found then
    return;
  end if;
  select * into v_sub
  from admissions_form_submissions
  where application_id = p_application_id
    and organisation_id = p_organisation_id
  order by submitted_at desc nulls last, created_at desc
  limit 1;

  v_canonical := coalesce(v_sub.canonical_snapshot, v_app.extra_fields->'canonical', '{}'::jsonb);
  v_medical := coalesce(v_canonical->'medical', '{}'::jsonb);
  v_forename := nullif(trim(v_app.pupil_legal_forename), '');
  v_surname := nullif(trim(v_app.pupil_legal_surname), '');

  update student_profiles
  set legal_name = coalesce(nullif(legal_name, ''), v_app.pupil_legal_name),
      gender = coalesce(gender, v_app.gender),
      nationality = coalesce(nullif(nationality, ''), nullif(trim(v_app.nationality), '')),
      address_line1 = coalesce(address_line1, v_app.address_line1),
      address_line2 = coalesce(address_line2, v_app.address_line2),
      address_town = coalesce(address_town, v_app.address_town),
      address_postcode = coalesce(address_postcode, v_app.address_postcode),
      updated_at = now()
  where id = p_student_profile_id and organisation_id = p_organisation_id;

  update users u
  set preferred_name = coalesce(u.preferred_name, v_app.pupil_preferred_name),
      date_of_birth = coalesce(u.date_of_birth, v_app.date_of_birth),
      updated_at = now()
  from student_profiles p
  where p.id = p_student_profile_id
    and p.organisation_id = p_organisation_id
    and u.id = p.user_id;

  -- Name parts are stored as collected. A legacy full legal name is never split.
  if v_forename is not null or v_surname is not null then
    insert into student_statutory_profiles (
      student_profile_id, organisation_id, legal_forename, legal_surname
    ) values (
      p_student_profile_id,
      p_organisation_id,
      v_forename,
      v_surname
    )
    on conflict (student_profile_id) do update
    set legal_forename = coalesce(nullif(student_statutory_profiles.legal_forename, ''), excluded.legal_forename),
        legal_surname = coalesce(nullif(student_statutory_profiles.legal_surname, ''), excluded.legal_surname),
        updated_at = now();
  end if;

  if v_medical <> '{}'::jsonb then
    insert into student_additional_needs (
      organisation_id, student_profile_id, allergies, medical_conditions, medication,
      dietary_requirements, send_notes, source_application_id, source_submission_id
    ) values (
      p_organisation_id,
      p_student_profile_id,
      nullif(v_medical->>'allergies', ''),
      nullif(v_medical->>'conditions', ''),
      nullif(v_medical->>'medication', ''),
      nullif(v_medical->>'dietary', ''),
      nullif(v_medical->>'sendNotes', ''),
      p_application_id,
      v_sub.id
    )
    on conflict (student_profile_id) do update
    set allergies = coalesce(student_additional_needs.allergies, excluded.allergies),
        medical_conditions = coalesce(student_additional_needs.medical_conditions, excluded.medical_conditions),
        medication = coalesce(student_additional_needs.medication, excluded.medication),
        dietary_requirements = coalesce(student_additional_needs.dietary_requirements, excluded.dietary_requirements),
        send_notes = coalesce(student_additional_needs.send_notes, excluded.send_notes),
        source_application_id = coalesce(student_additional_needs.source_application_id, excluded.source_application_id),
        source_submission_id = coalesce(student_additional_needs.source_submission_id, excluded.source_submission_id),
        updated_at = now();
  end if;

  for v_contact in
    select * from admissions_application_contacts
    where application_id = p_application_id
      and organisation_id = p_organisation_id
      and email is not null
      and not is_emergency
  loop
    if not exists (
      select 1 from guardianships g
      join users u on u.id = g.guardian_user_id
      where g.student_profile_id = p_student_profile_id
        and g.organisation_id = p_organisation_id
        and g.ended_on is null
        and u.email = v_contact.email
    ) then
      begin
        perform link_guardian(
          v_app.converted_by,
          p_organisation_id,
          p_student_profile_id,
          v_contact.email,
          v_contact.full_name,
          v_contact.relationship,
          v_contact.has_parental_responsibility,
          v_contact.is_emergency,
          false,
          false,
          case when v_contact.is_primary then 1 else 2 end::smallint
        );
      exception when others then
        v_failed := v_failed + 1;
      end;
    end if;

    -- Profile fill is outside the link exception. A failed fill must not look like success.
    select u.id into v_user_id from users u where u.email = v_contact.email;
    if v_user_id is not null then
      perform fill_empty_user_profile_from_admissions_contact(v_user_id, v_contact.id);
    end if;
  end loop;

  v_mapped := jsonb_build_array('identity', 'address', 'additional_needs');
  if v_failed = 0 then
    v_mapped := v_mapped || jsonb_build_array('guardians');
  end if;
  if v_forename is not null or v_surname is not null then
    v_mapped := v_mapped || jsonb_build_array('legal_name_parts');
  end if;
  if nullif(trim(v_app.nationality), '') is not null then
    v_mapped := v_mapped || jsonb_build_array('nationality');
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    v_app.converted_by,
    'admissions.form.submission_mapped',
    'admissions_application',
    p_application_id,
    jsonb_build_object(
      'studentProfileId', p_student_profile_id,
      'mapped', v_mapped,
      'guardianLinkFailures', v_failed
    )
  );
end;
$$;

revoke all on function apply_admissions_canonical_conversion(uuid, uuid, uuid) from public;
grant execute on function apply_admissions_canonical_conversion(uuid, uuid, uuid) to schoolapp_app;

create or replace function get_published_admissions_form(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_brand record;
begin
  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  select * into v_brand from get_public_school_branding(p_organisation_id);

  return jsonb_build_object(
    'form', jsonb_build_object(
      'publicId', v_form.public_id,
      'slug', v_form.slug,
      'formType', v_form.form_type,
      'name', v_form.name,
      'description', v_form.description,
      'opensAt', v_form.opens_at,
      'closesAt', v_form.closes_at,
      'successTitle', v_form.success_title,
      'successText', v_form.success_text,
      'privacyNoticeUrl', v_form.privacy_notice_url,
      'privacyNoticeText', v_form.privacy_notice_text,
      'allowedAcademicYearIds', to_jsonb(v_form.allowed_academic_year_ids),
      'allowedYearGroupIds', to_jsonb(v_form.allowed_year_group_ids)
    ),
    'organisation', jsonb_build_object(
      'slug', v_org.slug,
      'name', v_org.name,
      'countryCode', v_org.country_code
    ),
    'branding', jsonb_build_object(
      'primaryColor', v_brand.primary_colour,
      'tagline', v_brand.tagline,
      'hasLogo', coalesce(v_brand.has_logo, false),
      'logoUrl', case
        when coalesce(v_brand.has_logo, false)
          then '/api/v1/public/branding/logo' ||
            case
              when v_brand.logo_version is not null and v_brand.logo_version ~ '^[A-Za-z0-9]+$'
                then '?v=' || v_brand.logo_version
              else ''
            end
        else null
      end
    ),
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name) order by y.starts_on desc)
      from academic_years y
      where y.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) = 0
          or y.id = any (v_form.allowed_academic_year_ids)
        )
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'academicYearId', t.academic_year_id,
        'academicYearName', y.name
      ) order by y.starts_on desc, t.starts_on, t.sort_order)
      from terms t
      join academic_years y on y.id = t.academic_year_id
      where t.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) = 0
          or t.academic_year_id = any (v_form.allowed_academic_year_ids)
        )
    ), '[]'::jsonb),
    'yearGroups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code) order by g.sort_order)
      from year_groups g
      where g.organisation_id = p_organisation_id
        and (
          coalesce(array_length(v_form.allowed_year_group_ids, 1), 0) = 0
          or g.id = any (v_form.allowed_year_group_ids)
        )
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sectionKey', s.section_key,
          'title', s.title,
          'helperText', s.helper_text,
          'sortOrder', s.sort_order,
          'fields', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'fieldKey', f.field_key,
                'fieldKind', f.field_kind,
                'canonicalKey', f.canonical_key,
                'questionType', f.question_type,
                'label', f.label,
                'helperText', f.helper_text,
                'required', f.required,
                'sortOrder', f.sort_order,
                'options', f.options,
                'documentPurpose', f.document_purpose
              )
              order by f.sort_order, f.label
            )
            from admissions_form_fields f
            where f.section_id = s.id and f.enabled
          ), '[]'::jsonb)
        )
        order by s.sort_order, s.title
      )
      from admissions_form_sections s
      where s.form_id = v_form.id
        and s.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function get_published_admissions_form(uuid, text, text) from public;
grant execute on function get_published_admissions_form(uuid, text, text) to schoolapp_app;

create or replace function submit_public_admissions_form(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text,
  p_answers jsonb,
  p_canonical jsonb,
  p_declaration jsonb,
  p_campaign_code text,
  p_source_code text,
  p_is_draft boolean,
  p_draft_token_hash text,
  p_existing_public_id uuid,
  p_ip_hash text,
  p_idempotency_hash text,
  p_completeness text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_campaign admissions_campaigns%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_enquiry_id uuid;
  v_application_id uuid;
  v_enquiry_ref text;
  v_application_ref text;
  v_child jsonb := coalesce(p_canonical->'child', '{}'::jsonb);
  v_guardians jsonb := coalesce(p_canonical->'guardians', '[]'::jsonb);
  v_primary jsonb;
  v_notes text := nullif(p_canonical->>'notes', '');
  v_year uuid;
  v_group uuid;
  v_guardian jsonb;
  v_forename text;
  v_surname text;
  v_legal text;
  v_nationality text;
  v_term uuid;
  v_term_year uuid;
begin
  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug
  for update;
  if not found or not public_form_is_accepting(v_form) then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  if p_campaign_code is not null and length(trim(p_campaign_code)) > 0 then
    select * into v_campaign
    from admissions_campaigns
    where organisation_id = p_organisation_id
      and public_code = lower(trim(p_campaign_code))
      and enabled;
  end if;

  if p_idempotency_hash is not null then
    select * into v_sub
    from admissions_form_submissions
    where form_id = v_form.id
      and organisation_id = p_organisation_id
      and idempotency_hash = p_idempotency_hash;
    if found and v_sub.completeness_status is distinct from 'draft' then
      if v_sub.enquiry_id is not null then
        select reference into v_enquiry_ref
        from admissions_enquiries
        where id = v_sub.enquiry_id and organisation_id = p_organisation_id;
      end if;
      if v_sub.application_id is not null then
        select reference into v_application_ref
        from admissions_applications
        where id = v_sub.application_id and organisation_id = p_organisation_id;
      end if;
      return jsonb_build_object(
        'publicId', v_sub.public_id,
        'completeness', v_sub.completeness_status,
        'enquiryId', v_sub.enquiry_id,
        'applicationId', v_sub.application_id,
        'enquiryReference', v_enquiry_ref,
        'applicationReference', v_application_ref,
        'formType', v_form.form_type,
        'submittedAt', v_sub.submitted_at,
        'replayed', true
      );
    end if;
  end if;

  if p_existing_public_id is not null then
    select * into v_sub
    from admissions_form_submissions
    where organisation_id = p_organisation_id
      and form_id = v_form.id
      and public_id = p_existing_public_id
    for update;
    if not found
       or v_sub.draft_token_hash is distinct from p_draft_token_hash
       or v_sub.completeness_status is distinct from 'draft'
       or (v_sub.draft_expires_at is not null and v_sub.draft_expires_at <= now()) then
      raise exception 'public_form_draft_invalid' using errcode = 'P0002';
    end if;
  elsif p_draft_token_hash is not null then
    select * into v_sub
    from admissions_form_submissions
    where organisation_id = p_organisation_id
      and form_id = v_form.id
      and draft_token_hash = p_draft_token_hash
      and completeness_status = 'draft'
      and (draft_expires_at is null or draft_expires_at > now())
    for update;
    if not found then
      -- A freshly issued draft token has no row yet. An unknown token on
      -- final submit must not create a second enquiry/application.
      if not p_is_draft then
        raise exception 'public_form_draft_invalid' using errcode = 'P0002';
      end if;
    end if;
  end if;

  v_year := nullif(v_child->>'intendedAcademicYearId', '')::uuid;
  v_group := nullif(v_child->>'intendedYearGroupId', '')::uuid;
  if v_year is not null and not exists (
    select 1 from academic_years y where y.id = v_year and y.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if v_group is not null and not exists (
    select 1 from year_groups g where g.id = v_group and g.organisation_id = p_organisation_id
  ) then
    raise exception 'organisation_mismatch' using errcode = '23514';
  end if;
  if coalesce(array_length(v_form.allowed_academic_year_ids, 1), 0) > 0
     and v_year is not null
     and not (v_year = any (v_form.allowed_academic_year_ids)) then
    raise exception 'validation_failed' using errcode = '23514';
  end if;
  if coalesce(array_length(v_form.allowed_year_group_ids, 1), 0) > 0
     and v_group is not null
     and not (v_group = any (v_form.allowed_year_group_ids)) then
    raise exception 'validation_failed' using errcode = '23514';
  end if;

  v_forename := left(nullif(trim(v_child->>'legalForename'), ''), 80);
  v_surname := left(nullif(trim(v_child->>'legalSurname'), ''), 80);
  v_nationality := left(nullif(trim(v_child->>'nationality'), ''), 80);
  v_legal := nullif(trim(v_child->>'legalName'), '');
  -- Name parts are canonical. Never split a legacy legal-name string into parts.
  if v_forename is not null or v_surname is not null then
    v_legal := nullif(trim(concat_ws(' ', v_forename, v_surname)), '');
  end if;
  if nullif(v_child->>'intendedTermId', '') is not null then
    v_term := nullif(v_child->>'intendedTermId', '')::uuid;
    select t.academic_year_id into v_term_year
    from terms t
    where t.id = v_term and t.organisation_id = p_organisation_id;
    if not found then
      raise exception 'organisation_mismatch' using errcode = '23514';
    end if;
    if v_year is not null and v_term_year is distinct from v_year then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
  end if;

  if jsonb_typeof(v_guardians) = 'array' and jsonb_array_length(v_guardians) > 0 then
    v_primary := v_guardians->0;
    for v_guardian in select value from jsonb_array_elements(v_guardians)
    loop
      if coalesce((v_guardian->>'primaryContact')::boolean, false) then
        v_primary := v_guardian;
      end if;
    end loop;
  end if;

  if not p_is_draft and v_form.form_type = 'enquiry' then
    if coalesce(nullif(v_child->>'legalName', ''), '') = ''
       or coalesce(nullif(v_primary->>'fullName', ''), '') = '' then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
    v_enquiry_ref := next_admissions_reference_unrestricted(p_organisation_id, 'enquiry');
    insert into admissions_enquiries (
      organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
      intended_academic_year_id, intended_year_group_id, guardian_full_name, guardian_email,
      guardian_telephone, enquiry_date, source, notes, public_form_id, campaign_id, extra_fields
    ) values (
      p_organisation_id,
      v_enquiry_ref,
      'open',
      v_child->>'legalName',
      nullif(v_child->>'preferredName', ''),
      nullif(v_child->>'dateOfBirth', '')::date,
      v_year,
      v_group,
      v_primary->>'fullName',
      nullif(v_primary->>'email', ''),
      nullif(v_primary->>'phone', ''),
      current_date,
      coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
      v_notes,
      v_form.id,
      v_campaign.id,
      jsonb_build_object('canonical', p_canonical, 'publicForm', true)
    )
    returning id into v_enquiry_id;
  elsif not p_is_draft and v_form.form_type = 'application' then
    if coalesce(v_legal, '') = '' then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
    if v_sub.application_id is not null then
      v_application_id := v_sub.application_id;
      perform set_config('app.admissions_transition_reason', 'Public application submitted', true);
      update admissions_applications
      set pupil_legal_name = v_legal,
          pupil_legal_forename = v_forename,
          pupil_legal_surname = v_surname,
          nationality = v_nationality,
          pupil_preferred_name = nullif(v_child->>'preferredName', ''),
          date_of_birth = nullif(v_child->>'dateOfBirth', '')::date,
          intended_academic_year_id = v_year,
          intended_year_group_id = v_group,
          intended_term_id = v_term,
          intended_entry_date = nullif(v_child->>'proposedStartDate', '')::date,
          previous_school = nullif(v_child->>'previousSchool', ''),
          current_school = nullif(v_child->>'currentSchool', ''),
          gender = nullif(v_child->>'gender', ''),
          address_line1 = nullif(v_child->'address'->>'line1', ''),
          address_line2 = nullif(v_child->'address'->>'line2', ''),
          address_town = nullif(v_child->'address'->>'town', ''),
          address_postcode = nullif(v_child->'address'->>'postcode', ''),
          source = coalesce(v_campaign.label, nullif(p_source_code, ''), source, 'website'),
          extra_fields = jsonb_build_object('canonical', p_canonical, 'publicForm', true),
          public_form_id = v_form.id,
          campaign_id = coalesce(v_campaign.id, campaign_id),
          completeness_status = p_completeness,
          status = 'submitted',
          submitted_at = now(),
          updated_at = now()
      where id = v_application_id and organisation_id = p_organisation_id;
    else
      v_application_ref := next_admissions_reference_unrestricted(p_organisation_id, 'application');
      perform set_config('app.admissions_transition_reason', 'Public application submitted', true);
      insert into admissions_applications (
        organisation_id, reference, status, pupil_legal_name, pupil_legal_forename, pupil_legal_surname,
        nationality, pupil_preferred_name, date_of_birth,
        intended_academic_year_id, intended_year_group_id, intended_term_id, intended_entry_date, previous_school,
        current_school, application_date, submitted_at, source, extra_fields, public_form_id,
        campaign_id, gender, address_line1, address_line2, address_town, address_postcode,
        completeness_status
      ) values (
        p_organisation_id,
        v_application_ref,
        'submitted',
        v_legal,
        v_forename,
        v_surname,
        v_nationality,
        nullif(v_child->>'preferredName', ''),
        nullif(v_child->>'dateOfBirth', '')::date,
        v_year,
        v_group,
        v_term,
        nullif(v_child->>'proposedStartDate', '')::date,
        nullif(v_child->>'previousSchool', ''),
        nullif(v_child->>'currentSchool', ''),
        current_date,
        now(),
        coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
        jsonb_build_object('canonical', p_canonical, 'publicForm', true),
        v_form.id,
        v_campaign.id,
        nullif(v_child->>'gender', ''),
        nullif(v_child->'address'->>'line1', ''),
        nullif(v_child->'address'->>'line2', ''),
        nullif(v_child->'address'->>'town', ''),
        nullif(v_child->'address'->>'postcode', ''),
        p_completeness
      )
      returning id into v_application_id;
    end if;

    delete from admissions_application_contacts
    where application_id = v_application_id and organisation_id = p_organisation_id;

    if jsonb_typeof(v_guardians) = 'array' then
      for v_guardian in select value from jsonb_array_elements(v_guardians)
      loop
        insert into admissions_application_contacts (
          organisation_id, application_id, full_name, title, email, telephone, alternative_telephone,
          occupation, relationship,
          is_primary, has_parental_responsibility, address_line1, address_line2,
          address_town, address_postcode
        ) values (
          p_organisation_id,
          v_application_id,
          v_guardian->>'fullName',
          left(nullif(trim(v_guardian->>'title'), ''), 20),
          nullif(v_guardian->>'email', ''),
          left(nullif(v_guardian->>'phone', ''), 40),
          left(nullif(v_guardian->>'phoneAlternative', ''), 40),
          left(nullif(trim(v_guardian->>'occupation'), ''), 120),
          coalesce(nullif(v_guardian->>'relationship', ''), 'other'),
          coalesce((v_guardian->>'primaryContact')::boolean, false),
          coalesce((v_guardian->>'parentalResponsibility')::boolean, false),
          nullif(v_guardian->'address'->>'line1', ''),
          nullif(v_guardian->'address'->>'line2', ''),
          nullif(v_guardian->'address'->>'town', ''),
          nullif(v_guardian->'address'->>'postcode', '')
        );
      end loop;
    end if;

    if p_canonical ? 'emergency' and coalesce(p_canonical->'emergency'->>'fullName', '') <> '' then
      insert into admissions_application_contacts (
        organisation_id, application_id, full_name, telephone, relationship,
        is_primary, has_parental_responsibility, is_emergency, authorised_collection
      ) values (
        p_organisation_id,
        v_application_id,
        p_canonical->'emergency'->>'fullName',
        nullif(p_canonical->'emergency'->>'telephone', ''),
        coalesce(nullif(p_canonical->'emergency'->>'relationship', ''), 'other'),
        false,
        false,
        true,
        coalesce((p_canonical->'emergency'->>'authorisedCollection')::boolean, false)
      );
    end if;
  elsif p_is_draft and v_form.form_type = 'application' and v_sub.application_id is null
        and coalesce(v_legal, '') <> '' then
    v_application_ref := next_admissions_reference_unrestricted(p_organisation_id, 'application');
    perform set_config('app.admissions_transition_reason', 'Public application draft', true);
    insert into admissions_applications (
      organisation_id, reference, status, pupil_legal_name, pupil_legal_forename, pupil_legal_surname,
      nationality, pupil_preferred_name, date_of_birth,
      intended_academic_year_id, intended_year_group_id, intended_term_id, source, extra_fields, public_form_id,
      campaign_id, completeness_status
    ) values (
      p_organisation_id,
      v_application_ref,
      'draft',
      v_legal,
      v_forename,
      v_surname,
      v_nationality,
      nullif(v_child->>'preferredName', ''),
      nullif(v_child->>'dateOfBirth', '')::date,
      v_year,
      v_group,
      v_term,
      coalesce(v_campaign.label, nullif(p_source_code, ''), 'website'),
      jsonb_build_object('canonical', p_canonical, 'publicForm', true),
      v_form.id,
      v_campaign.id,
      'draft'
    )
    returning id into v_application_id;
  else
    v_enquiry_id := v_sub.enquiry_id;
    v_application_id := v_sub.application_id;
  end if;

  if v_application_ref is null and coalesce(v_application_id, v_sub.application_id) is not null then
    select reference into v_application_ref
    from admissions_applications
    where id = coalesce(v_application_id, v_sub.application_id)
      and organisation_id = p_organisation_id;
  end if;
  if v_enquiry_ref is null and coalesce(v_enquiry_id, v_sub.enquiry_id) is not null then
    select reference into v_enquiry_ref
    from admissions_enquiries
    where id = coalesce(v_enquiry_id, v_sub.enquiry_id)
      and organisation_id = p_organisation_id;
  end if;

  if v_sub.id is null then
    insert into admissions_form_submissions (
      organisation_id, form_id, form_type, completeness_status, enquiry_id, application_id,
      campaign_id, source_code, answers, canonical_snapshot, declaration_snapshot,
      draft_token_hash, draft_expires_at, submitted_at, client_ip_hash, idempotency_hash
    ) values (
      p_organisation_id,
      v_form.id,
      v_form.form_type,
      p_completeness,
      v_enquiry_id,
      v_application_id,
      v_campaign.id,
      coalesce(v_campaign.public_code, nullif(p_source_code, '')),
      coalesce(p_answers, '{}'::jsonb),
      coalesce(p_canonical, '{}'::jsonb),
      p_declaration,
      case when p_is_draft then p_draft_token_hash else null end,
      case when p_is_draft then now() + interval '7 days' else null end,
      case when p_is_draft then null else now() end,
      p_ip_hash,
      p_idempotency_hash
    )
    returning * into v_sub;
  else
    update admissions_form_submissions
    set answers = coalesce(p_answers, answers),
        canonical_snapshot = coalesce(p_canonical, canonical_snapshot),
        declaration_snapshot = case when p_is_draft then declaration_snapshot else p_declaration end,
        completeness_status = p_completeness,
        enquiry_id = coalesce(v_enquiry_id, enquiry_id),
        application_id = coalesce(v_application_id, application_id),
        campaign_id = coalesce(v_campaign.id, campaign_id),
        source_code = coalesce(v_campaign.public_code, nullif(p_source_code, ''), source_code),
        draft_token_hash = case when p_is_draft then p_draft_token_hash else null end,
        draft_expires_at = case when p_is_draft then now() + interval '7 days' else null end,
        submitted_at = case when p_is_draft then submitted_at else now() end,
        client_ip_hash = coalesce(p_ip_hash, client_ip_hash),
        idempotency_hash = coalesce(p_idempotency_hash, idempotency_hash),
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  end if;

  insert into audit_events (
    organisation_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_organisation_id,
    null,
    case
      when p_is_draft then 'admissions.form.draft_saved'
      when v_form.form_type = 'enquiry' then 'admissions.enquiry.submitted_public'
      else 'admissions.application.submitted_public'
    end,
    'admissions_form_submission',
    v_sub.id,
    jsonb_build_object(
      'formId', v_form.id,
      'formType', v_form.form_type,
      'slug', v_form.slug,
      'publicId', v_sub.public_id,
      'completeness', p_completeness,
      'campaignCode', v_campaign.public_code,
      'declarationCaptured', p_declaration is not null and not p_is_draft
    )
  );

  return jsonb_build_object(
    'publicId', v_sub.public_id,
    'completeness', v_sub.completeness_status,
    'enquiryId', v_sub.enquiry_id,
    'applicationId', v_sub.application_id,
    'enquiryReference', v_enquiry_ref,
    'applicationReference', v_application_ref,
    'formType', v_form.form_type,
    'submittedAt', v_sub.submitted_at,
    'replayed', false
  );
end;
$$;

revoke all on function submit_public_admissions_form(
  uuid, text, text, jsonb, jsonb, jsonb, text, text, boolean, text, uuid, text, text, text
) from public;
grant execute on function submit_public_admissions_form(
  uuid, text, text, jsonb, jsonb, jsonb, text, text, boolean, text, uuid, text, text, text
) to schoolapp_app;
