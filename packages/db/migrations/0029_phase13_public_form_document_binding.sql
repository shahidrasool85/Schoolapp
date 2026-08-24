-- Phase 13 follow-up: bind public file answers to the current draft, and
-- return storage keys from reject so orphan bytes can be deleted.

drop function if exists reject_public_form_document(uuid, uuid);

create function reject_public_form_document(
  p_organisation_id uuid,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_object_id uuid;
begin
  select d.storage_key, d.stored_object_id
    into v_key, v_object_id
  from admissions_form_documents d
  where d.id = p_document_id
    and d.organisation_id = p_organisation_id;
  if not found then
    return jsonb_build_object('id', p_document_id);
  end if;

  update stored_objects
     set status = 'rejected',
         deleted_at = coalesce(deleted_at, now())
   where id = v_object_id
     and organisation_id = p_organisation_id
     and status in ('pending', 'rejected');

  update admissions_form_documents
     set deleted_at = coalesce(deleted_at, now())
   where id = p_document_id
     and organisation_id = p_organisation_id;

  return jsonb_build_object(
    'id', p_document_id,
    'storageKey', v_key,
    'storedObjectId', v_object_id
  );
end;
$$;

revoke all on function reject_public_form_document(uuid, uuid) from public;
grant execute on function reject_public_form_document(uuid, uuid) to schoolapp_app;

create or replace function assert_public_form_file_answers(
  p_organisation_id uuid,
  p_token_hash text,
  p_public_id uuid,
  p_answers jsonb,
  p_final boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sub admissions_form_submissions%rowtype;
  v_field record;
  v_document_id uuid;
  v_ok boolean;
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
begin
  select * into v_sub
  from admissions_form_submissions
  where organisation_id = p_organisation_id
    and public_id = p_public_id
    and draft_token_hash = p_token_hash
    and completeness_status = 'draft'
    and (draft_expires_at is null or draft_expires_at > now());

  if not found then
    if p_final or exists (
      select 1
      from jsonb_each(v_answers) e
      where jsonb_typeof(e.value) = 'object'
        and coalesce(e.value->>'documentId', '') <> ''
    ) then
      raise exception 'public_form_draft_invalid' using errcode = 'P0002';
    end if;
    return;
  end if;

  if exists (
    select 1
    from jsonb_each(v_answers) e
    where jsonb_typeof(e.value) = 'object'
      and coalesce(e.value->>'documentId', '') <> ''
      and not exists (
        select 1
        from admissions_form_fields f
        where f.form_id = v_sub.form_id
          and f.organisation_id = p_organisation_id
          and f.enabled
          and f.question_type = 'file'
          and f.field_key = e.key
      )
  ) then
    raise exception 'public_form_document_invalid' using errcode = '23514';
  end if;

  for v_field in
    select field_key, required
    from admissions_form_fields
    where form_id = v_sub.form_id
      and organisation_id = p_organisation_id
      and enabled
      and question_type = 'file'
  loop
    v_document_id := null;
    begin
      v_document_id := nullif(v_answers -> v_field.field_key ->> 'documentId', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'public_form_document_invalid' using errcode = '23514';
    end;

    if p_final and v_field.required and v_document_id is null then
      raise exception 'public_form_document_missing' using errcode = '23514';
    end if;

    if v_document_id is null then
      continue;
    end if;

    v_ok := null;
    select true into v_ok
    from admissions_form_documents d
    join stored_objects so
      on so.id = d.stored_object_id
     and so.organisation_id = d.organisation_id
    where d.id = v_document_id
      and d.organisation_id = p_organisation_id
      and d.submission_id = v_sub.id
      and d.field_key = v_field.field_key
      and d.deleted_at is null
      and so.status = 'active'
      and so.deleted_at is null;

    if v_ok is not true then
      raise exception 'public_form_document_invalid' using errcode = '23514';
    end if;
  end loop;
end;
$$;

revoke all on function assert_public_form_file_answers(uuid, text, uuid, jsonb, boolean) from public;
grant execute on function assert_public_form_file_answers(uuid, text, uuid, jsonb, boolean) to schoolapp_app;
