-- Optional invoice/receipt presentation settings.
-- Additive. Defaults match current documents so existing schools need no configuration.
-- Does not rewrite issued invoice totals, numbering, VAT, snapshots, or Stripe settlement.

alter table school_finance_settings
  add column if not exists finance_logo_object_id uuid,
  add column if not exists document_logo_mode text not null default 'school'
    check (document_logo_mode in ('school', 'finance', 'none')),
  add column if not exists document_show_school_name boolean not null default true,
  add column if not exists document_show_legal_name boolean not null default true,
  add column if not exists document_show_address boolean not null default true,
  add column if not exists document_show_phone boolean not null default true,
  add column if not exists document_show_email boolean not null default true,
  add column if not exists document_show_website boolean not null default true,
  add column if not exists document_show_vat_number boolean not null default true,
  add column if not exists document_footer_show_contact boolean not null default false,
  add column if not exists document_footer_show_legal boolean not null default true;

alter table school_finance_settings
  drop constraint if exists school_finance_settings_finance_logo_object_id_fkey;

alter table school_finance_settings
  add constraint school_finance_settings_finance_logo_object_id_fkey
  foreign key (finance_logo_object_id) references stored_objects (id);
