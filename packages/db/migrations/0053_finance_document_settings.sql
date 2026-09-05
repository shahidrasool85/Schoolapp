-- Optional school finance document details for invoices and receipts.
-- Additive. Does not change historical invoice amounts, numbering, or Stripe settlement.
-- Bank fields are organisation-scoped payment instructions, not card/Stripe credentials.

alter table school_finance_settings
  add column if not exists finance_email text
    check (finance_email is null or char_length(finance_email) <= 200),
  add column if not exists bank_name text
    check (bank_name is null or char_length(bank_name) <= 120),
  add column if not exists bank_account_name text
    check (bank_account_name is null or char_length(bank_account_name) <= 120),
  add column if not exists bank_account_number text
    check (bank_account_number is null or char_length(bank_account_number) <= 20),
  add column if not exists bank_sort_code text
    check (bank_sort_code is null or char_length(bank_sort_code) <= 12);
