-- Production hardening PR A: admissions integrity.
-- 1) Idempotent public submit replay returns the real enquiry/application reference.
-- 2) Read-only public confirmation lookup for durable confirmation URLs.
-- Additive. Does not backfill or change historical admissions rows.
-- No new tenant tables. Confirmation tokens are HMAC-signed (AUTH_SECRET) and
-- expire; this function only returns safe confirmation fields.

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
    if coalesce(nullif(v_child->>'legalName', ''), '') = '' then
      raise exception 'validation_failed' using errcode = '23514';
    end if;
    if v_sub.application_id is not null then
      v_application_id := v_sub.application_id;
      perform set_config('app.admissions_transition_reason', 'Public application submitted', true);
      update admissions_applications
      set pupil_legal_name = v_child->>'legalName',
          pupil_preferred_name = nullif(v_child->>'preferredName', ''),
          date_of_birth = nullif(v_child->>'dateOfBirth', '')::date,
          intended_academic_year_id = v_year,
          intended_year_group_id = v_group,
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
        organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
        intended_academic_year_id, intended_year_group_id, intended_entry_date, previous_school,
        current_school, application_date, submitted_at, source, extra_fields, public_form_id,
        campaign_id, gender, address_line1, address_line2, address_town, address_postcode,
        completeness_status
      ) values (
        p_organisation_id,
        v_application_ref,
        'submitted',
        v_child->>'legalName',
        nullif(v_child->>'preferredName', ''),
        nullif(v_child->>'dateOfBirth', '')::date,
        v_year,
        v_group,
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
          organisation_id, application_id, full_name, email, telephone, relationship,
          is_primary, has_parental_responsibility, address_line1, address_line2,
          address_town, address_postcode
        ) values (
          p_organisation_id,
          v_application_id,
          v_guardian->>'fullName',
          nullif(v_guardian->>'email', ''),
          nullif(v_guardian->>'phone', ''),
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
        and coalesce(nullif(v_child->>'legalName', ''), '') <> '' then
    v_application_ref := next_admissions_reference_unrestricted(p_organisation_id, 'application');
    perform set_config('app.admissions_transition_reason', 'Public application draft', true);
    insert into admissions_applications (
      organisation_id, reference, status, pupil_legal_name, pupil_preferred_name, date_of_birth,
      intended_academic_year_id, intended_year_group_id, source, extra_fields, public_form_id,
      campaign_id, completeness_status
    ) values (
      p_organisation_id,
      v_application_ref,
      'draft',
      v_child->>'legalName',
      nullif(v_child->>'preferredName', ''),
      nullif(v_child->>'dateOfBirth', '')::date,
      v_year,
      v_group,
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

create or replace function get_public_admissions_submission_confirmation(
  p_organisation_id uuid,
  p_form_type text,
  p_slug text,
  p_public_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_form admissions_forms%rowtype;
  v_org organisations%rowtype;
  v_sub admissions_form_submissions%rowtype;
  v_brand record;
  v_enquiry_ref text;
  v_application_ref text;
  v_child_first text;
begin
  if p_organisation_id is null or p_public_id is null then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;
  if public.app_current_organisation_id() is not null
     and public.app_current_organisation_id() is distinct from p_organisation_id then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  select * into v_org from organisations where id = p_organisation_id and status = 'active';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  select * into v_form
  from admissions_forms
  where organisation_id = p_organisation_id
    and form_type = p_form_type
    and slug = p_slug;
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

  select * into v_sub
  from admissions_form_submissions
  where organisation_id = p_organisation_id
    and form_id = v_form.id
    and public_id = p_public_id
    and completeness_status is distinct from 'draft';
  if not found then
    raise exception 'public_form_unavailable' using errcode = 'P0002';
  end if;

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

  v_child_first := nullif(
    split_part(
      trim(both from coalesce(
        nullif(v_sub.canonical_snapshot #>> '{child,preferredName}', ''),
        nullif(v_sub.canonical_snapshot #>> '{child,legalName}', ''),
        ''
      )),
      ' ',
      1
    ),
    ''
  );

  select * into v_brand from get_public_school_branding(p_organisation_id);

  return jsonb_build_object(
    'formType', v_form.form_type,
    'slug', v_form.slug,
    'enquiryReference', v_enquiry_ref,
    'applicationReference', v_application_ref,
    'childFirstName', case when v_form.form_type = 'application' then v_child_first else null end,
    'formSuccessTitle', v_form.success_title,
    'formSuccessText', v_form.success_text,
    'submittedAt', v_sub.submitted_at,
    'organisation', jsonb_build_object(
      'name', v_org.name,
      'slug', v_org.slug
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
    )
  );
end;
$$;

revoke all on function get_public_admissions_submission_confirmation(uuid, text, text, uuid) from public;
grant execute on function get_public_admissions_submission_confirmation(uuid, text, text, uuid) to schoolapp_app;
